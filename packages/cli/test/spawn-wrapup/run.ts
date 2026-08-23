/**
 * Manual harness for the sub-agent forced wrap-up phase.
 *
 * Run from the TARGET workspace (so relative tool paths resolve there):
 *   cd /tmp/spawnwrap-test && bun run /Users/mac/Documents/Code/KOINCODE/packages/cli/test/spawn-wrapup/run.ts
 *
 * Respects Gemini free-tier quota (5 requests/min for gemini-2.5-flash):
 * - Case A ("breach"): maxTurns=2 → at most 2 normal + 3 wrap-up = 5 requests,
 *   forcing a budget breach mid-exploration. Result must carry an honest
 *   wrap-up label.
 * - 65 s cooldown so the next case starts against a fresh quota window.
 * - Case B ("control"): trivial task that concludes naturally in a few
 *   requests — must finish WITHOUT any wrap-up label.
 */

import { runSpawnAgent } from "../../src/tools/spawn-agent";

const ROOTS = [{ label: "spawnwrap-test", path: process.cwd() }];
const MODEL = "gemini-2.5-flash";
const QUOTA_COOLDOWN_MS = 65_000;

const BREACH_TASK =
  "Trace how a customer order flows from placement through payment to shipping " +
  "in this codebase. List every function involved along the way with its file " +
  "path and how errors propagate between steps.";

const CONTROL_TASK =
  "Which module exports placeOrder, and what does chargeCard return when the " +
  "fraud check fails? Answer with file paths.";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCase(
  name: string,
  opts: { maxTurns: number; task: string },
): Promise<string | null> {
  console.log(`\n${"=".repeat(70)}\nCASE ${name} (maxTurns=${opts.maxTurns})\n${"=".repeat(70)}`);
  const started = Date.now();
  try {
    const result = await runSpawnAgent({
      name: `wrapup-${name}`,
      description: "Wrap-up phase verification",
      task: opts.task,
      startingMode: "PLAN",
      model: MODEL,
      roots: ROOTS,
      maxTurns: opts.maxTurns,
    });
    console.log(`[completed in ${((Date.now() - started) / 1000).toFixed(1)}s]\n`);
    console.log(result);
    return result;
  } catch (err) {
    console.log(`[THREW after ${((Date.now() - started) / 1000).toFixed(1)}s]`);
    console.log(err instanceof Error ? err.message : String(err));
    return null;
  }
}

console.log(`quota cooldown: waiting ${QUOTA_COOLDOWN_MS / 1000}s before starting…`);
await sleep(QUOTA_COOLDOWN_MS);
const breach = await runCase("A-breach", { maxTurns: 2, task: BREACH_TASK });

console.log(`\nquota cooldown: waiting ${QUOTA_COOLDOWN_MS / 1000}s before control case…`);
await sleep(QUOTA_COOLDOWN_MS);
const control = await runCase("B-control", { maxTurns: 20, task: CONTROL_TASK });

console.log(`\n${"=".repeat(70)}\nVERDICT\n${"=".repeat(70)}`);
const checks = [
  ["breach ran at all", breach !== null],
  [
    "breach result mentions wrap-up (forced or exhausted)",
    breach !== null && breach.includes("wrap-up"),
  ],
  ["breach result has substantive findings text", breach !== null && breach.length > 200],
  [
    "control finished naturally without wrap-up label",
    control !== null && !control.includes("wrap-up") && control.length > 50,
  ],
] as const;
for (const [label, ok] of checks) {
  console.log(` ${ok ? "PASS" : "FAIL"}  ${label}`);
}
if (checks.some(([, ok]) => !ok)) process.exit(1);
