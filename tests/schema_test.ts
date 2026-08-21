import assert from "node:assert/strict";

Deno.test("initial migration creates exactly the five domain tables", async () => {
  const migration = await Deno.readTextFile(
    new URL("../migrations/001_initial_schema.sql", import.meta.url),
  );
  const tables = Array.from(
    migration.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_]+)/g),
    (match) => match[1],
  );

  assert.deepEqual(tables, [
    "room",
    "participant",
    "game_session",
    "session_participant",
    "answer",
  ]);
  assert.match(migration, /UNIQUE \(game_session_id, participant_id, question_index\)/);
  assert.match(migration, /selected_option BETWEEN 0 AND 3/);
});
