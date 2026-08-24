import { createPool } from "../src/db/pool.ts";
import { applyMigrations } from "../src/db/migrate.ts";

const pool = createPool();

try {
  const applied = await applyMigrations(pool);
  console.log(
    applied.length > 0 ? `Applied migrations: ${applied.join(", ")}` : "Database is up to date",
  );
} finally {
  await pool.end();
}
