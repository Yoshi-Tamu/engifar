import { serveDir } from "@std/http/file-server";
import { ApiError } from "./errors.ts";
import type { GameGenre, GameRepository, SessionResults } from "./types.ts";
import { broadcast, handleWsUpgrade } from "./ws.ts";
import { scheduleQuestionAdvance, triggerEarlyQuestionEnd } from "./questionLoop.ts";
import {
  createQuizService,
  LEGACY_CHOICE_ORDER_VARIANT,
  type QuizService,
  safetyFromCategoryScores,
} from "./quiz.ts";

const MAX_JSON_BODY_BYTES = 16 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECURITY_HEADERS = Object.freeze({
  "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; " +
    "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), geolocation=(), microphone=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});

interface AppOptions {
  staticRoot?: string;
  assetRoot?: string;
  quizService?: QuizService;
}

interface JsonRecord {
  [key: string]: unknown;
}

function json(payload: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return Response.json(payload, {
    status,
    headers: {
      "cache-control": "no-store",
      ...SECURITY_HEADERS,
      ...extraHeaders,
    },
  });
}

function secureStaticResponse(response: Response): Response {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

function apiErrorResponse(error: ApiError): Response {
  return json(
    { error: { code: error.code, message: error.message } },
    error.status,
  );
}

async function readJsonObject(request: Request): Promise<JsonRecord> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_JSON_BODY_BYTES) {
    throw new ApiError(413, "BODY_TOO_LARGE", "JSON body is too large");
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim();
  if (contentType !== "application/json") {
    throw new ApiError(415, "JSON_REQUIRED", "Content-Type must be application/json");
  }

  try {
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          totalBytes += value.byteLength;
          if (totalBytes > MAX_JSON_BODY_BYTES) {
            await reader.cancel();
            throw new ApiError(413, "BODY_TOO_LARGE", "JSON body is too large");
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new ApiError(400, "INVALID_JSON", "JSON body must be an object");
    }
    return value as JsonRecord;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "INVALID_JSON", "Request body is not valid JSON");
  }
}

function displayNameFrom(body: JsonRecord): string {
  if (typeof body.displayName !== "string") {
    throw new ApiError(400, "INVALID_DISPLAY_NAME", "displayName is required");
  }

  const displayName = body.displayName.trim();
  const length = Array.from(displayName).length;
  if (length < 1 || length > 50) {
    throw new ApiError(
      400,
      "INVALID_DISPLAY_NAME",
      "displayName must contain between 1 and 50 characters",
    );
  }
  return displayName;
}

function selectedOptionFrom(body: JsonRecord): number {
  const option = body.selectedOption;
  if (!Number.isInteger(option) || typeof option !== "number" || option < 0 || option > 3) {
    throw new ApiError(400, "INVALID_SELECTED_OPTION", "selectedOption must be 0, 1, 2, or 3");
  }
  return option;
}

function quizTokenFrom(body: JsonRecord, key: "progressToken" | "questionToken"): string {
  const token = body[key];
  if (typeof token !== "string" || token.length < 20 || token.length > 4096) {
    throw new ApiError(400, "INVALID_QUIZ_TOKEN", `${key} is required`);
  }
  return token;
}

function quizSelectedOptionFrom(body: JsonRecord): number | null {
  if (body.selectedOption === null) return null;
  return selectedOptionFrom(body);
}

const GAME_GENRES: readonly GameGenre[] = ["web", "linebot", "modeling", "game"];

function isProfilePublicFrom(body: JsonRecord): boolean {
  if (typeof body.isProfilePublic !== "boolean") {
    throw new ApiError(
      400,
      "INVALID_PROFILE_VISIBILITY",
      "isProfilePublic must be a boolean",
    );
  }
  return body.isProfilePublic;
}

function genreFrom(body: JsonRecord): GameGenre {
  const genre = body.genre;
  if (typeof genre !== "string" || !GAME_GENRES.includes(genre as GameGenre)) {
    throw new ApiError(
      400,
      "INVALID_GENRE",
      `genre must be one of: ${GAME_GENRES.join(", ")}`,
    );
  }
  return genre as GameGenre;
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{20,})$/);
  if (!match) {
    throw new ApiError(401, "AUTHENTICATION_REQUIRED", "A bearer token is required");
  }
  return match[1];
}

function roomCode(rawCode: string): string {
  const code = rawCode.toUpperCase();
  if (!/^[A-Z0-9]{6,8}$/.test(code)) {
    throw new ApiError(400, "INVALID_ROOM_CODE", "Room code must be 6 to 8 letters or digits");
  }
  return code;
}

function sessionId(rawId: string): string {
  if (!UUID_PATTERN.test(rawId)) {
    throw new ApiError(400, "INVALID_SESSION_ID", "sessionId must be a UUID");
  }
  return rawId;
}

function questionIndex(rawIndex: string): number {
  if (!/^\d+$/.test(rawIndex)) {
    throw new ApiError(
      400,
      "INVALID_QUESTION_INDEX",
      "questionIndex must be a non-negative integer",
    );
  }
  const index = Number(rawIndex);
  if (!Number.isSafeInteger(index) || index > 32_767) {
    throw new ApiError(400, "INVALID_QUESTION_INDEX", "questionIndex is outside the valid range");
  }
  return index;
}

function choiceOrderVariant(session: { id: string; choiceOrderVersion: number }): string {
  return session.choiceOrderVersion >= 2 ? session.id : LEGACY_CHOICE_ORDER_VARIANT;
}

async function handleApi(
  request: Request,
  repository: GameRepository,
  quizService: QuizService,
): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (request.method === "GET" && pathname === "/api/health") {
    try {
      await repository.healthCheck();
      return json({ status: "ok", database: "up" });
    } catch (error) {
      console.error("Database health check failed", error);
      return json(
        { error: { code: "DATABASE_UNAVAILABLE", message: "Database is unavailable" } },
        503,
      );
    }
  }

  if (request.method === "GET" && pathname === "/api/quiz/config") {
    return json({ data: quizService.config });
  }

  if (request.method === "POST" && pathname === "/api/quiz/attempts") {
    return json({ data: await quizService.createAttempt() }, 201);
  }

  const quizStartMatch = pathname.match(/^\/api\/quiz\/questions\/([^/]+)\/start$/);
  if (request.method === "POST" && quizStartMatch) {
    const body = await readJsonObject(request);
    return json({
      data: await quizService.startQuestion(
        questionIndex(quizStartMatch[1]),
        quizTokenFrom(body, "progressToken"),
      ),
    });
  }

  const quizGradeMatch = pathname.match(/^\/api\/quiz\/questions\/([^/]+)\/grade$/);
  if (request.method === "POST" && quizGradeMatch) {
    const body = await readJsonObject(request);
    return json({
      data: await quizService.gradeQuestion(
        questionIndex(quizGradeMatch[1]),
        quizTokenFrom(body, "questionToken"),
        quizSelectedOptionFrom(body),
      ),
    });
  }

  if (request.method === "POST" && pathname === "/api/rooms") {
    const body = await readJsonObject(request);
    return json({ data: await repository.createRoom(displayNameFrom(body)) }, 201);
  }

  const roomParticipantsMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/participants$/);
  if (request.method === "POST" && roomParticipantsMatch) {
    const body = await readJsonObject(request);
    const result = await repository.joinRoom(
      roomCode(decodeURIComponent(roomParticipantsMatch[1])),
      displayNameFrom(body),
    );
    broadcast(result.room.id, {
      type: "player_joined",
      participantId: result.participant.id,
      displayName: result.participant.displayName,
      role: result.participant.role,
    });
    return json({ data: result }, 201);
  }

  const roomGenreMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/genre$/);
  if (request.method === "PUT" && roomGenreMatch) {
    const body = await readJsonObject(request);
    const result = await repository.selectGenre(
      roomCode(decodeURIComponent(roomGenreMatch[1])),
      bearerToken(request),
      genreFrom(body),
    );
    broadcast(result.id, { type: "field_selected", genre: result.genre });
    return json({ data: result });
  }

  const participantVisibilityMatch = pathname.match(
    /^\/api\/rooms\/([^/]+)\/participants\/visibility$/,
  );
  if (request.method === "PUT" && participantVisibilityMatch) {
    const body = await readJsonObject(request);
    const result = await repository.setProfileVisibility(
      roomCode(decodeURIComponent(participantVisibilityMatch[1])),
      bearerToken(request),
      isProfilePublicFrom(body),
    );
    return json({ data: result });
  }

  const roomSessionsMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/sessions$/);
  if (request.method === "POST" && roomSessionsMatch) {
    const result = await repository.startSession(
      roomCode(decodeURIComponent(roomSessionsMatch[1])),
      bearerToken(request),
      quizService.config.questionCount,
      quizService.config.answerTimeSeconds,
    );
    broadcast(result.roomId, { type: "host_started", session: result });
    // startSessionの時点で1問目(index 0)がすでに開始されているので、
    // question_startedの配信とタイマー予約もここで行う。
    if (result.currentQuestionIndex !== null) {
      broadcast(result.roomId, {
        type: "question_started",
        sessionId: result.id,
        questionIndex: result.currentQuestionIndex,
        timeLimitSeconds: result.answerTimeSeconds,
        questionStartedAt: result.questionStartedAt,
      });
      scheduleQuestionAdvance(repository, result, quizService.config.reviewTimeSeconds * 1000);
    }
    return json({ data: result }, 201);
  }

  const roomMatch = pathname.match(/^\/api\/rooms\/([^/]+)$/);
  if (request.method === "GET" && roomMatch) {
    const code = roomCode(decodeURIComponent(roomMatch[1]));
    await repository.authenticateParticipant(code, bearerToken(request));
    return json({ data: await repository.getRoom(code) });
  }

  const sessionResultsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/results$/);
  if (request.method === "GET" && sessionResultsMatch) {
    const source = await repository.getSessionResultSource(
      sessionId(decodeURIComponent(sessionResultsMatch[1])),
      bearerToken(request),
    );
    const participants = await Promise.all(source.participants.map(async (participant) => {
      const selectedOptions: (number | null)[] = Array(source.session.questionCount).fill(null);
      for (const answer of participant.answers) {
        if (answer.questionIndex >= 0 && answer.questionIndex < selectedOptions.length) {
          selectedOptions[answer.questionIndex] = answer.selectedOption;
        }
      }
      const score = await quizService.scoreAnswers(
        source.session.questionCount,
        selectedOptions,
        choiceOrderVariant(source.session),
      );
      const responseTimes = participant.answers.map((answer) => answer.responseTimeMs);
      return {
        participantId: participant.participantId,
        displayName: participant.displayName,
        role: participant.role,
        isProfilePublic: participant.isProfilePublic,
        ...score,
        averageResponseTimeMs: responseTimes.length
          ? Math.round(
            responseTimes.reduce((sum, responseTime) => sum + responseTime, 0) /
              responseTimes.length,
          )
          : null,
      };
    }));
    participants.sort((left, right) =>
      right.power - left.power || right.safety - left.safety ||
      (left.averageResponseTimeMs ?? Number.MAX_SAFE_INTEGER) -
        (right.averageResponseTimeMs ?? Number.MAX_SAFE_INTEGER)
    );
    const personal = participants.find((participant) =>
      participant.participantId === source.requesterParticipantId
    );
    if (!personal) {
      throw new ApiError(500, "RESULT_PARTICIPANT_MISSING", "Participant result is missing");
    }
    const categoryNames = [
      ...new Set(participants.flatMap((participant) => Object.keys(participant.categoryScores))),
    ];
    const teamCategoryScores = Object.fromEntries(categoryNames.map((category) => [
      category,
      participants.length
        ? Math.round(
          participants.reduce(
            (sum, participant) => sum + (participant.categoryScores[category] ?? 0),
            0,
          ) / participants.length,
        )
        : 0,
    ]));
    const answeredCount = participants.reduce(
      (sum, participant) => sum + participant.answeredCount,
      0,
    );
    const possibleAnswerCount = participants.length * source.session.questionCount;
    // 非公開に設定した参加者の名前・スコアは、本人以外の一覧からは取り除く。
    const visibleParticipants = participants
      .filter((participant) =>
        participant.isProfilePublic || participant.participantId === source.requesterParticipantId
      )
      .map(({ isProfilePublic: _isProfilePublic, ...visible }) => visible);
    const results: SessionResults = {
      sessionId: source.session.id,
      questionCount: source.session.questionCount,
      personal,
      team: {
        participantCount: participants.length,
        answeredCount,
        possibleAnswerCount,
        completionRate: possibleAnswerCount
          ? Math.round((answeredCount / possibleAnswerCount) * 100)
          : 0,
        power: participants.length
          ? Math.round(
            participants.reduce((sum, participant) => sum + participant.power, 0) /
              participants.length,
          )
          : 0,
        safety: safetyFromCategoryScores(Object.values(teamCategoryScores)),
        categoryScores: teamCategoryScores,
      },
      participants: visibleParticipants,
    };
    return json({ data: results });
  }

  const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if (request.method === "GET" && sessionMatch) {
    return json({
      data: await repository.getSessionForParticipant(
        sessionId(decodeURIComponent(sessionMatch[1])),
        bearerToken(request),
        quizService.config.reviewTimeSeconds,
      ),
    });
  }

  const multiplayerQuizStartMatch = pathname.match(
    /^\/api\/sessions\/([^/]+)\/quiz\/questions\/([^/]+)\/start$/,
  );
  if (request.method === "POST" && multiplayerQuizStartMatch) {
    const requestedIndex = questionIndex(multiplayerQuizStartMatch[2]);
    const session = await repository.getSessionForParticipant(
      sessionId(multiplayerQuizStartMatch[1]),
      bearerToken(request),
      quizService.config.reviewTimeSeconds,
    );
    if (
      session.status === "cancelled" || session.currentQuestionIndex === null ||
      requestedIndex > session.currentQuestionIndex || requestedIndex >= session.questionCount
    ) {
      throw new ApiError(
        409,
        "QUESTION_NOT_AVAILABLE",
        "This question is not available in the room session",
      );
    }

    const body = await readJsonObject(request);
    const revealAt = session.status === "active" &&
        requestedIndex === session.currentQuestionIndex && session.questionStartedAt
      ? Date.parse(session.questionStartedAt) + session.answerTimeSeconds * 1000
      : Date.now();
    return json({
      data: await quizService.startQuestion(
        requestedIndex,
        quizTokenFrom(body, "progressToken"),
        revealAt,
        choiceOrderVariant(session),
      ),
    });
  }

  const startQuestionMatch = pathname.match(
    /^\/api\/sessions\/([^/]+)\/questions\/([^/]+)\/start$/,
  );
  if (request.method === "POST" && startQuestionMatch) {
    const requestedIndex = questionIndex(startQuestionMatch[2]);
    const result = await repository.startQuestion(
      sessionId(startQuestionMatch[1]),
      bearerToken(request),
      requestedIndex,
    );
    broadcast(result.roomId, {
      type: "question_started",
      sessionId: result.id,
      questionIndex: result.currentQuestionIndex ?? requestedIndex,
      timeLimitSeconds: result.answerTimeSeconds,
      questionStartedAt: result.questionStartedAt,
    });
    scheduleQuestionAdvance(repository, result, quizService.config.reviewTimeSeconds * 1000);
    return json({ data: result });
  }

  const answerMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/answers\/([^/]+)$/);
  if (request.method === "PUT" && answerMatch) {
    const body = await readJsonObject(request);
    const result = await repository.submitAnswer(
      sessionId(answerMatch[1]),
      bearerToken(request),
      questionIndex(answerMatch[2]),
      selectedOptionFrom(body),
    );
    // 全員がこの問題に回答し終えていたら、制限時間を待たずに答え合わせへ進める。
    const allAnswered = await repository.haveAllParticipantsAnswered(
      result.gameSessionId,
      result.questionIndex,
    );
    if (allAnswered) {
      triggerEarlyQuestionEnd(result.gameSessionId, result.questionIndex);
    }
    return json({ data: result });
  }

  const completeSessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/complete$/);
  if (request.method === "POST" && completeSessionMatch) {
    const result = await repository.completeSession(
      sessionId(completeSessionMatch[1]),
      bearerToken(request),
    );
    broadcast(result.roomId, { type: "all_questions_done" });
    return json({ data: result });
  }

  throw new ApiError(404, "API_NOT_FOUND", "API endpoint not found");
}

export function createApp(
  repository: GameRepository,
  options: AppOptions = {},
): (request: Request) => Promise<Response> {
  const staticRoot = options.staticRoot ?? "public";
  const assetRoot = options.assetRoot ?? "assets";
  const quizService = options.quizService ?? createQuizService();

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/ws") {
      try {
        const upgraded = await handleWsUpgrade(request, url, repository);
        if (upgraded) return upgraded;
        return apiErrorResponse(
          new ApiError(400, "WS_AUTH_REQUIRED", "WebSocket room and authentication are required"),
        );
      } catch (error) {
        if (error instanceof ApiError) return apiErrorResponse(error);
        throw error;
      }
    }

    if (request.method === "OPTIONS" && pathname.startsWith("/api/")) {
      return new Response(null, {
        status: 204,
        headers: { allow: "GET, POST, PUT, OPTIONS" },
      });
    }

    if (pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, repository, quizService);
      } catch (error) {
        if (error instanceof ApiError) return apiErrorResponse(error);
        if (error instanceof URIError) {
          return apiErrorResponse(new ApiError(400, "INVALID_PATH", "Path is malformed"));
        }
        console.error("Unhandled API error", error);
        return json(
          { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } },
          500,
        );
      }
    }

    if (request.method === "GET" && pathname === "/welcome-message") {
      return new Response("jigインターンへようこそ！");
    }

    if (pathname.startsWith("/assets/")) {
      return secureStaticResponse(
        await serveDir(request, {
          fsRoot: assetRoot,
          urlRoot: "assets",
          showDirListing: false,
          quiet: true,
        }),
      );
    }

    return secureStaticResponse(
      await serveDir(request, {
        fsRoot: staticRoot,
        urlRoot: "",
        showDirListing: false,
        quiet: true,
      }),
    );
  };
}
