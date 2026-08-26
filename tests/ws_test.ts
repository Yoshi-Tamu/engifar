import assert from "node:assert/strict";
import { createApp } from "../src/app.ts";
import { startHeartbeatMonitor, stopHeartbeatMonitor } from "../src/ws.ts";
import type {
  AnswerSummary,
  AuthenticatedParticipant,
  GameRepository,
  GameSessionSummary,
  MembershipResult,
  RoomDetail,
  RoomSummary,
  SessionResultSource,
} from "../src/types.ts";

const TOKEN = "test_access_token_that_is_long_enough";
const SECOND_TOKEN = "second_access_token_that_is_long_enough";
const NOW = "2026-08-24T00:00:00.000Z";

const membership: MembershipResult = {
  room: { id: "room-1", code: "ABC234", status: "lobby", genre: "web", createdAt: NOW },
  participant: { id: "participant-1", displayName: "テストユーザー", role: "host", joinedAt: NOW },
  accessToken: TOKEN,
};

class FakeRepository implements GameRepository {
  disconnectedParticipantIds: string[] = [];

  healthCheck(): Promise<void> {
    return Promise.resolve();
  }
  createRoom(): Promise<MembershipResult> {
    return Promise.reject(new Error("not used"));
  }
  joinRoom(): Promise<MembershipResult> {
    return Promise.reject(new Error("not used"));
  }
  getRoom(): Promise<RoomDetail> {
    return Promise.reject(new Error("not used"));
  }
  authenticateParticipant(
    _roomCode: string,
    accessToken: string,
  ): Promise<AuthenticatedParticipant> {
    if (accessToken === TOKEN) {
      return Promise.resolve({ roomId: membership.room.id, participant: membership.participant });
    }
    if (accessToken === SECOND_TOKEN) {
      return Promise.resolve({
        roomId: membership.room.id,
        participant: { ...membership.participant, id: "participant-2", role: "player" },
      });
    }
    throw new Error("invalid token");
  }
  selectGenre(): Promise<RoomSummary> {
    return Promise.reject(new Error("not used"));
  }
  setProfileVisibility(): Promise<import("../src/types.ts").ParticipantSummary> {
    return Promise.reject(new Error("not used"));
  }
  startSession(): Promise<GameSessionSummary> {
    return Promise.reject(new Error("not used"));
  }
  getSessionForParticipant(): Promise<GameSessionSummary> {
    return Promise.reject(new Error("not used"));
  }
  getSessionResultSource(): Promise<SessionResultSource> {
    return Promise.reject(new Error("not used"));
  }
  startQuestion(): Promise<GameSessionSummary> {
    return Promise.reject(new Error("not used"));
  }
  submitAnswer(): Promise<AnswerSummary> {
    return Promise.reject(new Error("not used"));
  }
  completeSession(): Promise<GameSessionSummary> {
    return Promise.reject(new Error("not used"));
  }
  advanceQuestionAutomatically(): Promise<GameSessionSummary | null> {
    return Promise.reject(new Error("not used"));
  }
  completeSessionAutomatically(): Promise<GameSessionSummary | null> {
    return Promise.reject(new Error("not used"));
  }
  haveAllParticipantsAnswered(): Promise<boolean> {
    return Promise.reject(new Error("not used"));
  }

  private alreadyDisconnected = new Set<string>();

  markParticipantDisconnected(participantId: string): Promise<{ roomId: string } | null> {
    // 本物のDB実装(left_at IS NULLでの絞り込み)と同じく、2回目以降はnullを返す。
    if (this.alreadyDisconnected.has(participantId)) {
      return Promise.resolve(null);
    }
    this.alreadyDisconnected.add(participantId);
    this.disconnectedParticipantIds.push(participantId);
    return Promise.resolve({ roomId: membership.room.id });
  }

  deleteExpiredEmptyRooms(): Promise<string[]> {
    return Promise.reject(new Error("not used"));
  }
}

Deno.test("ハートビートが切れると離脱扱いになりplayer_leftが配信される", async () => {
  const repository = new FakeRepository();
  const server = Deno.serve({ port: 8197 }, createApp(repository));
  startHeartbeatMonitor(repository, 20, 50, 30);

  try {
    // 見届け役: 定期的に何か送って自分は生存させ続け、player_left通知を受け取れるようにする。
    const watcher = new WebSocket(
      "ws://localhost:8197/ws?roomCode=ABC234",
      ["engifar-v1", TOKEN],
    );
    const received: { type: string }[] = [];
    watcher.onmessage = (e) => received.push(JSON.parse(e.data));
    await new Promise((resolve) => {
      watcher.onopen = resolve;
    });
    const keepAlive = setInterval(() => watcher.send("keep-alive"), 15);

    // 離脱させる側: 何も送らないので、ハートビートのタイムアウト(50ms)で切断される。
    const victim = new WebSocket(
      "ws://localhost:8197/ws?roomCode=ABC234",
      ["engifar-v1", SECOND_TOKEN],
    );
    await new Promise((resolve) => {
      victim.onopen = resolve;
    });

    const deadline = Date.now() + 1_000;
    while (!received.some((event) => event.type === "player_left") && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    clearInterval(keepAlive);

    assert.deepEqual(repository.disconnectedParticipantIds, ["participant-2"]);
    assert.ok(received.some((event) => event.type === "player_left"));

    watcher.close();
  } finally {
    stopHeartbeatMonitor();
    await server.shutdown();
  }
});

Deno.test("正常にWebSocketを閉じた場合もDB上の離脱処理が呼ばれる", async () => {
  const repository = new FakeRepository();
  const server = Deno.serve({ port: 8196 }, createApp(repository));
  startHeartbeatMonitor(repository, 1_000, 1_000, 30);

  try {
    const ws = new WebSocket(
      "ws://localhost:8196/ws?roomCode=ABC234",
      ["engifar-v1", TOKEN],
    );
    await new Promise((resolve) => {
      ws.onopen = resolve;
    });

    ws.close();
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.deepEqual(repository.disconnectedParticipantIds, [membership.participant.id]);
  } finally {
    stopHeartbeatMonitor();
    await server.shutdown();
  }
});

Deno.test("画面遷移中に再接続すれば離脱扱いにならない", async () => {
  const repository = new FakeRepository();
  const server = Deno.serve({ port: 8195 }, createApp(repository));
  startHeartbeatMonitor(repository, 2_000, 2_000, 500);

  try {
    const first = new WebSocket(
      "ws://localhost:8195/ws?roomCode=ABC234",
      ["engifar-v1", TOKEN],
    );
    await new Promise((resolve) => first.addEventListener("open", resolve, { once: true }));
    first.close();
    await new Promise((resolve) => setTimeout(resolve, 30));

    const reconnected = new WebSocket(
      "ws://localhost:8195/ws?roomCode=ABC234",
      ["engifar-v1", TOKEN],
    );
    await new Promise((resolve) => reconnected.addEventListener("open", resolve, { once: true }));
    await new Promise((resolve) => setTimeout(resolve, 550));
    assert.deepEqual(repository.disconnectedParticipantIds, []);

    reconnected.close();
    await new Promise((resolve) => setTimeout(resolve, 550));
    assert.deepEqual(repository.disconnectedParticipantIds, [membership.participant.id]);
  } finally {
    stopHeartbeatMonitor();
    await server.shutdown();
  }
});
