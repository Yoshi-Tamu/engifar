import type { Pool, PoolClient, QueryResultRow } from "pg";
import { ApiError } from "../errors.ts";
import type {
  AnswerSummary,
  GameRepository,
  GameSessionSummary,
  MembershipResult,
  ParticipantRole,
  ParticipantSummary,
  RoomDetail,
  RoomStatus,
  RoomSummary,
  SessionStatus,
} from "../types.ts";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_ATTEMPTS = 5;
const DEMO_QUESTION_COUNT = 12;
const DEMO_ANSWER_TIME_SECONDS = 15;

interface RoomRow extends QueryResultRow {
  id: string;
  code: string;
  status: RoomStatus;
  genre: string;
  created_at: Date | string;
}

interface ParticipantRow extends QueryResultRow {
  id: string;
  display_name: string;
  role: ParticipantRole;
  joined_at: Date | string;
}

interface SessionRow extends QueryResultRow {
  id: string;
  room_id: string;
  session_number: number;
  status: SessionStatus;
  question_count: number;
  answer_time_seconds: number;
  current_question_index: number | null;
  question_started_at: Date | string | null;
  started_at: Date | string;
  finished_at: Date | string | null;
}

interface AnswerRow extends QueryResultRow {
  id: string;
  game_session_id: string;
  participant_id: string;
  question_index: number;
  selected_option: number;
  response_time_ms: number;
  answered_at: Date | string;
}

interface TimedSessionRow extends SessionRow {
  answer_window_open: boolean | null;
}

interface AuthorizedSessionRow extends TimedSessionRow {
  participant_id: string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapRoom(row: RoomRow): RoomSummary {
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    genre: row.genre,
    createdAt: toIso(row.created_at),
  };
}

function mapParticipant(row: ParticipantRow): ParticipantSummary {
  return {
    id: row.id,
    displayName: row.display_name,
    role: row.role,
    joinedAt: toIso(row.joined_at),
  };
}

function mapSession(row: SessionRow): GameSessionSummary {
  return {
    id: row.id,
    roomId: row.room_id,
    sessionNumber: row.session_number,
    status: row.status,
    questionCount: row.question_count,
    answerTimeSeconds: row.answer_time_seconds,
    currentQuestionIndex: row.current_question_index,
    questionStartedAt: row.question_started_at ? toIso(row.question_started_at) : null,
    startedAt: toIso(row.started_at),
    finishedAt: row.finished_at ? toIso(row.finished_at) : null,
  };
}

function mapAnswer(row: AnswerRow): AnswerSummary {
  return {
    id: row.id,
    gameSessionId: row.game_session_id,
    participantId: row.participant_id,
    questionIndex: row.question_index,
    selectedOption: row.selected_option,
    responseTimeMs: row.response_time_ms,
    answeredAt: toIso(row.answered_at),
  };
}

function randomRoomCode(): string {
  const values = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH));
  return Array.from(values, (value) => ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length]).join(
    "",
  );
}

function createAccessToken(): string {
  const values = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...values))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function hashAccessToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isRoomCodeCollision(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === "23505" &&
    "constraint" in error && error.constraint === "room_code_key";
}

export class PostgresGameRepository implements GameRepository {
  constructor(private readonly pool: Pool) {}

  async healthCheck(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async createRoom(displayName: string): Promise<MembershipResult> {
    const accessToken = createAccessToken();
    const accessTokenHash = await hashAccessToken(accessToken);

    for (let attempt = 0; attempt < ROOM_CODE_ATTEMPTS; attempt += 1) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const roomResult = await client.query<RoomRow>(
          `INSERT INTO room (code)
           VALUES ($1)
           RETURNING id, code, status, genre, created_at`,
          [randomRoomCode()],
        );
        const room = roomResult.rows[0];
        const participantResult = await client.query<ParticipantRow>(
          `INSERT INTO participant (room_id, display_name, role, access_token_hash)
           VALUES ($1, $2, 'host', $3)
           RETURNING id, display_name, role, joined_at`,
          [room.id, displayName, accessTokenHash],
        );
        await client.query("COMMIT");

        return {
          room: mapRoom(room),
          participant: mapParticipant(participantResult.rows[0]),
          accessToken,
        };
      } catch (error) {
        await client.query("ROLLBACK");
        if (!isRoomCodeCollision(error) || attempt === ROOM_CODE_ATTEMPTS - 1) {
          throw error;
        }
      } finally {
        client.release();
      }
    }

    throw new Error("Failed to generate a unique room code");
  }

  async joinRoom(code: string, displayName: string): Promise<MembershipResult> {
    const client = await this.pool.connect();
    const accessToken = createAccessToken();
    const accessTokenHash = await hashAccessToken(accessToken);

    try {
      await client.query("BEGIN");
      const roomResult = await client.query<RoomRow>(
        `SELECT id, code, status, genre, created_at
         FROM room
         WHERE code = $1
         FOR UPDATE`,
        [code],
      );
      const room = roomResult.rows[0];
      if (!room) {
        throw new ApiError(404, "ROOM_NOT_FOUND", "Room not found");
      }
      if (room.status !== "lobby") {
        throw new ApiError(409, "ROOM_NOT_JOINABLE", "The game has already started");
      }

      const participantResult = await client.query<ParticipantRow>(
        `INSERT INTO participant (room_id, display_name, role, access_token_hash)
         VALUES ($1, $2, 'player', $3)
         RETURNING id, display_name, role, joined_at`,
        [room.id, displayName, accessTokenHash],
      );
      await client.query("COMMIT");

      return {
        room: mapRoom(room),
        participant: mapParticipant(participantResult.rows[0]),
        accessToken,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getRoom(code: string): Promise<RoomDetail> {
    const roomResult = await this.pool.query<RoomRow>(
      `SELECT id, code, status, genre, created_at
       FROM room
       WHERE code = $1`,
      [code],
    );
    const room = roomResult.rows[0];
    if (!room) {
      throw new ApiError(404, "ROOM_NOT_FOUND", "Room not found");
    }

    const participants = await this.pool.query<ParticipantRow>(
      `SELECT id, display_name, role, joined_at
       FROM participant
       WHERE room_id = $1 AND left_at IS NULL
       ORDER BY joined_at, id`,
      [room.id],
    );

    return { ...mapRoom(room), participants: participants.rows.map(mapParticipant) };
  }

  async startSession(code: string, accessToken: string): Promise<GameSessionSummary> {
    const client = await this.pool.connect();
    const tokenHash = await hashAccessToken(accessToken);

    try {
      await client.query("BEGIN");
      const roomResult = await client.query<RoomRow>(
        `SELECT r.id, r.code, r.status, r.genre, r.created_at
         FROM room r
         JOIN participant p ON p.room_id = r.id
         WHERE r.code = $1
           AND p.access_token_hash = $2
           AND p.role = 'host'
           AND p.left_at IS NULL
         FOR UPDATE OF r`,
        [code, tokenHash],
      );
      const room = roomResult.rows[0];
      if (!room) {
        throw new ApiError(403, "HOST_REQUIRED", "A valid host token is required");
      }
      if (room.status !== "lobby") {
        throw new ApiError(409, "SESSION_ALREADY_STARTED", "This room is not in the lobby");
      }

      const sessionResult = await client.query<SessionRow>(
        `INSERT INTO game_session (
           room_id,
           session_number,
           question_count,
           answer_time_seconds,
           current_question_index,
           question_started_at
         )
         SELECT $1, COALESCE(MAX(session_number), 0) + 1, $2, $3, 0, now()
         FROM game_session
         WHERE room_id = $1
         RETURNING id, room_id, session_number, status, question_count,
           answer_time_seconds, current_question_index, question_started_at,
           started_at, finished_at`,
        [room.id, DEMO_QUESTION_COUNT, DEMO_ANSWER_TIME_SECONDS],
      );
      const session = sessionResult.rows[0];

      await client.query(
        `INSERT INTO session_participant (
           game_session_id,
           participant_id,
           room_id,
           display_name_snapshot,
           role_snapshot
         )
         SELECT $1, id, room_id, display_name, role
         FROM participant
         WHERE room_id = $2 AND left_at IS NULL`,
        [session.id, room.id],
      );
      await client.query(
        `UPDATE room SET status = 'playing', updated_at = now() WHERE id = $1`,
        [room.id],
      );
      await client.query("COMMIT");
      return mapSession(session);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async startQuestion(
    sessionId: string,
    accessToken: string,
    questionIndex: number,
  ): Promise<GameSessionSummary> {
    const client = await this.pool.connect();
    const tokenHash = await hashAccessToken(accessToken);

    try {
      await client.query("BEGIN");
      const session = await this.authorizedHostSession(client, sessionId, tokenHash);
      if (session.status !== "active") {
        throw new ApiError(409, "SESSION_NOT_ACTIVE", "The session is not active");
      }
      if (session.answer_window_open) {
        throw new ApiError(
          409,
          "ANSWER_WINDOW_OPEN",
          "The current question is still accepting answers",
        );
      }
      const expectedQuestion = (session.current_question_index ?? -1) + 1;
      if (questionIndex !== expectedQuestion || questionIndex >= session.question_count) {
        throw new ApiError(
          409,
          "INVALID_QUESTION_TRANSITION",
          `The next question index must be ${expectedQuestion}`,
        );
      }

      const result = await client.query<SessionRow>(
        `UPDATE game_session
         SET current_question_index = $2, question_started_at = now()
         WHERE id = $1
         RETURNING id, room_id, session_number, status, question_count,
           answer_time_seconds, current_question_index, question_started_at,
           started_at, finished_at`,
        [sessionId, questionIndex],
      );
      await client.query("COMMIT");
      return mapSession(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async submitAnswer(
    sessionId: string,
    accessToken: string,
    questionIndex: number,
    selectedOption: number,
  ): Promise<AnswerSummary> {
    const client = await this.pool.connect();
    const tokenHash = await hashAccessToken(accessToken);

    try {
      await client.query("BEGIN");
      const result = await client.query<AuthorizedSessionRow>(
        `SELECT gs.id, gs.room_id, gs.session_number, gs.status, gs.question_count,
           gs.answer_time_seconds, gs.current_question_index, gs.question_started_at,
           gs.started_at, gs.finished_at, p.id AS participant_id,
           clock_timestamp() <= gs.question_started_at
             + make_interval(secs => gs.answer_time_seconds) AS answer_window_open
         FROM game_session gs
         JOIN session_participant sp ON sp.game_session_id = gs.id
         JOIN participant p ON p.id = sp.participant_id
         WHERE gs.id = $1
           AND p.access_token_hash = $2
           AND p.left_at IS NULL`,
        [sessionId, tokenHash],
      );
      const session = result.rows[0];
      if (!session) {
        throw new ApiError(403, "PARTICIPANT_REQUIRED", "A valid participant token is required");
      }
      if (session.status !== "active" || session.question_started_at === null) {
        throw new ApiError(409, "SESSION_NOT_ACTIVE", "The session is not accepting answers");
      }
      if (session.current_question_index !== questionIndex) {
        throw new ApiError(409, "QUESTION_NOT_ACTIVE", "This question is not active");
      }

      if (!session.answer_window_open) {
        throw new ApiError(409, "ANSWER_TIME_EXPIRED", "The answer time has expired");
      }

      const answerResult = await client.query<AnswerRow>(
        `INSERT INTO answer (
           game_session_id,
           participant_id,
           question_index,
           selected_option,
           response_time_ms
         )
         SELECT $1, $2, $3, $4,
           GREATEST(
             0,
             floor(EXTRACT(epoch FROM (clock_timestamp() - gs.question_started_at)) * 1000)
           )::integer
         FROM game_session gs
         WHERE gs.id = $1
           AND gs.status = 'active'
           AND gs.current_question_index = $3
           AND clock_timestamp() <= gs.question_started_at
             + make_interval(secs => gs.answer_time_seconds)
         ON CONFLICT (game_session_id, participant_id, question_index)
         DO UPDATE SET
           selected_option = EXCLUDED.selected_option,
           response_time_ms = EXCLUDED.response_time_ms,
           answered_at = now()
         RETURNING id, game_session_id, participant_id, question_index,
           selected_option, response_time_ms, answered_at`,
        [sessionId, session.participant_id, questionIndex, selectedOption],
      );
      if (!answerResult.rows[0]) {
        throw new ApiError(409, "ANSWER_NOT_ACCEPTED", "The answer window has closed");
      }
      await client.query(
        `UPDATE participant SET last_seen_at = now() WHERE id = $1`,
        [session.participant_id],
      );
      await client.query("COMMIT");
      return mapAnswer(answerResult.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async completeSession(sessionId: string, accessToken: string): Promise<GameSessionSummary> {
    const client = await this.pool.connect();
    const tokenHash = await hashAccessToken(accessToken);

    try {
      await client.query("BEGIN");
      const session = await this.authorizedHostSession(client, sessionId, tokenHash);
      if (session.status !== "active") {
        throw new ApiError(409, "SESSION_NOT_ACTIVE", "The session is not active");
      }
      if (session.current_question_index !== session.question_count - 1) {
        throw new ApiError(409, "QUESTIONS_REMAINING", "Not all questions have started");
      }
      if (session.answer_window_open) {
        throw new ApiError(
          409,
          "ANSWER_WINDOW_OPEN",
          "The final question is still accepting answers",
        );
      }

      const result = await client.query<SessionRow>(
        `UPDATE game_session
         SET status = 'completed', finished_at = now()
         WHERE id = $1
         RETURNING id, room_id, session_number, status, question_count,
           answer_time_seconds, current_question_index, question_started_at,
           started_at, finished_at`,
        [sessionId],
      );
      await client.query(
        `UPDATE room SET status = 'results', updated_at = now() WHERE id = $1`,
        [session.room_id],
      );
      await client.query("COMMIT");
      return mapSession(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async authorizedHostSession(
    client: PoolClient,
    sessionId: string,
    tokenHash: string,
  ): Promise<TimedSessionRow> {
    const result = await client.query<TimedSessionRow>(
      `SELECT gs.id, gs.room_id, gs.session_number, gs.status, gs.question_count,
         gs.answer_time_seconds, gs.current_question_index, gs.question_started_at,
         gs.started_at, gs.finished_at,
         clock_timestamp() <= gs.question_started_at
           + make_interval(secs => gs.answer_time_seconds) AS answer_window_open
       FROM game_session gs
       JOIN participant p ON p.room_id = gs.room_id
       WHERE gs.id = $1
         AND p.access_token_hash = $2
         AND p.role = 'host'
         AND p.left_at IS NULL
       FOR UPDATE OF gs`,
      [sessionId, tokenHash],
    );
    const session = result.rows[0];
    if (!session) {
      throw new ApiError(403, "HOST_REQUIRED", "A valid host token is required");
    }
    return session;
  }
}
