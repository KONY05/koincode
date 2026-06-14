import fs from "fs";
import path from "path";
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

export async function runMigrations(migrationsDir: string): Promise<void> {
  const client = createClient({ url: `file:${DB_PATH}` });

  try {
    // Apply final schema — always idempotent, handles new installs and upgrades
    await client.executeMultiple(`
      CREATE TABLE IF NOT EXISTS "_koincode_migrations" (
        "name" TEXT NOT NULL PRIMARY KEY,
        "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS "Session" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "title" TEXT NOT NULL,
        "cwd" TEXT,
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

    if (!fs.existsSync(migrationsDir)) return;

    const applied = await client.execute(`SELECT "name" FROM "_koincode_migrations"`);
    const appliedNames = new Set(applied.rows.map((r) => r[0] as string));

    const entries = fs.readdirSync(migrationsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();

    for (const entry of entries) {
      if (appliedNames.has(entry)) continue;

      if (LEGACY_MIGRATIONS.has(entry)) {
        // Baseline: mark as applied without running
        await client.execute({
          sql: `INSERT OR IGNORE INTO "_koincode_migrations" ("name") VALUES (?)`,
          args: [entry],
        });
        continue;
      }

      // New SQLite-native migration — run it
      const sqlFile = path.join(migrationsDir, entry, "migration.sql");
      if (!fs.existsSync(sqlFile)) continue;

      const sql = fs.readFileSync(sqlFile, "utf-8");
      await client.executeMultiple(sql);
      await client.execute({
        sql: `INSERT INTO "_koincode_migrations" ("name") VALUES (?)`,
        args: [entry],
      });
    }
  } finally {
    client.close();
  }
}
