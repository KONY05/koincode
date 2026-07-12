import fs from "fs";

import { GLOBAL_CONFIG_DIR, REVIEW_AUTH_FILE } from "@koincode/shared";

// Kept separate from ~/.koincode/config.json (KoincodeGlobalConfig) — that
// file holds provider API keys read through the config module; this is a
// bearer credential for an external service (KOINCODE-Review), not a model
// provider key, so it gets its own file and its own tiny read/write module.
export type ReviewAuth = {
  token: string;
  userId: string;
};

export function readReviewAuth(): ReviewAuth | null {
  try {
    return JSON.parse(fs.readFileSync(REVIEW_AUTH_FILE, "utf8")) as ReviewAuth;
  } catch {
    return null;
  }
}

export function writeReviewAuth(auth: ReviewAuth): void {
  fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(REVIEW_AUTH_FILE, JSON.stringify(auth, null, 2));
}

export function clearReviewAuth(): void {
  try {
    fs.unlinkSync(REVIEW_AUTH_FILE);
  } catch {
    // already gone
  }
}
