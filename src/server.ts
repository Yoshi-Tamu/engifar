import { createApp } from "./app.ts";
import { createPool } from "./db/pool.ts";
import { PostgresGameRepository } from "./db/postgres_game_repository.ts";

export function startServer(): Deno.HttpServer {
  const pool = createPool();
  const repository = new PostgresGameRepository(pool);
  return Deno.serve(createApp(repository));
}
