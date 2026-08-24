import { createPool } from "../src/db/pool.ts";
import { applyMigrations } from "../src/db/migrate.ts";

const pool = createPool();

try {
  await applyMigrations(pool);
  console.log("Applied migrations/001_initial_schema.sql");
} finally {
  await pool.end();
}
