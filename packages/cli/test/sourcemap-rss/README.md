# sourcemap RSS regression test

Measures the native-memory leak from [oven-sh/bun#39800](https://github.com/oven-sh/bun/issues/39800):
compiled Bun binaries built with an embedded sourcemap leak a small amount of
non-JS-heap memory **every time a stack trace is resolved** (i.e. whenever
`.stack` is read — Sentry captures, error logging). Builds without a sourcemap
plateau instead.

Run it before/after Bun version bumps to check whether the leak is fixed:

```bash
bun run test/sourcemap-rss/run.ts          # builds, runs, reports, cleans up
bun run test/sourcemap-rss/run.ts --keep   # keep binaries in .out/ for inspection
```

It compiles four variants of a deep-stack error loop (small bundle and a
~1.9MB-source bundle, each with `sourcemap: none` and `linked`), runs 150k
resolutions through each, and reports late-phase RSS growth per resolution
(second half of the run, so JIT warmup is excluded).

## Reference results

2026-08-22, Bun 1.3.14, macOS arm64, 48-frame stacks:

| Variant              | Growth            |
| -------------------- | ----------------- |
| small bundle, none   | ~0 (plateaus)     |
| small bundle, linked | ~212 B/resolution |
| big bundle, none     | ~0 (plateaus)     |
| big bundle, linked   | ~305 B/resolution |

Key findings:

- The leak is a **per-resolution fixed cost**, not proportional to map size
  (a ~1000× bigger map only moved it 212 → 305 B).
- Symbolication works: `linked` stacks show real `file.ts:line`, `none` shows
  minified `/$bunfs/root/*.js` positions.
- Embedded map cost: ~+0.8MB binary per 1.9MB of source (zstd).
- At realistic error rates (~10k resolved stacks/day) growth is ~3MB/day —
  why `sourcemap: "linked"` stays enabled in `bin/compile.ts`.

Re-check these numbers whenever Bun is upgraded; if the `linked` rows plateau,
the bug is fixed and the caveat in compile.ts can be removed.
