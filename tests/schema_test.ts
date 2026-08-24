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

Deno.test("integrity migration strengthens deletion and answer range rules", async () => {
  const migration = await Deno.readTextFile(
    new URL("../migrations/002_strengthen_integrity.sql", import.meta.url),
  );

  assert.match(migration, /ON DELETE NO ACTION\s+DEFERRABLE INITIALLY DEFERRED/);
  assert.match(migration, /CREATE TRIGGER answer_question_index_within_session/);
  assert.match(migration, /NEW\.question_index >= session_question_count/);
  assert.match(migration, /CREATE TRIGGER game_session_question_count_covers_answers/);
});
