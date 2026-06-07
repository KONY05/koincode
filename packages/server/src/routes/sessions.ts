import { Hono } from "hono";
// import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { generateId, generateText } from "ai";

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
  })
  .post("/:id/handoff", async (c) => {
    const id = c.req.param("id");

    const session = await db.session.findUnique({ where: { id } });
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const messageRecords = await db.message.findMany({
      where: { sessionId: id },
      orderBy: { order: "asc" },
    });

    const assistantMessages = messageRecords.filter((m) => m.role === "assistant");

    // Near-empty session: skip summarization, create a plain new session
    if (assistantMessages.length < 2) {
      const newSession = await db.session.create({
        data: {
          title: `Continued: ${session.title}`,
          cwd: session.cwd ?? undefined,
          gitBranch: session.gitBranch ?? undefined,
        },
      });
      return c.json({ sessionId: newSession.id });
    }

    // Extract model from last assistant message metadata
    let model = "claude-opus-4-6";
    const lastAssistant = assistantMessages[assistantMessages.length - 1]!;
    try {
      const parsed = JSON.parse(lastAssistant.content);
      if (parsed?.metadata?.model) model = parsed.metadata.model;
    } catch { /* ignore */ }

    // Build plain-text transcript for the summary prompt
    const conversationText = messageRecords
      .map((m) => {
        try {
          const parsed = JSON.parse(m.content);
          const text = (parsed.parts ?? [])
            .filter((p: { type: string }) => p.type === "text")
            .map((p: { text: string }) => p.text)
            .join("");
          return text ? `${m.role.toUpperCase()}: ${text}` : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .join("\n\n");

    let summaryText = "";
    try {
      const result = await generateText({
        model: resolveChatModel(model).model,
        messages: [
          {
            role: "user",
            content: `Here is a conversation transcript:\n\n${conversationText}\n\nSummarize the work done in this conversation concisely. Focus on:\n- What was built or changed\n- Decisions made and why\n- Any open questions or next steps\nKeep it under 300 words. Write in second person ("You were working on…").`,
          },
        ],
        maxOutputTokens: 500,
      });
      summaryText = result.text.trim();
    } catch (err) {
      logger.error("Failed to generate handoff summary:", err);
      summaryText = "Session context could not be summarized.";
    }

    const newSession = await db.session.create({
      data: {
        title: `Continued: ${session.title}`,
        cwd: session.cwd ?? undefined,
        gitBranch: session.gitBranch ?? undefined,
      },
    });

    // Seed the new session with a synthetic context exchange
    const userMsgId = generateId();
    const assistantMsgId = generateId();
    await db.message.createMany({
      data: [
        {
          id: generateId(),
          sessionId: newSession.id,
          role: "user",
          content: JSON.stringify({
            id: userMsgId,
            role: "user",
            parts: [{ type: "text", text: "Here is a summary of work completed in a previous session. Use this as your starting context." }],
            metadata: {},
          }),
          order: 0,
        },
        {
          id: generateId(),
          sessionId: newSession.id,
          role: "assistant",
          content: JSON.stringify({
            id: assistantMsgId,
            role: "assistant",
            parts: [{ type: "text", text: summaryText }],
            metadata: {},
          }),
          order: 1,
        },
      ],
    });

    return c.json({ sessionId: newSession.id });
  });

export default app;
