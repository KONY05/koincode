import { Hono } from "hono";
// import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@koincode/database/client";

const createSessionSchema = z.object({
  title: z.string(),
  cwd: z.string().optional(),
  gitBranch: z.string().optional(),
});

const listSessionsSchema = z.object({
  cwd: z.string().optional(),
  gitBranch: z.string().optional(),
});

const createSessionValidator = zValidator(
  "json", createSessionSchema, (result, c) => {
  if (!result.success) {
    return c.json({ error: "Invalid request body" }, 400);
  }
});

const listSessionsValidator = zValidator(
  "query", listSessionsSchema, (result, c) => {
  if (!result.success) {
    return c.json({ error: "Invalid query params" }, 400);
  }
});

const app = new Hono()
  .get("/", listSessionsValidator, async (c) => {
    const { cwd, gitBranch } = c.req.valid("query");

    const sessions = await db.session.findMany({
      where: {
        ...(cwd ? { cwd } : {}),
        ...(gitBranch ? { gitBranch } : {}),
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        createdAt: true,
      },
    });

    return c.json(sessions);
  })
  .get("/:id", async (c) => {
    // MOCK: Uncomment to simulate slow session loading
    // await new Promise((r) => setTimeout(r, 5000))

    // MOCK: Uncomment to simulate session loading error
    // throw new HTTPException(
    //   500,
    //   { message: "Mock error: session loading failed" }
    // )

    const id = c.req.param("id");

    const session = await db.session.findUnique({
      where: { id },
    });

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    return c.json(session);
  })
  .post("/", createSessionValidator, async (c) => {
    // MOCK: Uncomment to simulate slow session loading
    // await new Promise((r) => setTimeout(r, 5000))

    // MOCK: Uncomment to simulate session loading error
    // throw new HTTPException(
    //   500,
    //   { message: "Mock error: session loading failed" }
    // )

    const { title, cwd, gitBranch } = c.req.valid("json");

    const session = await db.session.create({
      data: { title, cwd, gitBranch },
    });

    return c.json(session, 201);
  });

export default app;
