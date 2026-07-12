import { z } from "zod";

import { readReviewAuth, clearReviewAuth } from "./review-auth";

// NODE_ENV-gated, same mechanism already used in lib/sentry.ts and
// lib/analytics.ts — no env var or config field, matches KOINCODE-Review's
// own confirmed prod domain (.env.production's APP_URL) and its unconfigured
// `next dev` port for local development.
const REVIEW_API_URL_PROD = "https://koincode-review.vercel.app";
const REVIEW_API_URL_DEV = "http://localhost:3000";

export function getReviewApiUrl(): string {
  return process.env.NODE_ENV === "production"
    ? REVIEW_API_URL_PROD
    : REVIEW_API_URL_DEV;
}

export class ReviewApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ReviewApiError";
    this.status = status;
  }
}

export class ReviewAuthRequiredError extends Error {
  constructor() {
    super("Not logged in to KOINCODE-Review. Run /review-login first.");
    this.name = "ReviewAuthRequiredError";
  }
}

async function reviewFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${getReviewApiUrl()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    signal: AbortSignal.timeout(15_000),
  });
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const auth = readReviewAuth();
  if (!auth) throw new ReviewAuthRequiredError();

  const res = await reviewFetch(path, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${auth.token}` },
  });

  if (res.status === 401) {
    // Stale/revoked token — clear it so the next command's login check fails
    // fast instead of looping on a dead credential.
    clearReviewAuth();
    throw new ReviewAuthRequiredError();
  }

  return res;
}

async function errorMessageFrom(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;

  return typeof body?.error === "string" ? body.error : fallback;
}

// Runtime-validates every successful response against a Zod schema instead of
// trusting an `as X` cast. KOINCODE-Review is a separate repo with its own
// deploy — unlike the local server (typed end-to-end via Hono's hc<AppType>
// in api-client.ts, since that's a same-monorepo import), there's no
// compile-time link between this file's types and that app's route handlers.
// If the two ever drift, this turns a silent wrong-shape bug (undefined
// fields, confusing downstream behavior) into an explicit, immediate error
// naming exactly which call failed.
async function parseResponse<T>(
  schema: z.ZodType<T>,
  res: Response,
  context: string,
): Promise<T> {
  const data = await res.json().catch(() => null);
  const result = schema.safeParse(data);

  if (!result.success) {
    throw new ReviewApiError(
      `Unexpected response from KOINCODE-Review API (${context})`,
      502,
    );
  }

  return result.data;
}

// --- Device auth ---

const startDeviceAuthSchema = z.object({
  deviceCode: z.string(),
  verificationUrl: z.string(),
  expiresIn: z.number(),
  interval: z.number(),
});

export type StartDeviceAuthResult = z.infer<typeof startDeviceAuthSchema>;

export async function startDeviceAuth(): Promise<StartDeviceAuthResult> {
  const res = await reviewFetch("/api/cli/device", { method: "POST" });

  if (!res.ok) {
    throw new ReviewApiError(await errorMessageFrom(res, "Failed to start login"), res.status);
  }

  return parseResponse(startDeviceAuthSchema, res, "start login");
}

const pollDeviceTokenSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("expired") }),
  z.object({ status: z.literal("denied") }),
  z.object({ status: z.literal("approved"), token: z.string(), userId: z.string() }),
]);

export type PollDeviceTokenResult = z.infer<typeof pollDeviceTokenSchema>;

export async function pollDeviceToken(deviceCode: string): Promise<PollDeviceTokenResult> {
  const res = await reviewFetch("/api/cli/device/token", {
    method: "POST",
    body: JSON.stringify({ deviceCode }),
  });

  if (!res.ok) {
    throw new ReviewApiError(await errorMessageFrom(res, "Failed to check login status"), res.status);
  }

  return parseResponse(pollDeviceTokenSchema, res, "poll login status");
}

// --- Repos ---

const connectRepoSchema = z.object({
  success: z.literal(true),
  repo: z.object({
    owner: z.string(),
    name: z.string(),
    fullName: z.string(),
  }),
});

export type ConnectRepoResult = z.infer<typeof connectRepoSchema>;

export async function connectRepo(owner: string, repo: string): Promise<ConnectRepoResult> {
  const res = await authedFetch("/api/cli/repos/connect", {
    method: "POST",
    body: JSON.stringify({ owner, repo }),
  });

  if (!res.ok) {
    throw new ReviewApiError(await errorMessageFrom(res, "Failed to connect repository"), res.status);
  }

  return parseResponse(connectRepoSchema, res, "connect repository");
}

export async function disconnectRepo(owner: string, repo: string): Promise<void> {
  const res = await authedFetch("/api/cli/repos/disconnect", {
    method: "POST",
    body: JSON.stringify({ owner, repo }),
  });

  if (!res.ok) {
    throw new ReviewApiError(await errorMessageFrom(res, "Failed to disconnect repository"), res.status);
  }
}

const repoStatusSchema = z.discriminatedUnion("connected", [
  z.object({ connected: z.literal(false) }),
  z.object({
    connected: z.literal(true),
    indexingStatus: z.string(),
    lastReview: z
      .object({
        status: z.string(),
        prNumber: z.number(),
        prTitle: z.string(),
        createdAt: z.string(),
      })
      .nullable(),
  }),
]);

export type RepoStatus = z.infer<typeof repoStatusSchema>;

export async function getRepoStatus(owner: string, repo: string): Promise<RepoStatus> {
  const query = `owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`;
  const res = await authedFetch(`/api/cli/repos/status?${query}`);

  if (!res.ok) {
    throw new ReviewApiError(await errorMessageFrom(res, "Failed to fetch repository status"), res.status);
  }

  return parseResponse(repoStatusSchema, res, "fetch repository status");
}
