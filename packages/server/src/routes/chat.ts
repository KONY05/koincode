import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  convertToModelMessages,
  generateId,
  generateText,
  stepCountIs,
  streamText,
  validateUIMessages,
  type ModelMessage,
  type InferUITools,
  type LanguageModelUsage,
  type UIMessage,
} from "ai";

import { db } from "@koincode/database/client";
import {
  getToolContracts,
  modeSchema,
  type ChatMessageMetadata,
  type ToolContracts,
} from "@koincode/shared";
import { logger, getLastBoundaryIndex } from "../lib/helpers";
import { buildSystemPrompt } from "../prompts/system-prompt";
import { isSupportedChatModel, resolveChatModel } from "../lib/models";

type KoincodeUIMessage = UIMessage<
  ChatMessageMetadata,
  never,
  InferUITools<ToolContracts>
>;

const skillManifestEntrySchema = z.object({
  name: z.string(),
  description: z.string(),
  scope: z.enum(["global", "project", "builtin"]),
});

const submitSchema = z.object({
  id: z.string(),
  messages: z
    .array(
      z.custom<KoincodeUIMessage>((value) => {
        return (
          value != null &&
          typeof value === "object" &&
          "id" in value &&
          "parts" in value
        );
      }),
    )
    .min(1),
  mode: modeSchema,
  model: z.string().refine(isSupportedChatModel, "Unsupported model"),
  skillsManifest: z.array(skillManifestEntrySchema).optional().default([]),
});

const submitValidator = zValidator("json", submitSchema, (result, c) => {
  if (!result.success) {
    return c.json({ error: "Invalid request body" }, 400);
  }
});

function hasPendingToolCalls(message: KoincodeUIMessage) {
  return message.parts.some((part) => {
    if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
      const state = (part as { state?: string }).state;
      return state !== "output-available" && state !== "output-error";
    }

    return false;
  });
}


const app = new Hono().post("/", submitValidator, async (c) => {
  const { id, messages, mode, model, skillsManifest } = c.req.valid("json");

  logger.info(
    `Received chat request for session ${id} with ${messages.length} messages`,
  );

  const session = await db.session.findUnique({
    where: { id },
  });

  if (!session) {
    logger.error(`Session ${id} not found`);
    return c.json({ error: "Session not found" }, 404);
  }

  const startTime = Date.now();
  const tools = getToolContracts(mode);
  const resolvedModel = resolveChatModel(model);
  const memories = await db.memory.findMany({ orderBy: { createdAt: "asc" } });
  const userMemory =
    memories.length > 0
      ? memories.map((m) => `- ${m.key}: ${m.value}`).join("\n")
      : undefined;

  // Fetch messages from Message table
  const messageRecords = await db.message.findMany({
    where: { sessionId: id },
    orderBy: { order: "asc" },
  });

  const parsedRecords = messageRecords.map((m) => {
    try {
      return JSON.parse(m.content);
    } catch {
      return null;
    }
  });

  const lastClearIdx = getLastBoundaryIndex(messageRecords);

  const previousMessages = parsedRecords
    .slice(lastClearIdx + 1)
    .filter(
      (m): m is KoincodeUIMessage => m !== null && !!m.id && m.parts.length > 0,
    );

  const mergedMessages = [...previousMessages];

  for (const message of messages) {
    const incomingMessage = {
      ...message,
      metadata: { ...message.metadata, mode, model },
    } satisfies KoincodeUIMessage;

    const existingMessageIndex = mergedMessages.findIndex(
      (m) => m.id === incomingMessage.id,
    );

    if (existingMessageIndex === -1) {
      mergedMessages.push(incomingMessage);
    } else {
      mergedMessages[existingMessageIndex] = incomingMessage;
    }
  }

  const nextMessages = await validateUIMessages<KoincodeUIMessage>({
    messages: mergedMessages,
    tools,
  });

  // Only persist messages that are genuinely new (not already stored in the DB).
  // previousMessages are already in the DB — writing them again would create duplicates.
  const newMessages = nextMessages.slice(previousMessages.length);

  try {
    if (newMessages.length > 0) {
      await db.message.createMany({
        data: newMessages.map((msg, index) => ({
          sessionId: id,
          role: msg.role,
          content: JSON.stringify(msg),
          order: messageRecords.length + index,
        })),
      });
    }
    logger.info(
      `Persisted ${newMessages.length} new message(s) for session ${id}`,
    );
  } catch (err) {
    logger.error(`Failed to pre-save messages for session ${id}:`, err);
  }

  const modelMessages = await convertToModelMessages(nextMessages, {
    tools,
  });
  let completedUsage: LanguageModelUsage | null = null;

  const result = streamText({
    model: resolvedModel.model,
    system: buildSystemPrompt({ mode, userMemory, skillsManifest }),
    messages: modelMessages,
    tools,
    abortSignal: c.req.raw.signal,
    providerOptions: resolvedModel.providerOptions,
    onFinish(event) {
      completedUsage = event.totalUsage;
    },
  });

  return result.toUIMessageStreamResponse<KoincodeUIMessage>({
    originalMessages: nextMessages,
    generateMessageId: generateId,
    messageMetadata({ part }) {
      if (part.type === "start") {
        return { mode, model };
      }

      if (part.type !== "finish") return undefined;

      return {
        mode,
        model,
        durationMs: Date.now() - startTime,
        ...(completedUsage ? { usage: completedUsage } : {}),
      };
    },
    onFinish(event) {
      // Don't await - run in background to avoid blocking the response
      void (async () => {
        if (event.finishReason === "error") return;

        if (!event.isAborted && hasPendingToolCalls(event.responseMessage))
          return;

        try {
          // When aborted mid-tool-call, strip any tool parts that never received a
          // result so the stored message passes validateUIMessages on the next request.
          const responseMessage = event.isAborted
            ? {
                ...event.responseMessage,
                parts: event.responseMessage.parts.filter((part) => {
                  if (
                    part.type === "dynamic-tool" ||
                    part.type.startsWith("tool-")
                  ) {
                    const state = (part as { state?: string }).state;
                    return (
                      state === "output-available" || state === "output-error"
                    );
                  }
                  return true;
                }),
                metadata: {
                  ...event.responseMessage.metadata,
                  interrupted: true,
                },
              }
            : event.responseMessage;

          // Only insert the new response message, not delete and re-insert everything
          // Also update session updatedAt timestamp
          await db.$transaction([
            db.message.create({
              data: {
                sessionId: id,
                role: responseMessage.role,
                content: JSON.stringify(responseMessage),
                order: messageRecords.length + newMessages.length,
              },
            }),
            db.session.update({
              where: { id },
              data: { updatedAt: new Date() },
            }),
          ]);
        } catch (err) {
          logger.error(`Failed to save messages for session ${id}:`, err);
        }
      })();
    },
    onError(error) {
      return error instanceof Error ? error.message : String(error);
    },
    consumeSseStream({ stream }) {
      // Drain the tee'd SSE stream server-side so the pipe chain never backs up
      // when the HTTP client disconnects. Without this, backpressure from the
      // dropped response stalls the chain and onFinish never fires.
      const reader = stream.getReader();
      void (async () => {
        try {
          while (!(await reader.read()).done) {
            /* drain */
          }
        } catch {
          /* ignore */
        }
      })();
    },
  });
});

// ─── /agent-step ─────────────────────────────────────────────────────────────
// Ephemeral, single-step endpoint for sub-agent orchestration.
// No session ID required — messages are passed in directly.

// Permissive schema — the ai SDK's ModelMessage type is complex with recursive generics.
// We validate structural shape loosely and rely on the SDK to reject malformed messages at runtime.
const coreMessageSchema = z.object({
  role: z.enum(["user", "assistant", "tool", "system"]),
  content: z.any(),
}) as z.ZodType<ModelMessage>;

const agentStepSchema = z.object({
  messages: z.array(coreMessageSchema).min(1),
  mode: modeSchema,
  model: z.string().refine(isSupportedChatModel, "Unsupported model"),
});

const agentStepValidator = zValidator("json", agentStepSchema, (result, c) => {
  if (!result.success) {
    return c.json({ error: "Invalid request body" }, 400);
  }
});

const appWithAgentStep = app.post(
  "/agent-step",
  agentStepValidator,
  async (c) => {
    const { messages, mode, model } = c.req.valid("json");

    const tools = getToolContracts(mode);
    const resolvedModel = resolveChatModel(model);

    const result = await generateText({
      model: resolvedModel.model,
      system: buildSystemPrompt({ mode }),
      messages,
      tools,
      stopWhen: stepCountIs(1),
      providerOptions: resolvedModel.providerOptions,
    });

    return c.json({
      text: result.text,
      toolCalls: result.toolCalls,
      finishReason: result.finishReason,
    });
  },
);

export default appWithAgentStep;
