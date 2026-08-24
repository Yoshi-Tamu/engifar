import assert from "node:assert/strict";
import { createApp } from "../src/app.ts";
import type {
  AnswerSummary,
  GameRepository,
  GameSessionSummary,
  MembershipResult,
  RoomDetail,
} from "../src/types.ts";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "test_access_token_that_is_long_enough";
const NOW = "2026-08-21T00:00:00.000Z";

const membership: MembershipResult = {
  room: {
    id: "22222222-2222-4222-8222-222222222222",
    code: "ABC234",
    status: "lobby",
    genre: "web",
    createdAt: NOW,
  },
  participant: {
    id: "33333333-3333-4333-8333-333333333333",
    displayName: "テストユーザー",
    role: "host",
    joinedAt: NOW,
  },
  accessToken: TOKEN,
};

const session: GameSessionSummary = {
  id: SESSION_ID,
  roomId: membership.room.id,
  sessionNumber: 1,
  status: "active",
  questionCount: 12,
  answerTimeSeconds: 15,
  currentQuestionIndex: 0,
  questionStartedAt: NOW,
  startedAt: NOW,
  finishedAt: null,
};

class FakeRepository implements GameRepository {
  createdDisplayName: string | null = null;
  joinedRoomCode: string | null = null;
  submittedOption: number | null = null;

  healthCheck(): Promise<void> {
    return Promise.resolve();
  }

  createRoom(displayName: string): Promise<MembershipResult> {
    this.createdDisplayName = displayName;
    return Promise.resolve(membership);
  }

  joinRoom(code: string, _displayName: string): Promise<MembershipResult> {
    this.joinedRoomCode = code;
    return Promise.resolve(membership);
  }

  getRoom(_code: string): Promise<RoomDetail> {
    return Promise.resolve({ ...membership.room, participants: [membership.participant] });
  }

  startSession(_code: string, _accessToken: string): Promise<GameSessionSummary> {
    return Promise.resolve(session);
  }

  startQuestion(
    _sessionId: string,
    _accessToken: string,
    questionIndex: number,
  ): Promise<GameSessionSummary> {
    return Promise.resolve({ ...session, currentQuestionIndex: questionIndex });
  }

  submitAnswer(
    _sessionId: string,
    _accessToken: string,
    questionIndex: number,
    selectedOption: number,
  ): Promise<AnswerSummary> {
    this.submittedOption = selectedOption;
    return Promise.resolve({
      id: "44444444-4444-4444-8444-444444444444",
      gameSessionId: SESSION_ID,
      participantId: membership.participant.id,
      questionIndex,
      selectedOption,
      responseTimeMs: 500,
      answeredAt: NOW,
    });
  }

  completeSession(_sessionId: string, _accessToken: string): Promise<GameSessionSummary> {
    return Promise.resolve({ ...session, status: "completed", finishedAt: NOW });
  }
}

function jsonRequest(path: string, method: string, body: unknown, token?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: JSON.stringify(body),
  });
}

Deno.test("GET /api/health reports a healthy database", async () => {
  const response = await createApp(new FakeRepository())(
    new Request("http://localhost/api/health"),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", database: "up" });
});

Deno.test("POST /api/rooms trims the display name", async () => {
  const repository = new FakeRepository();
  const response = await createApp(repository)(
    jsonRequest("/api/rooms", "POST", { displayName: "  テストユーザー  " }),
  );

  assert.equal(response.status, 201);
  assert.equal(repository.createdDisplayName, "テストユーザー");
  assert.equal((await response.json()).data.room.code, "ABC234");
});

Deno.test("POST /api/rooms requires JSON", async () => {
  const response = await createApp(new FakeRepository())(
    new Request("http://localhost/api/rooms", { method: "POST", body: "name=test" }),
  );

  assert.equal(response.status, 415);
  assert.equal((await response.json()).error.code, "JSON_REQUIRED");
});

Deno.test("POST /api/rooms limits streamed JSON without Content-Length", async () => {
  const oversizedJson = JSON.stringify({ displayName: "a".repeat(17 * 1024) });
  const response = await createApp(new FakeRepository())(
    new Request("http://localhost/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(oversizedJson));
          controller.close();
        },
      }),
    }),
  );

  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, "BODY_TOO_LARGE");
});

Deno.test("joining a room normalizes its code", async () => {
  const repository = new FakeRepository();
  const response = await createApp(repository)(
    jsonRequest("/api/rooms/abc234/participants", "POST", { displayName: "player" }),
  );

  assert.equal(response.status, 201);
  assert.equal(repository.joinedRoomCode, "ABC234");
});

Deno.test("starting a session requires a bearer token", async () => {
  const response = await createApp(new FakeRepository())(
    new Request("http://localhost/api/rooms/ABC234/sessions", { method: "POST" }),
  );

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "AUTHENTICATION_REQUIRED");
});

Deno.test("answer option must be one of four zero-based indexes", async () => {
  const response = await createApp(new FakeRepository())(
    jsonRequest(
      `/api/sessions/${SESSION_ID}/answers/0`,
      "PUT",
      { selectedOption: 4 },
      TOKEN,
    ),
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_SELECTED_OPTION");
});

Deno.test("an answer is passed to the repository", async () => {
  const repository = new FakeRepository();
  const response = await createApp(repository)(
    jsonRequest(
      `/api/sessions/${SESSION_ID}/answers/0`,
      "PUT",
      { selectedOption: 2 },
      TOKEN,
    ),
  );

  assert.equal(response.status, 200);
  assert.equal(repository.submittedOption, 2);
  assert.equal((await response.json()).data.responseTimeMs, 500);
});
