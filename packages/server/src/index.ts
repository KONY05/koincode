import * as Sentry from "@sentry/bun";
import { SENTRY_DSN } from "@koincode/shared";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { logger } from "./lib/helpers";
import { initializeMcp, shutdownMcp } from "./lib/mcp-manager";
import { SERVER_PORT } from "@koincode/shared";
import { runMigrations } from "./lib/migrations";

import sessions from "./routes/sessions";
import chat from "./routes/chat";
import memory from "./routes/memory";
import ollamaModels from "./routes/ollama-models";
import mcp from "./routes/mcp";
import images from "./routes/images";
import snapshots from "./routes/snapshots";

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

try {
  await runMigrations();
} catch (e) {
  logger.error("Startup failed:", e instanceof Error ? e.message : e);
  process.exit(1);
}

// Non-fatal — server starts even if MCP connections fail
initializeMcp().catch((err) => {
  logger.error(
    "MCP initialization error:",
    err instanceof Error ? err.message : err,
  );
});

process.on("SIGTERM", async () => {
  await shutdownMcp();
  process.exit(0);
});

const app = new Hono();

if (process.env.NODE_ENV === "production" && SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    skipOpenTelemetrySetup: true,
    defaultIntegrations: false,
    enableLogs: true,
    sendDefaultPii: true,
  });
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
  // `version` lets a client detect it's talking to a different build than its own — see the
  // version-skew guard in the CLI's server-manager.ts. Injected via compile.ts's
  // `__KOINCODE_VERSION__` define in compiled binaries; null in dev (`bun --hot`), where the
  // client skips the check because hot-reload keeps the server on current source anyway.
  .get("/health", (c) =>
    c.json({ ok: true, version: process.env.__KOINCODE_VERSION__ ?? null }),
  )
  .route("/sessions", sessions)
  .route("/chat", chat)
  .route("/memory", memory)
  .route("/ollama-models", ollamaModels)
  .route("/mcp", mcp)
  .route("/images", images)
  .route("/snapshots", snapshots);

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
