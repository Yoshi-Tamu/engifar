import assert from "node:assert/strict";
import { Pool } from "pg";
import { applyMigrations } from "../src/db/migrate.ts";
import { PostgresGameRepository } from "../src/db/postgres_game_repository.ts";
import { ApiError } from "../src/errors.ts";

interface DatabaseFixture {
  pool: Pool;
  repository: PostgresGameRepository;
}

const envPermission = await Deno.permissions.query({
  name: "env",
  variable: "TEST_DATABASE_URL",
});
const testDatabaseUrl = envPermission.state === "granted"
  ? Deno.env.get("TEST_DATABASE_URL")
  : undefined;

async function withDatabaseFixture(
  test: (fixture: DatabaseFixture) => Promise<void>,
): Promise<void> {
  if (!testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");
  }

  const schemaName = `engifar_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const adminPool = new Pool({ connectionString: testDatabaseUrl, max: 1 });
  let testPool: Pool | undefined;

  try {
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    testPool = new Pool({
      connectionString: testDatabaseUrl,
      max: 5,
      options: `-c search_path=${schemaName}`,
    });
    await applyMigrations(testPool);

    await test({
      pool: testPool,
      repository: new PostgresGameRepository(testPool),
    });
  } finally {
    try {
      if (testPool) await testPool.end();
    } finally {
      try {
        await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      } finally {
        await adminPool.end();
      }
    }
  }
}

function databaseTest(
  name: string,
  test: (fixture: DatabaseFixture) => Promise<void>,
): void {
  Deno.test({
    name,
    ignore: !testDatabaseUrl,
    fn: () => withDatabaseFixture(test),
  });
}

async function assertApiError(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, code);
    return true;
  });
}

async function assertDatabaseConstraint(
  promise: Promise<unknown>,
  constraint: string,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(typeof error === "object" && error !== null);
    assert.ok("code" in error);
    assert.equal(error.code, "23514");
    assert.ok("constraint" in error);
    assert.equal(error.constraint, constraint);
    return true;
  });
}

databaseTest("PostgreSQL repository creates a lobby and snapshots its participants", async ({
  pool,
  repository,
}) => {
  const host = await repository.createRoom("Host");
  const player = await repository.joinRoom(host.room.code, "Player");

  assert.match(host.room.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(host.participant.role, "host");
  assert.equal(player.participant.role, "player");

  const lobby = await repository.getRoom(host.room.code);
  assert.deepEqual(
    lobby.participants.map((participant) => participant.displayName).sort(),
    ["Host", "Player"],
  );

  const session = await repository.startSession(host.room.code, host.accessToken);
  assert.equal(session.status, "active");
  assert.equal(session.currentQuestionIndex, 0);
  assert.ok(session.questionStartedAt);

  const snapshot = await pool.query<{ count: number }>(
    "SELECT count(*)::integer AS count FROM session_participant WHERE game_session_id = $1",
    [session.id],
  );
  assert.equal(snapshot.rows[0].count, 2);

  const room = await repository.getRoom(host.room.code);
  assert.equal(room.status, "playing");
  await assertApiError(
    repository.joinRoom(host.room.code, "Late player"),
    "ROOM_NOT_JOINABLE",
  );
});

databaseTest("PostgreSQL repository upserts one answer per participant and question", async ({
  pool,
  repository,
}) => {
  const host = await repository.createRoom("Host");
  const player = await repository.joinRoom(host.room.code, "Player");
  const session = await repository.startSession(host.room.code, host.accessToken);

  const firstAnswer = await repository.submitAnswer(session.id, player.accessToken, 0, 1);
  const changedAnswer = await repository.submitAnswer(session.id, player.accessToken, 0, 3);

  assert.equal(changedAnswer.id, firstAnswer.id);
  assert.equal(changedAnswer.selectedOption, 3);
  assert.ok(changedAnswer.responseTimeMs >= firstAnswer.responseTimeMs);

  const storedAnswers = await pool.query<{
    selected_option: number;
    count: number;
  }>(
    `SELECT max(selected_option)::integer AS selected_option, count(*)::integer AS count
     FROM answer
     WHERE game_session_id = $1 AND participant_id = $2`,
    [session.id, player.participant.id],
  );
  assert.equal(storedAnswers.rows[0].count, 1);
  assert.equal(storedAnswers.rows[0].selected_option, 3);
});

databaseTest("PostgreSQL repository rejects expired, inactive, and unauthorized answers", async ({
  pool,
  repository,
}) => {
  const host = await repository.createRoom("Host");
  const player = await repository.joinRoom(host.room.code, "Player");
  const outsider = await repository.createRoom("Outsider");
  const session = await repository.startSession(host.room.code, host.accessToken);

  await assertApiError(
    repository.submitAnswer(session.id, outsider.accessToken, 0, 1),
    "PARTICIPANT_REQUIRED",
  );
  await assertApiError(
    repository.submitAnswer(session.id, player.accessToken, 1, 1),
    "QUESTION_NOT_ACTIVE",
  );

  await pool.query(
    "UPDATE game_session SET question_started_at = clock_timestamp() - interval '16 seconds' WHERE id = $1",
    [session.id],
  );
  const originalDateNow = Date.now;
  Date.now = () => 0;
  try {
    await assertApiError(
      repository.submitAnswer(session.id, player.accessToken, 0, 1),
      "ANSWER_TIME_EXPIRED",
    );
  } finally {
    Date.now = originalDateNow;
  }
});

databaseTest("session transitions use the PostgreSQL clock", async ({ pool, repository }) => {
  const host = await repository.createRoom("Host");
  const session = await repository.startSession(host.room.code, host.accessToken);
  await pool.query(
    "UPDATE game_session SET question_started_at = clock_timestamp() - interval '16 seconds' WHERE id = $1",
    [session.id],
  );

  const originalDateNow = Date.now;
  Date.now = () => 0;
  try {
    const nextQuestion = await repository.startQuestion(session.id, host.accessToken, 1);
    assert.equal(nextQuestion.currentQuestionIndex, 1);

    await pool.query(
      `UPDATE game_session
       SET current_question_index = question_count - 1,
           question_started_at = clock_timestamp() - interval '16 seconds'
       WHERE id = $1`,
      [session.id],
    );
    const completed = await repository.completeSession(session.id, host.accessToken);
    assert.equal(completed.status, "completed");
  } finally {
    Date.now = originalDateNow;
  }
});

databaseTest("the database rejects answers outside the session question range", async ({
  pool,
  repository,
}) => {
  const host = await repository.createRoom("Host");
  const player = await repository.joinRoom(host.room.code, "Player");
  const session = await repository.startSession(host.room.code, host.accessToken);

  await assertDatabaseConstraint(
    pool.query(
      `INSERT INTO answer (
         game_session_id, participant_id, question_index, selected_option, response_time_ms
       ) VALUES ($1, $2, $3, $4, $5)`,
      [session.id, player.participant.id, session.questionCount, 1, 0],
    ),
    "answer_question_index_within_session",
  );

  await pool.query(
    `INSERT INTO answer (
       game_session_id, participant_id, question_index, selected_option, response_time_ms
     ) VALUES ($1, $2, $3, $4, $5)`,
    [session.id, player.participant.id, session.questionCount - 1, 1, 0],
  );
  await assertDatabaseConstraint(
    pool.query("UPDATE game_session SET question_count = question_count - 1 WHERE id = $1", [
      session.id,
    ]),
    "answer_question_index_within_session",
  );
});

databaseTest("deleting a room cascades through its session history", async ({
  pool,
  repository,
}) => {
  const host = await repository.createRoom("Host");
  const player = await repository.joinRoom(host.room.code, "Player");
  const session = await repository.startSession(host.room.code, host.accessToken);
  await repository.submitAnswer(session.id, player.accessToken, 0, 2);

  await pool.query("DELETE FROM room WHERE id = $1", [host.room.id]);

  for (const table of ["room", "participant", "game_session", "session_participant", "answer"]) {
    const result = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM ${table}`,
    );
    assert.equal(result.rows[0].count, 0, `${table} should be empty`);
  }
});

databaseTest("concurrent session starts create only one active session", async ({
  pool,
  repository,
}) => {
  const host = await repository.createRoom("Host");
  const results = await Promise.allSettled([
    repository.startSession(host.room.code, host.accessToken),
    repository.startSession(host.room.code, host.accessToken),
  ]);

  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);

  const error = (rejected[0] as PromiseRejectedResult).reason;
  assert.ok(error instanceof ApiError);
  assert.equal(error.code, "SESSION_ALREADY_STARTED");

  const activeSessions = await pool.query<{ count: number }>(
    "SELECT count(*)::integer AS count FROM game_session WHERE room_id = $1 AND status = 'active'",
    [host.room.id],
  );
  assert.equal(activeSessions.rows[0].count, 1);
});

databaseTest(
  "PostgreSQL migrations are tracked and can be applied repeatedly",
  async ({ pool }) => {
    const reapplied = await applyMigrations(pool);
    assert.deepEqual(reapplied, []);

    const appliedMigrations = await pool.query<{ version: string; checksum: string }>(
      "SELECT version, checksum FROM schema_migrations ORDER BY version",
    );
    assert.deepEqual(
      appliedMigrations.rows.map((row) => row.version),
      ["001_initial_schema", "002_strengthen_integrity"],
    );
    assert.ok(appliedMigrations.rows.every((row) => /^[0-9a-f]{64}$/.test(row.checksum)));

    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
    );
    assert.deepEqual(
      tables.rows.map((row) => row.table_name),
      ["answer", "game_session", "participant", "room", "schema_migrations", "session_participant"],
    );
  },
);

databaseTest("PostgreSQL migration checksums detect edited migration files", async ({ pool }) => {
  await pool.query(
    "UPDATE schema_migrations SET checksum = repeat('0', 64) WHERE version = '001_initial_schema'",
  );
  await assert.rejects(
    applyMigrations(pool),
    /Migration checksum does not match: 001_initial_schema/,
  );
});
