#!/usr/bin/env bun
/**
 * RSS harness for oven-sh/bun#39800 — measures native memory growth caused by
 * stack-trace resolution inside a compiled binary built WITH a sourcemap
 * ("linked"/"inline") vs WITHOUT ("none").
 *
 * Simulates Sentry-style capture: throw through a deep call stack, then read
 * err.stack — the operation Bun resolves via the embedded map.
 *
 * Run via ./run.ts, which builds every variant, executes them, computes slopes
 * and cleans up. Env overrides: HARNESS_ITERS / HARNESS_DEPTH / HARNESS_SAMPLE.
 */

const TOTAL = Number(process.env.HARNESS_ITERS ?? 150_000);
const DEPTH = Number(process.env.HARNESS_DEPTH ?? 48);
const SAMPLE = Number(process.env.HARNESS_SAMPLE ?? 5_000);

function recurse(n: number): never {
  if (n <= 0) throw new Error(`boom-${Math.random()}`);
  return recurse(n - 1);
}

/** Touch the stack string like @sentry/bun stack parsing does. */
function resolveStack(err: Error): number {
  const s = err.stack ?? "";
  return s.length + s.split("\n").length;
}

async function main() {
  const rssKb = () => Math.round(process.memoryUsage().rss / 1024);
  console.log(`config iters=${TOTAL} depth=${DEPTH} sampleEvery=${SAMPLE}`);
  console.log(`t=0s\trss=${rssKb()}KB`);

  let checksum = 0;
  const t0 = Date.now();
  for (let i = 1; i <= TOTAL; i++) {
    try {
      recurse(DEPTH);
    } catch (err) {
      checksum += resolveStack(err as Error);
    }
    if (i % SAMPLE === 0) {
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`t=${secs}s\ti=${i}\trss=${rssKb()}KB`);
    }
  }

  Bun.gc(true);
  await new Promise((r) => setTimeout(r, 1000));
  Bun.gc(true);
  console.log(
    `done in ${((Date.now() - t0) / 1000).toFixed(1)}s finalRssAfterGc=${rssKb()}KB checksum=${checksum % 97}`,
  );
}

main();
