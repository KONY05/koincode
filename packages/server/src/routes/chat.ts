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
import { getMcpTools, getMcpServerStatus } from "../lib/mcp-manager";
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

  // logger.info(
  //   `Received chat request for session ${id} with ${messages.length} messages`,
  // );

  const session = await db.session.findUnique({
    where: { id },
  });

  if (!session) {
    logger.error(`Session ${id} not found`);
    return c.json({ error: "Session not found" }, 404);
  }

  const startTime = Date.now();
  const tools = { ...getToolContracts(mode), ...getMcpTools() };
  const mcpStatus = getMcpServerStatus();
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

  // Drop consecutive same-role messages. This can happen when onFinish fails to
  // fire after an interrupt, leaving an orphaned user message in the DB with no
  // assistant response. The next submission would then send two user messages in
  // a row, which strict providers (Anthropic) reject. We keep the last message
  // in each consecutive same-role run so the newest user turn always wins.
  const deduped = mergedMessages.filter(
    (msg, i, arr) => i === arr.length - 1 || msg.role !== arr[i + 1]?.role,
  );

  const nextMessages = await validateUIMessages<KoincodeUIMessage>({
    messages: deduped,
    tools,
  });

  // Only persist messages genuinely absent from the DB. We match by UIMessage ID
  // embedded in the content JSON, not by slice offset, because onFinish saves the
  // assistant response asynchronously. If a follow-up request (e.g. tool-result
  // round-trip) arrives before onFinish completes, slice-based detection would
  // re-save the same assistant message and create duplicates.
  const storedMsgIds = new Set(
    parsedRecords
      .map((m) => (m as { id?: string } | null)?.id)
      .filter((msgId): msgId is string => !!msgId),
  );
  const newMessages = nextMessages.filter((m) => !storedMsgIds.has(m.id));

  try {
    if (newMessages.length > 0) {
      await db.$transaction(async (tx) => {
        const { _max } = await tx.message.aggregate({
          where: { sessionId: id },
          _max: { order: true },
        });
        const nextOrder = (_max.order ?? -1) + 1;
        await tx.message.createMany({
          data: newMessages.map((msg, index) => ({
            sessionId: id,
            role: msg.role,
            content: JSON.stringify(msg),
            order: nextOrder + index,
          })),
        });
      });
    }
    // logger.info(
    //   `Persisted ${newMessages.length} new message(s) for session ${id}`,
    // );
  } catch (err) {
    logger.error(`Failed to pre-save messages for session ${id}:`, err);
  }

  const modelMessages = await convertToModelMessages(nextMessages, {
    tools,
  });
  const result = streamText({
    model: resolvedModel.model,
    system: buildSystemPrompt({ mode, userMemory, skillsManifest, mcpServers: mcpStatus }),
    messages: modelMessages,
    tools,
    abortSignal: c.req.raw.signal,
    providerOptions: resolvedModel.providerOptions,
  });

  return result.toUIMessageStreamResponse<KoincodeUIMessage>({
    originalMessages: nextMessages,
    generateMessageId: generateId,
    messageMetadata({ part }) {
      if (part.type === "start") {
        return { mode, model };
      }

      if (part.type !== "finish") return undefined;

      const usage = (part as unknown as { totalUsage?: LanguageModelUsage }).totalUsage;
      return {
        mode,
        model,
        durationMs: Date.now() - startTime,
        ...(usage ? { usage } : {}),
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

          await db.$transaction(async (tx) => {
            // Guard against duplicate saves: the pre-save on the next request can
            // race with this onFinish and already have stored this message by ID.
            const existing = await tx.message.findFirst({
              where: { sessionId: id, content: { contains: `"id":"${responseMessage.id}"` } },
              select: { id: true },
            });
            if (existing) {
              // The pre-save stored this message earlier (e.g. the assistant
              // message with tool calls). onFinish now has the same message ID
              // but with follow-up text appended — update to preserve it.
              await tx.message.update({
                where: { id: existing.id },
                data: { content: JSON.stringify(responseMessage) },
              });
              await tx.session.update({ where: { id }, data: { updatedAt: new Date() } });
              return;
            }
            const { _max } = await tx.message.aggregate({
              where: { sessionId: id },
              _max: { order: true },
            });
            const nextOrder = (_max.order ?? -1) + 1;
            await tx.message.create({
              data: {
                sessionId: id,
                role: responseMessage.role,
                content: JSON.stringify(responseMessage),
                order: nextOrder,
              },
            });
            await tx.session.update({
              where: { id },
              data: { updatedAt: new Date() },
            });
          });
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

    const tools = { ...getToolContracts(mode), ...getMcpTools() };
    const resolvedModel = resolveChatModel(model);

    const result = await generateText({
      model: resolvedModel.model,
      system: buildSystemPrompt({ mode }),
      messages,
      tools,
      stopWhen: stepCountIs(1),
      abortSignal: AbortSignal.timeout(60_000),
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
