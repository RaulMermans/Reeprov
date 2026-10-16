/**
 * Postgres client singleton for production persistence.
 *
 * - Production (DATABASE_URL set): uses postgres.js with SSL.
 * - Development/test (no DATABASE_URL): caller decides — use file stores.
 * - Production without DATABASE_URL: throws a clear startup error.
 *
 * The client is lazily created and reused across serverless invocations
 * (one pool per container lifetime).
 */

import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

let _sql: Sql | null = null;

/**
 * Returns true if a DATABASE_URL environment variable is configured.
 * Used by store selectors to decide between pg and file-backed stores.
 */
export function hasDatabaseUrl(): boolean {
  return Boolean(process.env["DATABASE_URL"]);
}

/**
 * Returns the shared postgres.js client.
 * Throws if DATABASE_URL is not configured.
 *
 * SSL handling:
 *   - Localhost/127.0.0.1 URLs: no SSL (local dev Postgres).
 *   - All other URLs: ssl='require' (Neon, Vercel Postgres, etc.).
 */
export function getDb(): Sql {
  if (_sql) return _sql;

  const url = process.env["DATABASE_URL"];
  if (!url) {
    throw new Error(
      "[Reeprov] DATABASE_URL is not set. " +
        "Production deployments require a Postgres connection string. " +
        "For local development without a database, leave DATABASE_URL unset and file-backed stores will be used instead.",
    );
  }

  const isLocalhost =
    url.includes("localhost") || url.includes("127.0.0.1");

  _sql = postgres(url, {
    ssl: isLocalhost ? false : "require",
    max: 5,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    connect_timeout: 10,
    // Silence connection-closed warnings in serverless environments.
    onnotice: () => {},
  });

  return _sql;
}

/** For testing: reset the cached client. */
export function _resetDbClient(): void {
  _sql = null;
}

/** For testing: inject a mock database client. */
export function _setDbClient(client: Sql | null): void {
  _sql = client;
}

/** Close the cached client, primarily for one-shot scripts and tests. */
export async function closeDb(): Promise<void> {
  if (!_sql) return;
  const sql = _sql;
  _sql = null;
  await sql.end({ timeout: 5 });
}
