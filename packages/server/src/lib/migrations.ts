/**
 * Self-contained migration runner — applies the base schema and any incremental
 * migrations on every server startup.
 *
 * Migrations are embedded as code (not read from disk) so they work identically
 * across all distribution methods: compiled binary, npm install, curl/iex, and dev.
 *
 * To add a new migration:
 *   1. Add an entry to MIGRATIONS with a timestamped key and the SQL string
 *   2. Update the base schema CREATE TABLE statements if it's a structural change
 *      (so fresh installs get the final schema directly without running every migration)
 */

import { createClient } from "@libsql/client";
import { DB_PATH } from "@koincode/shared";

// These were generated when provider = "postgresql" — SQL is not SQLite-compatible.
// They are baselined (marked applied) without being executed.
const LEGACY_MIGRATIONS = new Set([
  "20260528171511_init",
  "20260529172100_add_memory",
  "20260529173837_memory_key_value",
  "20260531000000_session_cwd_branch",
  "20260604201810_add_message_table",
  "20260604202745_remove_messages_json_field",
]);

// Incremental migrations embedded as code. Each key is a timestamped name
// (same convention as Prisma migration directories). The SQL runs once per
// database and is tracked in _koincode_migrations.
//
// Add new migrations here in chronological order:
//   "20260801000000_add_some_column": `ALTER TABLE "Foo" ADD COLUMN "bar" TEXT;`,
const MIGRATIONS: Record<string, string> = {
  "20260715120000_add_session_roots": `ALTER TABLE "Session" ADD COLUMN "roots" TEXT NOT NULL DEFAULT '[]';`,
};

export async function runMigrations(): Promise<void> {
  const client = createClient({ url: `file:${DB_PATH}` });

  try {
    // A fresh install has no tracking table yet — check before creating it below,
    // so we know whether to baseline every embedded migration (fresh install already
    // has the final schema via the CREATE TABLE statements) or actually run the ones
    // an existing install hasn't seen yet.
    const trackingTable = await client.execute(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_koincode_migrations'`,
    );
    const isFreshInstall = trackingTable.rows.length === 0;

    // Base schema — always idempotent, handles new installs and upgrades.
    // When adding a migration that changes table structure, update these
    // statements too so fresh installs get the final schema directly.
    await client.executeMultiple(`
      CREATE TABLE IF NOT EXISTS "_koincode_migrations" (
        "name" TEXT NOT NULL PRIMARY KEY,
        "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS "Session" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "title" TEXT NOT NULL,
        "cwd" TEXT,
        "roots" TEXT NOT NULL DEFAULT '[]',
        "gitBranch" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS "Message" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "sessionId" TEXT NOT NULL,
        "role" TEXT NOT NULL,
        "content" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "order" INTEGER NOT NULL,
        CONSTRAINT "Message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
      CREATE INDEX IF NOT EXISTS "Message_sessionId_idx" ON "Message"("sessionId");
      CREATE TABLE IF NOT EXISTS "Memory" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "key" TEXT NOT NULL,
        "value" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const applied = await client.execute(`SELECT "name" FROM "_koincode_migrations"`);
    const appliedNames = new Set(applied.rows.map((r) => r[0] as string));

    // Baseline legacy migrations (mark as applied without running)
    for (const name of LEGACY_MIGRATIONS) {
      if (appliedNames.has(name)) continue;
      await client.execute({
        sql: `INSERT OR IGNORE INTO "_koincode_migrations" ("name") VALUES (?)`,
        args: [name],
      });
    }

    // Run embedded migrations in order — except on a fresh install, where the base
    // CREATE TABLE statements above already produced the final schema, so applying
    // these too would just re-run (and fail on) changes that already exist.
    const migrationNames = Object.keys(MIGRATIONS).sort();
    for (const name of migrationNames) {
      if (appliedNames.has(name)) continue;

      if (isFreshInstall) {
        await client.execute({
          sql: `INSERT OR IGNORE INTO "_koincode_migrations" ("name") VALUES (?)`,
          args: [name],
        });
        continue;
      }

      await client.executeMultiple(MIGRATIONS[name]!);
      await client.execute({
        sql: `INSERT INTO "_koincode_migrations" ("name") VALUES (?)`,
        args: [name],
      });
    }
  } finally {
    client.close();
  }
}
