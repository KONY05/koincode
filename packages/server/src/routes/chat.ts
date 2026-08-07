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
  agentManifestEntrySchema,
  agentWireSchema,
  isToolName,
  resolveAgent,
  resolveToolContracts,
  IMAGE_PLACEHOLDER_RE,
  parseWorkspaceRoots,
  REASONING_EFFORT_LEVELS,
  type AgentDefinition,
  type AgentWire,
  type ChatMessageMetadata,
  type ToolContracts,
} from "@koincode/shared";
import { logger, getLastBoundaryIndex } from "../lib/helpers";
import { appendSessionAuxCost } from "../lib/session-cost";
import { getMcpTools, getMcpServerStatus } from "../lib/mcp-manager";
import { buildSystemPrompt } from "../prompts/system-prompt";
import { isSupportedChatModel, resolveChatModel } from "../lib/models";
import { appendIdeContext, appendSelectionContext, buildCachedSystemMessage, withHistoryCacheControl, withToolsCacheControl } from "../lib/prompt-caching";
import { getStoredImages, clearStoredImages } from "./images";

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

const instructionFileEntrySchema = z.object({
  source: z.union([z.literal("global"), z.object({ label: z.string() })]),
  path: z.string(),
  content: z.string(),
});

/**
 * Turns the request's agent payload into a full `AgentDefinition`. Falls back to
 * resolving `mode` against the built-in registry when no payload is present —
 * which covers older clients and any caller that only knows about BUILD/PLAN.
 */
function toAgentDefinition(wire: AgentWire | undefined, mode: string): AgentDefinition {
  if (!wire) return resolveAgent(mode);
  return {
    ...wire,
    // the spread already carries the value, but the
    // wire type is `string[]` (the schema accepts any string) while `AgentDefinition`
    // wants `ToolName[]`. Narrowed by filtering rather than an `as` assertion: this is
    // network input, so nothing guarantees the names are real, and an unchecked
    // assertion here would let a bogus name travel as a `ToolName` on the type level.
    // Dropping unknown names matches what `resolveToolContracts` does anyway — doing it
    // at the boundary just makes that rule visible where the data arrives.
    //
    // Deliberately permissive rather than rejecting the request: the CLI already drops
    // unknown names at load time, so anything reaching here is version skew (a CLI built
    // against a newer tool list talking to an older long-lived server daemon), and
    // degrading one tool beats 400-ing the whole turn.
    tools: wire.tools.filter(isToolName),
    // Never sent on the wire and never evaluated server-side — the permission overlay is
    // enforced entirely in the CLI. Explicit `undefined` so that stays obvious.
    permission: undefined,
  };
}

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
  // Agent id, not a closed enum — the valid set is whatever the user's
  // .koincode/agents/ directory contains. Unknown ids resolve to BUILD (Decision 10).
  mode: z.string().min(1),
  agent: agentWireSchema.optional(),
  agentsManifest: z.array(agentManifestEntrySchema).optional().default([]),
  model: z.string().refine(isSupportedChatModel, "Unsupported model"),
  reasoningEffort: z.enum(REASONING_EFFORT_LEVELS).optional(),
  browserTools: z.boolean().optional().default(false),
  skillsManifest: z.array(skillManifestEntrySchema).optional().default([]),
  ideActiveFile: z.string().nullable().optional(),
  ideSelection: z
    .object({
      file: z.string(),
      startLine: z.number(),
      endLine: z.number(),
      text: z.string(),
    })
    .nullable()
    .optional(),
  instructionFiles: z.array(instructionFileEntrySchema).optional().default([]),
  // Incognito: no Session/Message rows exist for this id at all — the client sends its
  // full in-memory history every turn instead of relying on a DB-backed rebuild, and
  // `roots` (normally read off the Session row) rides along in the request instead.
  incognito: z.boolean().optional().default(false),
  roots: z
    .array(z.object({ label: z.string(), path: z.string() }))
    .optional(),
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
  const { id, messages, mode, agent: wireAgent, agentsManifest, model, reasoningEffort, browserTools, skillsManifest, ideActiveFile, ideSelection, instructionFiles, incognito, roots: requestRoots } = c.req.valid("json");

  const agent = toAgentDefinition(wireAgent, mode);

  const session = incognito
    ? null
    : await db.session.findUnique({ where: { id } });

  if (!incognito && !session) {
    logger.error(`Session ${id} not found`);
    return c.json({ error: "Session not found" }, 404);
  }

  const startTime = Date.now();
  const tools = { ...resolveToolContracts(agent, browserTools), ...getMcpTools() };
  const mcpStatus = getMcpServerStatus();
  const resolvedModel = await resolveChatModel(model, reasoningEffort);
  const memories = await db.memory.findMany({ orderBy: { createdAt: "asc" } });
  const userMemory =
    memories.length > 0
      ? memories.map((m) => `- ${m.key}: ${m.value}`).join("\n")
      : undefined;

  // Incognito: no Message rows exist for this id, and never will — the client already
  // sent its complete in-memory history (including this turn's new message(s)), so
  // there's nothing to fetch, merge, or pre-save. Just validate it as-is.
  const nextMessages = incognito
    ? await validateUIMessages<KoincodeUIMessage>({ messages, tools })
    : await (async () => {
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

        // Merge consecutive same-role messages instead of dropping the earlier ones.
        // This can happen when onFinish fails to fire after an interrupt, leaving an
        // orphaned user message in the DB with no assistant response. The next
        // submission would then have two user messages in a row, which strict
        // providers (Anthropic) reject. Folding the earlier parts into the newest
        // turn keeps the content instead of silently losing it; the earlier
        // message's id is tracked so its now-redundant DB row can be cleaned up below.
        const mergedAwayIds = new Set<string>();
        const deduped: KoincodeUIMessage[] = [];
        for (const msg of mergedMessages) {
          const prev = deduped[deduped.length - 1];
          if (prev && prev.role === msg.role) {
            mergedAwayIds.add(prev.id);
            // Snapshot what `prev` looked like before this fold (carrying forward any
            // history it had already accumulated) so a later delete can peel back one
            // attempt at a time instead of destroying the whole merged chain. The
            // flattened `parts` below — the only thing the model ever sees — is
            // unchanged by this; mergeHistory is a parallel record for reconstruction.
            const prevHistory = prev.metadata?.mergeHistory ?? [];
            deduped[deduped.length - 1] = {
              ...msg,
              parts: [...prev.parts, ...msg.parts],
              metadata: {
                ...msg.metadata,
                mergeHistory: [...prevHistory, { id: prev.id, parts: prev.parts }],
              },
            };
          } else {
            deduped.push(msg);
          }
        }

        const validated = await validateUIMessages<KoincodeUIMessage>({
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
        const newMessages = validated.filter((m) => !storedMsgIds.has(m.id));

        // DB rows for messages that got folded into a later same-role turn above.
        // Their content now lives inside the merged message being saved below, so the
        // standalone row is redundant and would otherwise be re-merged (and duplicated)
        // on every future request.
        const staleDbIds = messageRecords
          .filter((rec, idx) => {
            const parsedId = (parsedRecords[idx] as { id?: string } | null)?.id;
            return !!parsedId && mergedAwayIds.has(parsedId);
          })
          .map((rec) => rec.id);

        try {
          if (staleDbIds.length > 0) {
            await db.message.deleteMany({ where: { id: { in: staleDbIds } } });
          }
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
        } catch (err) {
          logger.error(`Failed to pre-save messages for session ${id}:`, err);
        }

        return validated;
      })();

  const modelMessages = await convertToModelMessages(nextMessages, {
    tools,
  });

  IMAGE_PLACEHOLDER_RE.lastIndex = 0;
  const imageIds: string[] = [];
  for (let i = modelMessages.length - 1; i >= 0; i--) {
    if (modelMessages[i]!.role !== "user") continue;

    const msg = modelMessages[i]!;
    
    const text = typeof msg.content === "string"
      ? msg.content
      : (msg.content as Array<{ type: string; text?: string }>)
          .filter((p) => p.type === "text")
          .map((p) => p.text ?? "")
          .join(" ");

    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = IMAGE_PLACEHOLDER_RE.exec(text)) !== null) {
      imageIds.push(tagMatch[1]!);
    }
    if (imageIds.length === 0) break;

    const stored = getStoredImages(imageIds);
    if (stored.length > 0) {
      const existingContent = typeof msg.content === "string"
        ? [{ type: "text" as const, text: msg.content }]
        : (msg.content as Array<{ type: string; [key: string]: unknown }>);

      const imageParts = stored.map((img) => ({
        type: "file" as const,
        data: img.base64,
        mediaType: img.mimeType,
        filename: img.filename,
      }));

      (msg as { content: unknown }).content = [...imageParts, ...existingContent];
      clearStoredImages(imageIds);
    }
    break;
  }

  const promptCaching = resolvedModel.promptCaching === true;
  const roots = incognito ? (requestRoots ?? []) : parseWorkspaceRoots(session!.roots);
  const systemPrompt = buildSystemPrompt({ agent, agentsManifest, browserTools, userMemory, skillsManifest, mcpServers: mcpStatus, roots, instructionFiles });
  // Order matters: append the volatile IDE context to the newest message's content
  // *before* marking that message as this turn's cache breakpoint, so the breakpoint's
  // hash covers the final content, not a stale pre-append snapshot.
  const messagesWithIdeContext = appendIdeContext(modelMessages, ideActiveFile ?? null);
  const messagesWithSelection = appendSelectionContext(messagesWithIdeContext, ideSelection ?? null);

  const result = streamText({
    model: resolvedModel.model,
    system: buildCachedSystemMessage(systemPrompt, promptCaching),
    messages: withHistoryCacheControl(messagesWithSelection, promptCaching),
    tools: withToolsCacheControl(tools, promptCaching),
    abortSignal: c.req.raw.signal,
    providerOptions: resolvedModel.providerOptions,
  });

  return result.toUIMessageStreamResponse<KoincodeUIMessage>({
    originalMessages: nextMessages,
    generateMessageId: generateId,
    messageMetadata({ part }) {
      if (part.type === "start") {
        return {
          mode,
          model,
          ...(resolvedModel.contextWindow ? { contextWindow: resolvedModel.contextWindow } : {}),
          ...(resolvedModel.pricing ? { pricing: resolvedModel.pricing } : {}),
        };
      }

      if (part.type !== "finish") return undefined;

      const usage = (part as unknown as { totalUsage?: LanguageModelUsage }).totalUsage;
      return {
        mode,
        model,
        durationMs: Date.now() - startTime,
        ...(resolvedModel.contextWindow ? { contextWindow: resolvedModel.contextWindow } : {}),
        ...(usage ? { usage } : {}),
      };
    },
    onFinish(event) {
      // Incognito: nothing to persist, ever — this id has no Session/Message rows.
      if (incognito) return;

      // Don't await - run in background to avoid blocking the response
      void (async () => {
        // Non-aborted, non-error turns with pending tool calls will be saved by
        // the pre-save on the next request (which includes the completed tool results).
        if (!event.isAborted && event.finishReason !== "error" && hasPendingToolCalls(event.responseMessage))
          return;

        try {
          const isInterrupted = event.isAborted || event.finishReason === "error";

          // When the turn was interrupted (client abort or LLM API error), preserve
          // tool calls in history so they remain visible when the user returns and
          // so the LLM knows what was attempted. Drop parts whose input was still
          // streaming (incomplete data), and mark any still-pending calls as
          // output-error so validateUIMessages accepts them on the next request.
          const responseMessage = isInterrupted
            ? {
                ...event.responseMessage,
                parts: event.responseMessage.parts
                  .filter((part) => {
                    if (
                      part.type === "dynamic-tool" ||
                      part.type.startsWith("tool-")
                    ) {
                      const state = (part as { state?: string }).state;
                      return state !== "input-streaming";
                    }
                    return true;
                  })
                  .map((part) => {
                    if (
                      part.type === "dynamic-tool" ||
                      part.type.startsWith("tool-")
                    ) {
                      const state = (part as { state?: string }).state;
                      if (state !== "output-available" && state !== "output-error") {
                        return { ...part, state: "output-error", errorText: "interrupted" };
                      }
                    }
                    return part;
                  }),
                metadata: {
                  ...event.responseMessage.metadata,
                  interrupted: true,
                },
              }
            : event.responseMessage;

          // Nothing useful to save — skip to avoid persisting empty placeholder rows.
          if (!responseMessage.id || responseMessage.parts.length === 0) return;

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
      if (error instanceof Error) return error.message;
      if (typeof error === "object" && error !== null) {
        const obj = error as Record<string, unknown>;
        if (typeof obj.message === "string") return obj.message;
        try { return JSON.stringify(obj); } catch { /* */ }
      }
      return "An error occurred";
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
  // Agent id, not a closed enum — the valid set is whatever the user's
  // .koincode/agents/ directory contains. Unknown ids resolve to BUILD (Decision 10).
  mode: z.string().min(1),
  agent: agentWireSchema.optional(),
  agentsManifest: z.array(agentManifestEntrySchema).optional().default([]),
  model: z.string().refine(isSupportedChatModel, "Unsupported model"),
  instructionFiles: z.array(instructionFileEntrySchema).optional().default([]),
  // When the sub-agent runs inside a session, the caller passes its id so the
  // step's token usage/cost can be recorded against that session. Optional —
  // sub-agent runs without a session (or incognito) simply don't get recorded.
  sessionId: z.string().optional(),
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
    const {
      messages,
      mode,
      agent: wireAgent,
      model,
      instructionFiles,
      sessionId,
    } = c.req.valid("json");

    const agent = toAgentDefinition(wireAgent, mode);
    const tools = { ...resolveToolContracts(agent), ...getMcpTools() };
    const resolvedModel = await resolveChatModel(model);

    const result = await generateText({
      model: resolvedModel.model,
      system: buildSystemPrompt({ agent, instructionFiles }),
      messages,
      tools,
      stopWhen: stepCountIs(1),
      abortSignal: AbortSignal.timeout(60_000),
      providerOptions: resolvedModel.providerOptions,
    });

    // A sub-agent step is a real model call — record its usage/cost against the
    // session it ran in (fire-and-forget; no-op when no session id / incognito),
    // and hand the usage back so the CLI can reflect it live in the info bar too.
    if (result.usage && sessionId) {
      void appendSessionAuxCost(sessionId, {
        kind: "agent-step",
        model: resolvedModel.modelId,
        ...(resolvedModel.pricing ? { pricing: resolvedModel.pricing } : {}),
        usage: result.usage,
      });
    }

    return c.json({
      text: result.text,
      toolCalls: result.toolCalls,
      finishReason: result.finishReason,
      usage: result.usage,
      model: resolvedModel.modelId,
      ...(resolvedModel.pricing ? { pricing: resolvedModel.pricing } : {}),
    });
  },
);

export default appWithAgentStep;
