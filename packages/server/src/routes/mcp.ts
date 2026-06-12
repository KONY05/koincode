import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import { callMcpTool, getMcpServerStatus } from "../lib/mcp-manager";

const callMCPSchema = z.object({
  toolName: z.string(),
  args: z.unknown().optional(),
});

const callMCPValidator = zValidator("json", callMCPSchema, (result, c) => {
  if (!result.success) return c.json({ error: "Invalid request body" }, 400);
  },
);

const app = new Hono()

  .get("/servers", (c) => {
    return c.json(getMcpServerStatus());
  })

  .post("/call", callMCPValidator, async (c) => {
    const { toolName, args } = c.req.valid("json");
    const result = await callMcpTool(toolName, args ?? {});
    return c.json({ result });
  });

export default app;
