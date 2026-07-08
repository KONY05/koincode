import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import { db } from "@koincode/database/client";
import { extractSnapshotHashes } from "../lib/message-snapshots";

const referencedHashesSchema = z.object({
  cwd: z.string().optional(),
});

const referencedHashesValidator = zValidator(
  "query",
  referencedHashesSchema,
  (result, c) => {
    if (!result.success) return c.json({ error: "Invalid query params" }, 400);
  },
);

// Runs at most once a day per project (throttled CLI-side), so a full scan
// over that project's message content is cheap enough that a dedicated
// tracking table isn't worth the extra schema/writes — see spec for the
// reasoning. Scoped to `cwd` so a hash from one project's session never
// protects (or gets confused with) a same-named blob in another project's
// snapshot directory.
const app = new Hono().get(
  "/referenced-hashes",
  referencedHashesValidator,
  async (c) => {
    const { cwd } = c.req.valid("query");

    const messages = await db.message.findMany({
      where: cwd ? { session: { cwd } } : undefined,
      select: { content: true },
    });

    const hashes = new Set<string>();
    for (const { content } of messages) {
      try {
        for (const hash of extractSnapshotHashes(JSON.parse(content))) {
          hashes.add(hash);
        }
      } catch {
        // Not a JSON message (e.g. clear_boundary/compact_boundary marker) — skip.
      }
    }

    return c.json({ hashes: [...hashes] });
  },
);

export default app;
