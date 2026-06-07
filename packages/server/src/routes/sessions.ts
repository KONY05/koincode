import { Hono } from "hono";
// import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { generateText } from "ai";

import { db } from "@koincode/database/client";
import { resolveChatModel } from "../lib/models";
import { logger } from "../lib/helpers";

/** One-shot title generation using the model user is currently using **/
async function generateTitleFromMessage(message: string, model:string): Promise<string> {
  try {
    if (!message || message.length < 10) {
      return message.slice(0, 50) || "New Conversation";
    }

    const result = await generateText({
      model: resolveChatModel(model).model,
      prompt: `Generate a concise, descriptive title (max 50 characters) for this conversation based on the user's first message:\n\n${message}\n\nReturn only the title, no quotes or extra text.`,
      maxOutputTokens: 50,
    });

    const title = result.text.trim().slice(0, 50);
    return title || message.slice(0, 50);
  } catch (error) {
    logger.error("Failed to generate title:", error);
    return message.slice(0, 50) || "New Conversation";
  }
}

const createSessionSchema = z.object({
  title: z.string(),
  model: z.string(),
  cwd: z.string().optional(),
  gitBranch: z.string().optional(),
});

const listSessionsSchema = z.object({
  cwd: z.string().optional(),
  gitBranch: z.string().optional(),
});

const createSessionValidator = zValidator(
  "json",
  createSessionSchema,
  (result, c) => {
    if (!result.success) {
      return c.json({ error: "Invalid request body" }, 400);
    }
  },
);

const listSessionsValidator = zValidator(
  "query",
  listSessionsSchema,
  (result, c) => {
    if (!result.success) {
      return c.json({ error: "Invalid query params" }, 400);
    }
  },
);

const app = new Hono()
  .get("/", listSessionsValidator, async (c) => {
    const { cwd, gitBranch } = c.req.valid("query");

    const sessions = await db.session.findMany({
      where: {
        ...(cwd ? { cwd } : {}),
        ...(gitBranch ? { gitBranch } : {}),
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        updatedAt: true,
      },
    });

    return c.json(sessions);
  })
  .get("/:id", async (c) => {
    // MOCK: Uncomment to simulate slow session loading
    // await new Promise((r) => setTimeout(r, 5000))

    // MOCK: Uncomment to simulate session loading error
    // throw new HTTPException(
    //   500,
    //   { message: "Mock error: session loading failed" }
    // )

    const id = c.req.param("id");

    const session = await db.session.findUnique({
      where: { id },
    });

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    // Fetch messages from Message table
    const messageRecords = await db.message.findMany({
      where: { sessionId: id },
      orderBy: { order: "asc" },
    });

    // Parse messages from JSON content
    const messages = messageRecords
      .map((m) => {
        try {
          return JSON.parse(m.content);
        } catch {
          return null;
        }
      })
      .filter((m) => m !== null);

    return c.json({ ...session, messages });
  })
  .post("/", createSessionValidator, async (c) => {
    // MOCK: Uncomment to simulate slow session loading
    // await new Promise((r) => setTimeout(r, 5000))

    // MOCK: Uncomment to simulate session loading error
    // throw new HTTPException(
    //   500,
    //   { message: "Mock error: session loading failed" }
    // )

    const { title, cwd, model, gitBranch } = c.req.valid("json");

    const session = await db.session.create({
      data: { title, cwd, gitBranch },
    });

    // Generate better title in background without blocking
    generateTitleFromMessage(title, model)
      .then((generatedTitle) => {
        return db.session.update({
          where: { id: session.id },
          data: { title: generatedTitle },
        });
      })
      .catch((err) => {
        logger.error(`Failed to update title for session ${session.id}:`, err);
      });

    return c.json(session, 201);
  })
  .delete("/:id", async (c) => {
    const id = c.req.param("id");

    const session = await db.session.findUnique({ where: { id } });
    
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    await db.session.delete({ where: { id } });

    return c.json({ success: true });
  })
  .delete("/:id/messages/last-user", async (c) => {
    const id = c.req.param("id");

    // Find the last user message
    const lastUserMessage = await db.message.findFirst({
      where: { sessionId: id, role: "user" },
      orderBy: { order: "desc" },
    });

    if (!lastUserMessage) {
      return c.json({ error: "No user messages found" }, 404);
    }

    // Delete all messages from the last user message onwards and update session timestamp
    await db.$transaction([
      db.message.deleteMany({
        where: {
          sessionId: id,
          order: { gte: lastUserMessage.order },
        },
      }),
      db.session.update({
        where: { id },
        data: { updatedAt: new Date() },
      }),
    ]);

    return c.json({ success: true });
  });

export default app;
