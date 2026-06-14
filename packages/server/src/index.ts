import { sentry } from "@sentry/hono/bun";
import * as Sentry from "@sentry/bun";
import { SENTRY_DSN } from "@koincode/shared";
import fs from "fs";
import path from "path";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { logger } from "./lib/helpers";
import { initializeMcp, shutdownMcp } from "./lib/mcp-manager";
import { SERVER_PORT } from "@koincode/shared";
import { runMigrations } from "./lib/migrations";

import sessions from "./routes/sessions";
import chat from "./routes/chat";
import memory from "./routes/memory";
import localModels from "./routes/local-models";
import mcp from "./routes/mcp";

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

// prod: dist/migrations/  dev: packages/database/prisma/migrations/
const MIGRATIONS_PROD = path.join(import.meta.dirname, "migrations");
const MIGRATIONS_DEV = path.join(import.meta.dirname, "../../database/prisma/migrations");
const MIGRATIONS_DIR = fs.existsSync(MIGRATIONS_PROD) ? MIGRATIONS_PROD : MIGRATIONS_DEV;

try {
  await runMigrations(MIGRATIONS_DIR);
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

if (process.env.NODE_ENV === "production" && SENTRY_DSN) {
  app.use(sentry(app, { dsn: SENTRY_DSN, tracesSampleRate: 1.0 }));
  Sentry.captureException(new Error("Sentry test — koincode prod"));
  await Sentry.flush(2000);
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
