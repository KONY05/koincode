import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { getTime } from "./lib/helpers";
import { CONFIG_DIR, DB_PATH, SERVER_PORT } from "@koincode/shared";
// import type { KoincodeConfig } from "@koincode/shared";

import sessions from "./routes/sessions";
import chat from "./routes/chat";
import memory from "./routes/memory";

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;


// Inject config file API keys into the process env so provider SDKs can find them.
// Covers both prod (server-manager injects them) and dev (bun run dev:server, independent).
// try {
//   const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as KoincodeConfig;
//   const k = config.apiKeys ?? {};
//   if (k.anthropic)  process.env.ANTHROPIC_API_KEY            ??= k.anthropic;
//   if (k.openai)     process.env.OPENAI_API_KEY               ??= k.openai;
//   if (k.gemini)     process.env.GOOGLE_GENERATIVE_AI_API_KEY ??= k.gemini;
//   if (k.openrouter) process.env.OPENROUTER_API_KEY           ??= k.openrouter;
// } catch {
//   // Config file absent or malformed — rely on env vars already set in the shell.
// }

// Ensure config dir exists and run pending migrations before accepting requests
const DATABASE_PKG = path.join(import.meta.dirname, "../../database");
try {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  execSync("bunx prisma migrate deploy", {
    cwd: DATABASE_PKG,
    env: { ...process.env, DATABASE_URL: `file:${DB_PATH}` },
    stdio: "pipe",
  });
} catch (e) {
  console.error(`[${getTime()}] Startup failed:`, e instanceof Error ? e.message : e);
  process.exit(1);
}

const app = new Hono();

let lastRequestAt = Date.now();

app.use("*", async (c, next) => {
  lastRequestAt = Date.now();
  await next();
});

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message || "Request failed" }, error.status);
  }

  console.error(`[${getTime()}] Unhandled server error`, error);
  return c.json({ error: "Internal server error" }, 500);
});

const routes = app
  .get("/health", (c) => c.json({ ok: true }))
  .route("/sessions", sessions)
  .route("/chat", chat)
  .route("/memory", memory);

export type AppType = typeof routes;

setInterval(() => {
  if (Date.now() - lastRequestAt > IDLE_TIMEOUT_MS) {
    console.log(`[${getTime()}] Server idle for 30 minutes, shutting down.`);
    process.exit(0);
  }
}, 60_000).unref();

// idleTimeout must be high, otherwise LLM tool calls might not complete
export default { port: SERVER_PORT, fetch: routes.fetch, idleTimeout: 255 };
