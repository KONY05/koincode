type ToolPart = { type: string; state?: string; output?: unknown };

/** Distinct writeFile/editFile snapshot hashes (before + after) referenced by a message. */
export function extractSnapshotHashes(message: { parts?: unknown[] }): string[] {
  const hashes = new Set<string>();
  for (const part of (message.parts ?? []) as ToolPart[]) {
    if (part.type !== "tool-writeFile" && part.type !== "tool-editFile") continue;
    if (part.state !== "output-available") continue;
    const snapshot = (part.output as { snapshot?: { beforeHash?: string | null; afterHash?: string } } | undefined)
      ?.snapshot;
    if (!snapshot) continue;
    if (snapshot.beforeHash) hashes.add(snapshot.beforeHash);
    if (snapshot.afterHash) hashes.add(snapshot.afterHash);
  }
  return [...hashes];
}
