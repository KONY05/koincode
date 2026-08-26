import { Hono } from "hono";
// import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { generateId, type LanguageModelUsage } from "ai";

import { db } from "@koincode/database/client";
import { logger, getLastBoundaryIndex, generateTextWithFallback } from "../lib/helpers";
import { appendSessionAuxCost, parseAuxCost } from "../lib/session-cost";
import { buildCompactionPrompt } from "../prompts/compaction-prompt";
import { buildHandoffPrompt } from "../prompts/handoff-prompt";
import { parseWorkspaceRoots, serializeWorkspaceRoots, makeRootLabel, findRootConflict, type ModelPricing } from "@koincode/shared";


type GeneratedTitle = {
  title: string;
  modelId?: string;
  usage?: LanguageModelUsage;
  pricing?: ModelPricing;
};

/** One-shot title generation using the model user is currently using **/
async function generateTitleFromMessage(message: string, model: string): Promise<GeneratedTitle> {
  const fallbackTitle = message.slice(0, 50) || "New Conversation";
  try {
    if (!message || message.length < 10) {
      return { title: fallbackTitle };
    }

    const result = await generateTextWithFallback(model, {
      prompt: `Generate a concise, descriptive title (max 50 characters) for this conversation based on the user's first message:\n\n${message}\n\nReturn only the title, no quotes or extra text.`,
      // 50 wasn't enough headroom: reasoning-capable free models (e.g. openrouter's free models) spend the whole budget on hidden reasoning
      // tokens and never emit the title itself, silently falling back to the raw prompt.
      maxOutputTokens: 300,
    });

    const title = result.text.trim().slice(0, 50);
    return {
      title: title || fallbackTitle,
      usage: result.usage,
      modelId: result.resolvedModelId,
      pricing: result.pricing,
    };
  } catch (error) {
    logger.error("Failed to generate title:", error);
    return { title: fallbackTitle };
  }
}

const workspaceRootSchema = z.object({ label: z.string(), path: z.string() });

// Below this size, a single-exchange window is carried verbatim on /compact
// instead of being re-stated by a summarizer call (~5k tokens of transcript).
const SINGLE_EXCHANGE_VERBATIM_LIMIT = 20_000;

const createSessionSchema = z.object({
  title: z.string(),
  model: z.string(),
  cwd: z.string().optional(),
  roots: z.array(workspaceRootSchema).optional(),
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

const addRootSchema = z.object({
  path: z.string(),
});

const addRootValidator = zValidator(
  "json",
  addRootSchema,
  (result, c) => {
    if (!result.success) {
      return c.json({ error: "Invalid request body" }, 400);
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
        cwd: true,
        roots: true,
      },
    });

    return c.json(
      sessions.map((s) => ({ ...s, roots: parseWorkspaceRoots(s.roots) })),
    );
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

    // Override auxCost with the parsed array (over the raw string from the spread)
    // so the CLI can fold these extra-LLM-call costs into the info bar session cost.
    return c.json({
      ...session,
      roots: parseWorkspaceRoots(session.roots),
      auxCost: parseAuxCost(session.auxCost),
      messages,
    });
  })
  .post("/", createSessionValidator, async (c) => {
    // MOCK: Uncomment to simulate slow session loading
    // await new Promise((r) => setTimeout(r, 5000))

    // MOCK: Uncomment to simulate session loading error
    // throw new HTTPException(
    //   500,
    //   { message: "Mock error: session loading failed" }
    // )

    const { title, cwd, model, roots, gitBranch } = c.req.valid("json");

    const session = await db.session.create({
      data: {
        title,
        cwd,
        gitBranch,
        ...(roots ? { roots: serializeWorkspaceRoots(roots) } : {}),
      },
    });

    // Generate better title in background without blocking
    generateTitleFromMessage(title, model)
      .then(async ({ title: generatedTitle, usage, modelId, pricing }) => {
        await db.session.update({
          where: { id: session.id },
          data: { title: generatedTitle },
        });
        // The title call is a real model call with token usage/cost — record it
        // in the session's aux cost so the info bar counts it too.
        if (usage) {
          await appendSessionAuxCost(session.id, {
            kind: "title",
            model: modelId ?? model,
            ...(pricing ? { pricing } : {}),
            usage,
          });
        }
      })
      .catch((err) => {
        logger.error(`Failed to update title for session ${session.id}:`, err);
      });

    return c.json({ ...session, roots: parseWorkspaceRoots(session.roots) }, 201);
  })
  .post("/:id/add-root", addRootValidator, async (c) => {
    const id = c.req.param("id");
    const { path } = c.req.valid("json");

    const session = await db.session.findUnique({ where: { id } });

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const existingRoots = parseWorkspaceRoots(session.roots);
    const conflict = findRootConflict(path, existingRoots);

    if (conflict) {
      return c.json(
        { error: `"${path}" overlaps with the existing "${conflict.label}" root` },
        409,
      );
    }

    const updatedRoots = [
      ...existingRoots,
      { label: makeRootLabel(path, existingRoots), path },
    ];

    await db.session.update({
      where: { id },
      data: { roots: serializeWorkspaceRoots(updatedRoots) },
    });

    return c.json({ roots: updatedRoots });
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
  .post("/:id/clear", async (c) => {
    const id = c.req.param("id");

    const session = await db.session.findUnique({ where: { id } });
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const clearedAt = new Date().toISOString();

    await db.$transaction(async (tx) => {
      const { _max } = await tx.message.aggregate({
        where: { sessionId: id },
        _max: { order: true },
      });
      const nextOrder = (_max.order ?? -1) + 1;
      await tx.message.create({
        data: {
          sessionId: id,
          role: "clear_boundary",
          content: JSON.stringify({ type: "clear_boundary", clearedAt }),
          order: nextOrder,
        },
      });
    });

    return c.json({ clearedAt });
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

    // One user row can cover several attempts: routes/chat.ts folds consecutive
    // orphaned user messages (an interrupt or error left them unanswered) into a
    // single row so providers never receive two user turns in a row, recording each
    // pre-merge state in metadata.mergeHistory. Delete is therefore a one-layer undo
    // — peel off just the most recent attempt and restore the row to its previous
    // state, rather than wiping every attempt the row accumulated. Deleting again
    // peels back another layer, until the row is a single never-merged message and
    // the base case below applies.
    // See context/feature-specs/53-preserve-orphaned-messages-on-delete.md
    const parsed = (() => {
      try {
        return JSON.parse(lastUserMessage.content);
      } catch {
        return null;
      }
    })();
    const mergeHistory = parsed?.metadata?.mergeHistory;

    if (Array.isArray(mergeHistory) && mergeHistory.length > 0) {
      const restored = mergeHistory[mergeHistory.length - 1];
      const remaining = mergeHistory.slice(0, -1);

      await db.$transaction([
        // Strictly after, not gte — the row itself is being restored, not removed.
        // An orphaned turn shouldn't have anything after it, but stay symmetric with
        // the base case rather than assume.
        db.message.deleteMany({
          where: {
            sessionId: id,
            order: { gt: lastUserMessage.order },
          },
        }),
        db.message.update({
          where: { id: lastUserMessage.id },
          data: {
            content: JSON.stringify({
              ...parsed,
              id: restored.id,
              parts: restored.parts,
              metadata: {
                ...parsed.metadata,
                // undefined drops the key entirely on stringify, returning the row
                // to the base case once the last layer has been peeled.
                mergeHistory: remaining.length > 0 ? remaining : undefined,
              },
            }),
          },
        }),
        db.session.update({
          where: { id },
          data: { updatedAt: new Date() },
        }),
      ]);

      return c.json({ success: true, restored: true });
    }

    // Base case — a single, never-merged message: delete it and everything after.
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

    return c.json({ success: true, restored: false });
  })
  .post("/:id/compact", async (c) => {
    const id = c.req.param("id");

    const session = await db.session.findUnique({ where: { id } });
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const messageRecords = await db.message.findMany({
      where: { sessionId: id },
      orderBy: { order: "asc" },
    });

    // Slice from the last boundary (clear or compact) so we only summarize the current window.
    const windowRecords = messageRecords.slice(getLastBoundaryIndex(messageRecords) + 1);

    const assistantMessages = windowRecords.filter((m) => m.role === "assistant");

    // Extract model and mode from the last assistant message metadata.
    let model = "claude-sonnet-4-6";
    let mode = "BUILD";
    const lastAssistant = assistantMessages[assistantMessages.length - 1];
    if (lastAssistant) {
      try {
        const parsed = JSON.parse(lastAssistant.content);
        if (parsed?.metadata?.model) model = parsed.metadata.model;
        if (parsed?.metadata?.mode) mode = parsed.metadata.mode;
      } catch { /* ignore */ }
    }

    // Build plain-text transcript for the summary prompt.
    const conversationText = windowRecords
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

    // Capture the summarization call's usage/model so the persisted assistant
    // summary message carries them and counts toward this session's cost.
    let summaryUsage: LanguageModelUsage | undefined;
    let summaryModel: string = model;
    let summaryPricing: ModelPricing | undefined;
    const summary = await (async () => {
      // Summarize whenever there's any real content — a single exchange is still
      // the session's full history, and /compact must not silently discard it.
      // The old <2-assistant-messages guard turned short-session compacts into
      // total amnesia: the persisted summary read "No significant conversation
      // to summarize yet." and the model forgot everything pre-compact.
      if (assistantMessages.length === 0 || !conversationText.trim()) {
        return "No significant conversation to summarize yet.";
      }
      // A single short exchange is carried verbatim: it IS the history, and a
      // summarizer call would spend tokens re-stating it (and can fail on
      // provider rate limits). Only when that one exchange is itself too large
      // for verbatim carry-over to shrink anything does the model summarize.
      if (
        assistantMessages.length < 2 &&
        conversationText.length <= SINGLE_EXCHANGE_VERBATIM_LIMIT
      ) {
        return conversationText;
      }

      try {
        const result = await generateTextWithFallback(model, {
          messages: [
            {
              role: "user",
              content: buildCompactionPrompt(conversationText),
            },
          ],
          maxOutputTokens: 4000,
        });
        summaryUsage = result.usage;
        summaryModel = result.resolvedModelId;
        summaryPricing = result.pricing;
        return result.text.trim();
      } catch (err) {
        logger.error("Failed to generate compact summary:", err);
        return "Context compaction summary could not be generated.";
      }
    })();

    // Post-compact context-size baseline for the client's context-usage bar. The
    // summary row's `usage` is the summarization call's — its inputTokens reflect
    // the pre-compact window the summarizer ran against — so it must not be read
    // as "current context". The summarizer's outputTokens is the real size of the
    // new window's dominant content; fall back to a chars/4 heuristic when the
    // summarization call failed and never reported usage.
    const postCompactTokens =
      summaryUsage?.outputTokens ?? Math.ceil(summary.length / 4);

    const compactedAt = new Date().toISOString();
    const userMsgId = generateId();
    const assistantMsgId = generateId();

    await db.$transaction(async (tx) => {
      const { _max } = await tx.message.aggregate({
        where: { sessionId: id },
        _max: { order: true },
      });
      const nextOrder = (_max.order ?? -1) + 1;
      return tx.message.createMany({
        data: [
          {
            id: generateId(),
            sessionId: id,
            role: "compact_boundary",
            content: JSON.stringify({ type: "compact_boundary", compactedAt }),
            order: nextOrder,
          },
          {
            id: generateId(),
            sessionId: id,
            role: "user",
            content: JSON.stringify({
              id: userMsgId,
              role: "user",
              parts: [{ type: "text", text: "Here is a summary of the work completed so far in this session. Use this as your full context — the prior conversation has been compacted." }],
              metadata: { model, mode },
            }),
            order: nextOrder + 1,
          },
          {
            id: generateId(),
            sessionId: id,
            role: "assistant",
            content: JSON.stringify({
              id: assistantMsgId,
              role: "assistant",
              parts: [{ type: "text", text: summary }],
              metadata: {
                model: summaryModel,
                mode,
                postCompactTokens,
                ...(summaryPricing ? { pricing: summaryPricing } : {}),
                ...(summaryUsage ? { usage: summaryUsage } : {}),
              },
            }),
            order: nextOrder + 2,
          },
        ],
      });
    });

    return c.json({ summary, compactedAt, tokensUsed: postCompactTokens });
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

    // Slice from the last boundary so we only summarize the current window.
    const windowRecords = messageRecords.slice(getLastBoundaryIndex(messageRecords) + 1);

    const assistantMessages = windowRecords.filter((m) => m.role === "assistant");

    // Near-empty session: skip summarization, create a plain new session
    if (assistantMessages.length < 2) {
      const newSession = await db.session.create({
        data: {
          title: `Continued: ${session.title}`,
          cwd: session.cwd ?? undefined,
          roots: session.roots,
          gitBranch: session.gitBranch ?? undefined,
        },
      });
      return c.json({ sessionId: newSession.id });
    }

    // Extract model and mode from last assistant message metadata
    let model;
    let mode = "BUILD";
    const lastAssistant = assistantMessages[assistantMessages.length - 1]!;
    try {
      const parsed = JSON.parse(lastAssistant.content);
      if (parsed?.metadata?.model) model = parsed.metadata.model;
      if (parsed?.metadata?.mode) mode = parsed.metadata.mode;
    } catch { /* ignore */ }

    // Build plain-text transcript for the summary prompt
    const conversationText = windowRecords
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

    // Capture the summarization call's usage/model so the seeded assistant
    // message carries them and counts toward the new session's cost.
    let handoffUsage: LanguageModelUsage | undefined;
    let handoffModel: string | undefined;
    let handoffPricing: ModelPricing | undefined;
    const summaryText = await (async () => {
      try {
        const result = await generateTextWithFallback(model, {
          messages: [
            {
              role: "user",
              content: buildHandoffPrompt(conversationText),
            },
          ],
          maxOutputTokens: 1200,
        });
        handoffUsage = result.usage;
        handoffModel = result.resolvedModelId;
        handoffPricing = result.pricing;
        return result.text.trim();
      } catch (err) {
        logger.error("Failed to generate handoff summary:", err);
        return "Session context could not be summarized.";
      }
    })();

    const newSession = await db.session.create({
      data: {
        title: `Continued: ${session.title}`,
        cwd: session.cwd ?? undefined,
        roots: session.roots,
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
            parts: [{ type: "text", text: "Here is a detailed handoff brief from a previous session. Use this as your complete starting context — you have no access to the prior conversation history." }],
            metadata: { model, mode },
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
            metadata: {
              model: handoffModel ?? model,
              mode,
              ...(handoffPricing ? { pricing: handoffPricing } : {}),
              ...(handoffUsage ? { usage: handoffUsage } : {}),
            },
          }),
          order: 1,
        },
      ],
    });

    return c.json({ sessionId: newSession.id });
  });

export default app;
