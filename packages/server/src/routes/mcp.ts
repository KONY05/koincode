import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import { callMcpTool, getMcpServerStatus, setServerEnabled } from "../lib/mcp-manager";

const callMCPSchema = z.object({
  toolName: z.string(),
  args: z.unknown().optional(),
});

const callMCPValidator = zValidator("json", callMCPSchema, (result, c) => {
  if (!result.success) return c.json({ error: "Invalid request body" }, 400);
  },
);

const listServersSchema = z.object({
  includeDisabled: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

const listServersValidator = zValidator("query", listServersSchema, (result, c) => {
  if (!result.success) return c.json({ error: "Invalid query params" }, 400);
});

const setEnabledSchema = z.object({
  enabled: z.boolean(),
});

const setEnabledValidator = zValidator("json", setEnabledSchema, (result, c) => {
  if (!result.success) return c.json({ error: "Invalid request body" }, 400);
});

const app = new Hono()

  .get("/servers", listServersValidator, (c) => {
    const { includeDisabled } = c.req.valid("query");
    return c.json(getMcpServerStatus(includeDisabled));
  })

  .post("/servers/:name/enabled", setEnabledValidator, async (c) => {
    const name = c.req.param("name");
    const { enabled } = c.req.valid("json");
    try {
      const status = await setServerEnabled(name, enabled);
      return c.json(status);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 404);
    }
  })

  .post("/call", callMCPValidator, async (c) => {
    const { toolName, args } = c.req.valid("json");
    const result = await callMcpTool(toolName, args ?? {});
    return c.json({ result });
  });

export default app;
