// Deno KVを使った「部屋の状態」の読み書きだけを行うラッパー。
// WebSocketやHTTP APIのことはまだ考えず、KVの操作だけに専念する。

const kv = await Deno.openKv();

function roomKey(roomId) {
  return ["rooms", roomId];
}

// 部屋の状態を取得する。存在しない場合は null を返す。
export async function getRoom(roomId) {
  const entry = await kv.get(roomKey(roomId));
  return entry.value;
}

// 部屋の状態を書き込む(なければ新規作成、あれば上書き)。
export async function setRoom(roomId, state) {
  await kv.set(roomKey(roomId), state);
}

// 部屋の状態を削除する。
export async function deleteRoom(roomId) {
  await kv.delete(roomKey(roomId));
}

// KVを明示的に閉じる(テストやスクリプト終了時に使う)。
export function closeKv() {
  kv.close();
}
