import { sentry } from "@sentry/hono/bun";
import * as Sentry from "@sentry/bun";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { logger } from "./lib/helpers";
import { initializeMcp, shutdownMcp } from "./lib/mcp-manager";
import { GLOBAL_CONFIG_DIR, DB_PATH, SERVER_PORT } from "@koincode/shared";
// import type { KoincodeConfig } from "@koincode/shared";

import sessions from "./routes/sessions";
import chat from "./routes/chat";
import memory from "./routes/memory";
import localModels from "./routes/local-models";
import mcp from "./routes/mcp";

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

// Ensure config dir exists and run pending migrations before accepting requests
const DATABASE_PKG = path.join(import.meta.dirname, "../../database");
try {
  fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
  execSync("bunx prisma migrate deploy", {
    cwd: DATABASE_PKG,
    env: { ...process.env, DATABASE_URL: `file:${DB_PATH}` },
    stdio: "pipe",
  });
} catch (e) {
  logger.error("Startup failed:", e instanceof Error ? e.message : e);
  process.exit(1);
}

// Non-fatal — server starts even if MCP connections fail
initializeMcp().catch((err) => {
  logger.error("MCP initialization error:", err instanceof Error ? err.message : err);
});

process.on("SIGTERM", async () => {
  await shutdownMcp();
  process.exit(0);
});

const app = new Hono();

if (process.env.NODE_ENV === "production" && process.env.SENTRY_DSN) {
  app.use(sentry(app, { dsn: process.env.SENTRY_DSN, tracesSampleRate: 1.0 }));
}

let lastRequestAt = Date.now();

app.use("*", async (c, next) => {
  lastRequestAt = Date.now();
  await next();
});

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message || "Request failed" }, error.status);
  }

  Sentry.captureException(error);
  logger.error("Unhandled server error", error);
  return c.json({ error: "Internal server error" }, 500);
});

const routes = app
  .get("/health", (c) => c.json({ ok: true }))
  .route("/sessions", sessions)
  .route("/chat", chat)
  .route("/memory", memory)
  .route("/local-models", localModels)
  .route("/mcp", mcp);

export type AppType = typeof routes;

setInterval(() => {
  if (Date.now() - lastRequestAt > IDLE_TIMEOUT_MS) {
    logger.info("Server idle for 30 minutes, shutting down.");
    process.exit(0);
  }
}, 60_000).unref();

// idleTimeout must be high, otherwise LLM tool calls might not complete
const port = Number(process.env.PORT) || SERVER_PORT;
export default { port, fetch: routes.fetch, idleTimeout: 255 };
