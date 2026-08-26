import type { Pool, PoolClient, QueryResultRow } from "pg";
import { ApiError } from "../errors.ts";
import type {
  AnswerSummary,
  AuthenticatedParticipant,
  GameGenre,
  GameRepository,
  GameSessionSummary,
  MembershipResult,
  ParticipantRole,
  ParticipantSummary,
  RoomDetail,
  RoomStatus,
  RoomSummary,
  SessionResultSource,
  SessionStatus,
} from "../types.ts";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_ATTEMPTS = 5;
const SESSION_RECOVERY_GRACE_MS = 2_000;

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
  is_profile_public: boolean;
}

interface SessionRow extends QueryResultRow {
  id: string;
  room_id: string;
  session_number: number;
  status: SessionStatus;
  question_count: number;
  choice_order_version: number;
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

interface SessionResultRow extends QueryResultRow {
  participant_id: string;
  display_name_snapshot: string;
  role_snapshot: ParticipantRole;
  is_profile_public: boolean;
  question_index: number | null;
  selected_option: number | null;
  response_time_ms: number | null;
}

interface AuthorizedResultSessionRow extends SessionRow {
  requester_participant_id: string;
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
    isProfilePublic: row.is_profile_public,
  };
}

function mapSession(row: SessionRow): GameSessionSummary {
  return {
    id: row.id,
    roomId: row.room_id,
    sessionNumber: row.session_number,
    status: row.status,
    questionCount: row.question_count,
    choiceOrderVersion: row.choice_order_version,
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
           RETURNING id, display_name, role, joined_at, is_profile_public`,
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
         RETURNING id, display_name, role, joined_at, is_profile_public`,
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
      `SELECT id, display_name, role, joined_at, is_profile_public
       FROM participant
       WHERE room_id = $1 AND left_at IS NULL
       ORDER BY joined_at, id`,
      [room.id],
    );

    const sessionResult = await this.pool.query<SessionRow>(
      `SELECT id, room_id, session_number, status, question_count, choice_order_version,
         answer_time_seconds, current_question_index, question_started_at,
         started_at, finished_at
       FROM game_session
       WHERE room_id = $1
       ORDER BY session_number DESC
       LIMIT 1`,
      [room.id],
    );

    return {
      ...mapRoom(room),
      participants: participants.rows.map(mapParticipant),
      activeSession: sessionResult.rows[0] ? mapSession(sessionResult.rows[0]) : null,
    };
  }

  async authenticateParticipant(
    roomCode: string,
    accessToken: string,
  ): Promise<AuthenticatedParticipant> {
    const tokenHash = await hashAccessToken(accessToken);
    const result = await this.pool.query<ParticipantRow & { room_id: string }>(
      `SELECT p.id, p.display_name, p.role, p.joined_at, p.is_profile_public, p.room_id
       FROM participant p
       JOIN room r ON r.id = p.room_id
       WHERE r.code = $1
         AND p.access_token_hash = $2
         AND p.left_at IS NULL`,
      [roomCode, tokenHash],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError(401, "AUTHENTICATION_FAILED", "Invalid room code or access token");
    }
    return { roomId: row.room_id, participant: mapParticipant(row) };
  }

  async selectGenre(code: string, accessToken: string, genre: GameGenre): Promise<RoomSummary> {
    const tokenHash = await hashAccessToken(accessToken);
    const roomResult = await this.pool.query<RoomRow>(
      `UPDATE room
       SET genre = $3, updated_at = now()
       WHERE code = $1
         AND status = 'lobby'
         AND EXISTS (
           SELECT 1 FROM participant p
           WHERE p.room_id = room.id
             AND p.access_token_hash = $2
             AND p.role = 'host'
             AND p.left_at IS NULL
         )
       RETURNING id, code, status, genre, created_at`,
      [code, tokenHash, genre],
    );
    const room = roomResult.rows[0];
    if (!room) {
      const existing = await this.pool.query<RoomRow>(
        `SELECT id, code, status, genre, created_at FROM room WHERE code = $1`,
        [code],
      );
      if (!existing.rows[0]) {
        throw new ApiError(404, "ROOM_NOT_FOUND", "Room not found");
      }
      if (existing.rows[0].status !== "lobby") {
        throw new ApiError(
          409,
          "ROOM_NOT_IN_LOBBY",
          "The genre can only be set before the game starts",
        );
      }
      throw new ApiError(403, "HOST_REQUIRED", "A valid host token is required");
    }
    return mapRoom(room);
  }

  async setProfileVisibility(
    code: string,
    accessToken: string,
    isProfilePublic: boolean,
  ): Promise<ParticipantSummary> {
    const tokenHash = await hashAccessToken(accessToken);
    const result = await this.pool.query<ParticipantRow>(
      `UPDATE participant p
       SET is_profile_public = $3
       FROM room r
       WHERE p.room_id = r.id
         AND r.code = $1
         AND p.access_token_hash = $2
         AND p.left_at IS NULL
       RETURNING p.id, p.display_name, p.role, p.joined_at, p.is_profile_public`,
      [code, tokenHash, isProfilePublic],
    );
    const participant = result.rows[0];
    if (!participant) {
      throw new ApiError(401, "AUTHENTICATION_FAILED", "Invalid room code or access token");
    }
    return mapParticipant(participant);
  }

  async startSession(
    code: string,
    accessToken: string,
    questionCount: number,
    answerTimeSeconds: number,
  ): Promise<GameSessionSummary> {
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
         RETURNING id, room_id, session_number, status, question_count, choice_order_version,
           answer_time_seconds, current_question_index, question_started_at,
           started_at, finished_at`,
        [room.id, questionCount, answerTimeSeconds],
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

  async getSessionForParticipant(
    sessionId: string,
    accessToken: string,
    reviewTimeSeconds = 5,
  ): Promise<GameSessionSummary> {
    const tokenHash = await hashAccessToken(accessToken);
    const result = await this.pool.query<SessionRow>(
      `SELECT gs.id, gs.room_id, gs.session_number, gs.status, gs.question_count,
         gs.choice_order_version,
         gs.answer_time_seconds, gs.current_question_index, gs.question_started_at,
         gs.started_at, gs.finished_at
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
    if (
      session.status === "active" && session.question_started_at !== null &&
      Date.now() >= Date.parse(toIso(session.question_started_at)) +
          (session.answer_time_seconds + reviewTimeSeconds) * 1000 + SESSION_RECOVERY_GRACE_MS
    ) {
      return await this.reconcileOverdueSession(session, reviewTimeSeconds);
    }
    return mapSession(session);
  }

  async getSessionResultSource(
    sessionId: string,
    accessToken: string,
  ): Promise<SessionResultSource> {
    const tokenHash = await hashAccessToken(accessToken);
    const sessionResult = await this.pool.query<AuthorizedResultSessionRow>(
      `SELECT gs.id, gs.room_id, gs.session_number, gs.status, gs.question_count,
         gs.choice_order_version,
         gs.answer_time_seconds, gs.current_question_index, gs.question_started_at,
         gs.started_at, gs.finished_at, p.id AS requester_participant_id
       FROM game_session gs
       JOIN session_participant requester ON requester.game_session_id = gs.id
       JOIN participant p ON p.id = requester.participant_id
       WHERE gs.id = $1 AND p.access_token_hash = $2`,
      [sessionId, tokenHash],
    );
    const session = sessionResult.rows[0];
    if (!session) {
      throw new ApiError(403, "PARTICIPANT_REQUIRED", "A valid participant token is required");
    }
    if (session.status !== "completed") {
      throw new ApiError(409, "RESULTS_NOT_READY", "Results are available after the quiz ends");
    }

    const result = await this.pool.query<SessionResultRow>(
      `SELECT sp.participant_id, sp.display_name_snapshot, sp.role_snapshot, p.is_profile_public,
         a.question_index, a.selected_option, a.response_time_ms
       FROM session_participant sp
       JOIN participant p ON p.id = sp.participant_id
       LEFT JOIN answer a
         ON a.game_session_id = sp.game_session_id
        AND a.participant_id = sp.participant_id
       WHERE sp.game_session_id = $1
       ORDER BY sp.joined_at, sp.participant_id, a.question_index`,
      [sessionId],
    );

    const participants = new Map<string, SessionResultSource["participants"][number]>();
    for (const row of result.rows) {
      let participant = participants.get(row.participant_id);
      if (!participant) {
        participant = {
          participantId: row.participant_id,
          displayName: row.display_name_snapshot,
          role: row.role_snapshot,
          isProfilePublic: row.is_profile_public,
          answers: [],
        };
        participants.set(row.participant_id, participant);
      }
      if (row.question_index !== null && row.selected_option !== null) {
        participant.answers.push({
          questionIndex: row.question_index,
          selectedOption: row.selected_option,
          responseTimeMs: row.response_time_ms ?? 0,
        });
      }
    }

    return {
      session: mapSession(session),
      requesterParticipantId: session.requester_participant_id,
      participants: [...participants.values()],
    };
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
         RETURNING id, room_id, session_number, status, question_count, choice_order_version,
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
           gs.choice_order_version,
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
        `WITH saved_answer AS (
         INSERT INTO answer (
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
           selected_option, response_time_ms, answered_at
         ), touched_participant AS (
           UPDATE participant
           SET last_seen_at = now()
           WHERE id = $2
             AND EXISTS (SELECT 1 FROM saved_answer)
           RETURNING id
         )
         SELECT saved_answer.*
         FROM saved_answer
         JOIN touched_participant ON true`,
        [sessionId, session.participant_id, questionIndex, selectedOption],
      );
      if (!answerResult.rows[0]) {
        throw new ApiError(409, "ANSWER_NOT_ACCEPTED", "The answer window has closed");
      }
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
         RETURNING id, room_id, session_number, status, question_count, choice_order_version,
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

  async advanceQuestionAutomatically(
    sessionId: string,
    fromIndex: number,
  ): Promise<GameSessionSummary | null> {
    const result = await this.pool.query<SessionRow>(
      `UPDATE game_session
       SET current_question_index = current_question_index + 1, question_started_at = now()
       WHERE id = $1
         AND status = 'active'
         AND current_question_index = $2
       RETURNING id, room_id, session_number, status, question_count, choice_order_version,
         answer_time_seconds, current_question_index, question_started_at,
         started_at, finished_at`,
      [sessionId, fromIndex],
    );
    const row = result.rows[0];
    return row ? mapSession(row) : null;
  }

  async completeSessionAutomatically(sessionId: string): Promise<GameSessionSummary | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<SessionRow>(
        `UPDATE game_session
         SET status = 'completed', finished_at = now()
         WHERE id = $1 AND status = 'active'
         RETURNING id, room_id, session_number, status, question_count, choice_order_version,
           answer_time_seconds, current_question_index, question_started_at,
           started_at, finished_at`,
        [sessionId],
      );
      const row = result.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query(
        `UPDATE room SET status = 'results', updated_at = now() WHERE id = $1`,
        [row.room_id],
      );
      await client.query("COMMIT");
      return mapSession(row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async haveAllParticipantsAnswered(sessionId: string, questionIndex: number): Promise<boolean> {
    const result = await this.pool.query<{ total: string; answered: string }>(
      `SELECT
         (SELECT count(*) FROM session_participant
           WHERE game_session_id = $1 AND left_at IS NULL) AS total,
         (SELECT count(*) FROM answer a
           JOIN session_participant sp
             ON sp.game_session_id = a.game_session_id AND sp.participant_id = a.participant_id
           WHERE a.game_session_id = $1 AND a.question_index = $2 AND sp.left_at IS NULL) AS answered`,
      [sessionId, questionIndex],
    );
    const row = result.rows[0];
    const total = Number(row.total);
    const answered = Number(row.answered);
    return total > 0 && total === answered;
  }

  async markParticipantDisconnected(participantId: string): Promise<{ roomId: string } | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ room_id: string }>(
        `UPDATE participant
         SET left_at = now()
         WHERE id = $1 AND left_at IS NULL
         RETURNING room_id`,
        [participantId],
      );
      const row = result.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query(
        `UPDATE session_participant SET left_at = now() WHERE participant_id = $1 AND left_at IS NULL`,
        [participantId],
      );
      await client.query("COMMIT");
      return { roomId: row.room_id };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteExpiredEmptyRooms(olderThanMs: number): Promise<string[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // まず安価な絞り込みで候補を探す(ロックなし。この時点の結果はまだ信用しない)。
      const candidateResult = await client.query<{ id: string }>(
        `SELECT r.id
         FROM room r
         WHERE EXISTS (SELECT 1 FROM participant p WHERE p.room_id = r.id)
           AND NOT EXISTS (
             SELECT 1 FROM participant p WHERE p.room_id = r.id AND p.left_at IS NULL
           )
           AND (SELECT MAX(p.left_at) FROM participant p WHERE p.room_id = r.id)
             < now() - make_interval(secs => $1)`,
        [olderThanMs / 1000],
      );
      const candidateIds = candidateResult.rows.map((row) => row.id);

      let roomIds: string[] = [];
      if (candidateIds.length > 0) {
        // 候補の部屋行をFOR UPDATEでロックしてから、条件を再確認する。
        // joinRoomも部屋行取得時にFOR UPDATEを取るため、ロック中に新規参加が割り込むことはない。
        // (ロック取得を待っている間に参加された場合は、ここでの再確認で対象から外れる。)
        const recheckResult = await client.query<{ id: string }>(
          `SELECT r.id
           FROM room r
           WHERE r.id = ANY($1::uuid[])
             AND NOT EXISTS (
               SELECT 1 FROM participant p WHERE p.room_id = r.id AND p.left_at IS NULL
             )
             AND (SELECT MAX(p.left_at) FROM participant p WHERE p.room_id = r.id)
               < now() - make_interval(secs => $2)
           FOR UPDATE OF r`,
          [candidateIds, olderThanMs / 1000],
        );
        roomIds = recheckResult.rows.map((row) => row.id);
      }

      if (roomIds.length > 0) {
        // ON DELETE CASCADE/RESTRICTの解決順に依存しないよう、依存関係の深い順に明示的に削除する。
        await client.query(
          `DELETE FROM answer
           WHERE game_session_id IN (SELECT id FROM game_session WHERE room_id = ANY($1::uuid[]))`,
          [roomIds],
        );
        await client.query(
          `DELETE FROM session_participant WHERE room_id = ANY($1::uuid[])`,
          [roomIds],
        );
        await client.query(
          `DELETE FROM game_session WHERE room_id = ANY($1::uuid[])`,
          [roomIds],
        );
        await client.query(
          `DELETE FROM participant WHERE room_id = ANY($1::uuid[])`,
          [roomIds],
        );
        await client.query(`DELETE FROM room WHERE id = ANY($1::uuid[])`, [roomIds]);
      }

      await client.query("COMMIT");
      return roomIds;
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
         gs.choice_order_version,
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

  private async reconcileOverdueSession(
    session: SessionRow,
    reviewTimeSeconds: number,
  ): Promise<GameSessionSummary> {
    const cycleSeconds = session.answer_time_seconds + reviewTimeSeconds;
    if (!Number.isSafeInteger(cycleSeconds) || cycleSeconds < 1) return mapSession(session);

    const result = await this.pool.query<SessionRow>(
      `WITH candidate AS (
         SELECT gs.id, gs.current_question_index, gs.question_started_at,
           GREATEST(
             0,
             floor(
               EXTRACT(epoch FROM (clock_timestamp() - gs.question_started_at)) / $2::integer
             )
           )::integer AS elapsed_cycles
         FROM game_session gs
         WHERE gs.id = $1
           AND gs.status = 'active'
           AND gs.current_question_index IS NOT NULL
           AND gs.question_started_at IS NOT NULL
       ), updated AS (
         UPDATE game_session gs
         SET current_question_index = LEAST(
               gs.question_count - 1,
               gs.current_question_index + candidate.elapsed_cycles
             ),
             question_started_at = gs.question_started_at
               + make_interval(
                 secs => (candidate.elapsed_cycles * $2::integer)::double precision
               ),
             status = CASE
               WHEN gs.current_question_index + candidate.elapsed_cycles >= gs.question_count
                 THEN 'completed'
               ELSE gs.status
             END,
             finished_at = CASE
               WHEN gs.current_question_index + candidate.elapsed_cycles >= gs.question_count
                 THEN gs.question_started_at
                   + make_interval(
                     secs => (
                       (gs.question_count - gs.current_question_index) * $2::integer
                     )::double precision
                   )
               ELSE gs.finished_at
             END
         FROM candidate
         WHERE gs.id = candidate.id
           AND candidate.elapsed_cycles > 0
           AND gs.current_question_index = candidate.current_question_index
           AND gs.question_started_at = candidate.question_started_at
         RETURNING gs.id, gs.room_id, gs.session_number, gs.status, gs.question_count,
           gs.choice_order_version, gs.answer_time_seconds, gs.current_question_index,
           gs.question_started_at, gs.started_at, gs.finished_at
       ), room_updated AS (
         UPDATE room r
         SET status = 'results', updated_at = now()
         FROM updated
         WHERE updated.status = 'completed' AND r.id = updated.room_id
         RETURNING r.id
       )
       SELECT updated.id, updated.room_id, updated.session_number, updated.status,
         updated.question_count, updated.choice_order_version, updated.answer_time_seconds,
         updated.current_question_index, updated.question_started_at, updated.started_at,
         updated.finished_at
       FROM updated
       LEFT JOIN room_updated ON room_updated.id = updated.room_id
       UNION ALL
       SELECT gs.id, gs.room_id, gs.session_number, gs.status, gs.question_count,
         gs.choice_order_version, gs.answer_time_seconds, gs.current_question_index,
         gs.question_started_at, gs.started_at, gs.finished_at
       FROM game_session gs
       WHERE gs.id = $1 AND NOT EXISTS (SELECT 1 FROM updated)`,
      [session.id, cycleSeconds],
    );
    return result.rows[0] ? mapSession(result.rows[0]) : mapSession(session);
  }
}
