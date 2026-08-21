import { Pool } from "pg";

const DEFAULT_POOL_SIZE = 5;
const MAX_POOL_SIZE = 20;

function poolSizeFromEnvironment(): number {
  const value = Number(Deno.env.get("DB_POOL_SIZE") ?? DEFAULT_POOL_SIZE);
  if (!Number.isInteger(value) || value < 1 || value > MAX_POOL_SIZE) {
    throw new Error(`DB_POOL_SIZE must be an integer between 1 and ${MAX_POOL_SIZE}`);
  }
  return value;
}

export function createPool(): Pool {
  const connectionString = Deno.env.get("DATABASE_URL");

  return new Pool({
    ...(connectionString ? { connectionString } : {}),
    max: poolSizeFromEnvironment(),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
}
