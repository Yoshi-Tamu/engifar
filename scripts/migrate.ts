import { createPool } from "../src/db/pool.ts";

const migrationUrl = new URL("../migrations/001_initial_schema.sql", import.meta.url);
const migration = await Deno.readTextFile(migrationUrl);
const pool = createPool();

try {
  await pool.query(migration);
  console.log("Applied migrations/001_initial_schema.sql");
} finally {
  await pool.end();
}
