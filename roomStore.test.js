import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { getRoom, setRoom, deleteRoom } from "./roomStore.js";

const TEST_ROOM_ID = "test-room";

Deno.test("setRoomで書き込んだ内容をgetRoomで取得できる", async () => {
  await setRoom(TEST_ROOM_ID, { players: ["alice", "bob"], turn: 0 });

  const state = await getRoom(TEST_ROOM_ID);
  assertEquals(state, { players: ["alice", "bob"], turn: 0 });
});

Deno.test("存在しない部屋はnullが返る", async () => {
  const state = await getRoom("no-such-room");
  assertEquals(state, null);
});

Deno.test("deleteRoomで削除した部屋はgetRoomでnullになる", async () => {
  await setRoom(TEST_ROOM_ID, { players: [], turn: 0 });
  await deleteRoom(TEST_ROOM_ID);

  const state = await getRoom(TEST_ROOM_ID);
  assertEquals(state, null);
});
