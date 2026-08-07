import { Hono } from "hono";

import { getEnrichedSupportedChatModels } from "../lib/models-registry";

const app = new Hono().get("/", (c) => {
  return c.json({ models: getEnrichedSupportedChatModels() });
});

export default app;
