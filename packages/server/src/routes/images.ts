import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const imageStore = new Map<string, { base64: string; mimeType: string; filename: string }>();
let counter = 0;

export function getStoredImages(ids: string[]) {
  return ids
    .map((id) => {
      const entry = imageStore.get(id);
      if (!entry) return null;
      return { id, ...entry };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);
}

export function clearStoredImages(ids: string[]) {
  for (const id of ids) {
    imageStore.delete(id);
  }
}

const uploadSchema = z.object({
  base64: z.string(),
  mimeType: z.string(),
  filename: z.string(),
});

const app = new Hono()
  .post(
    "/",
    zValidator("json", uploadSchema, (result, c) => {
      if (!result.success) return c.json({ error: "Invalid image data" }, 400);
    }),
    (c) => {
      const { base64, mimeType, filename } = c.req.valid("json");
      const id = `i${++counter}`;
      imageStore.set(id, { base64, mimeType, filename });
      return c.json({ id });
    },
  );

export default app;
