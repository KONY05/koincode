import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { CONFIG_DIR, DB_PATH, SERVER_PORT } from "@koincode/shared";

import sessions from "./routes/sessions";
import chat from "./routes/chat";

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

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
  console.error("Startup failed:", e instanceof Error ? e.message : e);
  process.exit(1);
}

const app = new Hono();

let lastRequestAt = Date.now();

// Track last request time for idle shutdown
app.use("*", async (c, next) => {
  lastRequestAt = Date.now();
  await next();
});

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({
      error: error.message || "Request failed",
    }, error.status);
  };

  console.error("Unhandled server error", error);
  return c.json({ error: "Internal server error" }, 500);
});

const routes = app
  .get("/health", (c) => c.json({ ok: true }))
  .route("/sessions", sessions)
  .route("/chat", chat);

export type AppType = typeof routes;

// Shut down after 30 minutes of no activity
setInterval(() => {
  if (Date.now() - lastRequestAt > IDLE_TIMEOUT_MS) {
    console.log("Server idle for 30 minutes, shutting down.");
    process.exit(0);
  }
}, 60_000).unref();

// idleTimeout must be high, otherwise LLM tool calls might not complete
export default { port: SERVER_PORT, fetch: routes.fetch, idleTimeout: 255 };
