import type { RoomState } from "../shared/types.ts";

// Deno KVの動作確認用プレースホルダー。
export async function testKv() {
  const kv = await Deno.openKv();
  await kv.set(["test"], "hello");
  const result = await kv.get(["test"]);
  console.log(result.value); // "hello" と表示されればOK
}

// 部屋の状態(RoomState)を読み書きするラッパー。
const kv = await Deno.openKv();

function roomKey(roomId: string) {
  return ["rooms", roomId];
}

export async function getRoomState(roomId: string): Promise<RoomState | null> {
  const entry = await kv.get<RoomState>(roomKey(roomId));
  return entry.value;
}

export async function setRoomState(roomId: string, state: RoomState) {
  await kv.set(roomKey(roomId), state);
}

export async function deleteRoomState(roomId: string) {
  await kv.delete(roomKey(roomId));
}
