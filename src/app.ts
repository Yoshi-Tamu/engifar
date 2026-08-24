import { serveDir } from "@std/http/file-server";
import { ApiError } from "./errors.ts";
import type { GameRepository } from "./types.ts";

const MAX_JSON_BODY_BYTES = 16 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface AppOptions {
  staticRoot?: string;
}

interface JsonRecord {
  [key: string]: unknown;
}

function json(payload: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return Response.json(payload, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
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

async function handleApi(request: Request, repository: GameRepository): Promise<Response> {
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
    return json({ data: result }, 201);
  }

  const roomSessionsMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/sessions$/);
  if (request.method === "POST" && roomSessionsMatch) {
    const result = await repository.startSession(
      roomCode(decodeURIComponent(roomSessionsMatch[1])),
      bearerToken(request),
    );
    return json({ data: result }, 201);
  }

  const roomMatch = pathname.match(/^\/api\/rooms\/([^/]+)$/);
  if (request.method === "GET" && roomMatch) {
    return json({ data: await repository.getRoom(roomCode(decodeURIComponent(roomMatch[1]))) });
  }

  const startQuestionMatch = pathname.match(
    /^\/api\/sessions\/([^/]+)\/questions\/([^/]+)\/start$/,
  );
  if (request.method === "POST" && startQuestionMatch) {
    const result = await repository.startQuestion(
      sessionId(startQuestionMatch[1]),
      bearerToken(request),
      questionIndex(startQuestionMatch[2]),
    );
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
    return json({ data: result });
  }

  const completeSessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/complete$/);
  if (request.method === "POST" && completeSessionMatch) {
    const result = await repository.completeSession(
      sessionId(completeSessionMatch[1]),
      bearerToken(request),
    );
    return json({ data: result });
  }

  throw new ApiError(404, "API_NOT_FOUND", "API endpoint not found");
}

export function createApp(
  repository: GameRepository,
  options: AppOptions = {},
): (request: Request) => Promise<Response> {
  const staticRoot = options.staticRoot ?? "public";

  return async (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url);

    if (request.method === "OPTIONS" && pathname.startsWith("/api/")) {
      return new Response(null, {
        status: 204,
        headers: { allow: "GET, POST, PUT, OPTIONS" },
      });
    }

    if (pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, repository);
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

    return serveDir(request, {
      fsRoot: staticRoot,
      urlRoot: "",
      showDirListing: false,
      quiet: true,
    });
  };
}
