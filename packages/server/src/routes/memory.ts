import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import { db } from "@koincode/database/client";

const createMemorySchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
});

const updateMemorySchema = z.object({
  value: z.string().min(1),
});

const createValidator = zValidator("json", createMemorySchema, (result, c) => {
  if (!result.success) return c.json({ error: "Invalid request body" }, 400);
});

const updateValidator = zValidator("json", updateMemorySchema, (result, c) => {
  if (!result.success) return c.json({ error: "Invalid request body" }, 400);
});

const app = new Hono()
  .get("/", async (c) => {
    const memories = await db.memory.findMany({
      orderBy: { createdAt: "asc" },
    });
    return c.json(memories);
  })
  .post("/", createValidator, async (c) => {
    const { key, value } = c.req.valid("json");
    const memory = await db.memory.create({ data: { key, value } });
    return c.json(memory, 201);
  })
  .patch("/:key", updateValidator, async (c) => {
    const key = c.req.param("key");
    const { value } = c.req.valid("json");

    const existing = await db.memory.findFirst({ where: { key } });
    if (!existing) return c.json({ error: "Memory not found" }, 404);

    const memory = await db.memory.update({
      where: { id: existing.id },
      data: { value },
    });
    return c.json(memory);
  })
  .delete("/:key", async (c) => {
    const key = c.req.param("key");

    const existing = await db.memory.findFirst({ where: { key } });
    if (!existing) return c.json({ error: "Memory not found" }, 404);

    await db.memory.delete({ where: { id: existing.id } });
    return c.json({ ok: true });
  });

export default app;
