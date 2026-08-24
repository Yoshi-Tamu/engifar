import type { Pool, QueryResultRow } from "pg";

interface Migration {
  version: string;
  url: URL;
}

interface LoadedMigration extends Migration {
  checksum: string;
  sql: string;
}

interface AppliedMigrationRow extends QueryResultRow {
  version: string;
  checksum: string;
}

const migrations: Migration[] = [
  {
    version: "001_initial_schema",
    url: new URL("../../migrations/001_initial_schema.sql", import.meta.url),
  },
  {
    version: "002_strengthen_integrity",
    url: new URL("../../migrations/002_strengthen_integrity.sql", import.meta.url),
  },
];

async function checksum(sql: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sql));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function loadMigrations(): Promise<LoadedMigration[]> {
  return await Promise.all(
    migrations.map(async (migration) => {
      const sql = await Deno.readTextFile(migration.url);
      const canonicalSql = sql.replaceAll("\r\n", "\n");
      return { ...migration, sql, checksum: await checksum(canonicalSql) };
    }),
  );
}

export async function applyMigrations(pool: Pool): Promise<string[]> {
  const loadedMigrations = await loadMigrations();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('engifar_schema_migrations'))");
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version varchar(100) PRIMARY KEY,
         checksum char(64) NOT NULL,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );

    const appliedResult = await client.query<AppliedMigrationRow>(
      "SELECT version, checksum FROM schema_migrations ORDER BY version",
    );
    const knownMigrations = new Map(
      loadedMigrations.map((migration) => [migration.version, migration]),
    );
    const appliedMigrations = new Map(
      appliedResult.rows.map((migration) => [migration.version, migration.checksum.trim()]),
    );

    for (const [version, appliedChecksum] of appliedMigrations) {
      const migration = knownMigrations.get(version);
      if (!migration) {
        throw new Error(`Database contains unknown migration: ${version}`);
      }
      if (migration.checksum !== appliedChecksum) {
        throw new Error(`Migration checksum does not match: ${version}`);
      }
    }

    const newlyApplied: string[] = [];
    for (const migration of loadedMigrations) {
      if (appliedMigrations.has(migration.version)) continue;

      await client.query(migration.sql);
      await client.query(
        "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
        [migration.version, migration.checksum],
      );
      newlyApplied.push(migration.version);
    }

    await client.query("COMMIT");
    return newlyApplied;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
