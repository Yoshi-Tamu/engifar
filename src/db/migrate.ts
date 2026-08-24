import type { Pool } from "pg";

const initialMigrationUrl = new URL(
  "../../migrations/001_initial_schema.sql",
  import.meta.url,
);

export async function applyMigrations(pool: Pool): Promise<void> {
  const migration = await Deno.readTextFile(initialMigrationUrl);
  await pool.query(migration);
}
