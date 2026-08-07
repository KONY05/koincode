import { db } from "@koincode/database/client";
import type { AuxCostEntry } from "@koincode/shared";
import { logger } from "./helpers";

/** Parses a Session `auxCost` value (a JSON array of AuxCostEntry) defensively. */
export function parseAuxCost(raw: string | null): AuxCostEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AuxCostEntry[]) : [];
  } catch {
    return [];
  }
}

/** Appends one auxiliary LLM-call cost record to a session's `auxCost`.
 *  Non-blocking and safe to call for a session id that doesn't exist (incognito
 *  sessions have no rows), so it's fire-and-forget from the call sites. */
export async function appendSessionAuxCost(
  sessionId: string,
  entry: AuxCostEntry,
): Promise<void> {
  try {
    const session = await db.session.findUnique({
      where: { id: sessionId },
      select: { auxCost: true },
    });
    if (!session) return;
    const updated = [...parseAuxCost(session.auxCost), entry];
    await db.session.update({
      where: { id: sessionId },
      data: { auxCost: JSON.stringify(updated) },
    });
  } catch (error) {
    // Cost accounting must never break the caller that incurred the cost.
    logger.error("[session-cost] failed to record aux cost:", error);
  }
}
