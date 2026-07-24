import { createRequire } from "module";
import { resolve as resolvePath, dirname } from "path";
import { addDefaultParsers, getTreeSitterClient } from "@opentui/core";

// tree-sitter can't load its bundled WASM/worker assets from Bun's compiled-binary virtual
// filesystem (`/$bunfs/`). The hard *crash* that used to take down the whole binary at startup
// happened inside @opentui/core's own module load (a top-level `await` resolving bundled asset
// paths) and is fixed upstream via patches/@opentui%2Fcore@0.4.5.patch — see the compiled-binary
// crash entry in progress-tracker.md.
//
// This flag is the secondary, KOINCODE-side half: even with the crash patched, calling
// getTreeSitterClient() auto-starts a parser worker on construction (module-level singleton,
// `autoStartWorker` defaults true, no public opt-out) that then fails its WASM load and spams
// `console.error("TreeSitter worker error…")` into the TUI on every run. Skipping the client
// entirely in a compiled binary avoids that wasted work and log noise; code just renders without
// syntax highlighting. bot-message.tsx makes a module-level getTreeSitterClient() call too and
// gates on this same flag. Detects the compiled-binary mount prefixes `/$bunfs/root/` (POSIX) and
// `~BUN/root/` (Windows) — the same ones compile.ts's OTUI_TREE_SITTER_WORKER_PATH define uses.
export const isCompiledBinary =
  import.meta.url.includes("/$bunfs/") || import.meta.url.includes("~BUN/root/");

export async function initTreeSitter(): Promise<void> {
  if (isCompiledBinary) return;

  try {
    const _require = createRequire(import.meta.url);
    const coreDir = dirname(_require.resolve("@opentui/core/package.json"));

    addDefaultParsers([
      {
        filetype: "javascript",
        aliases: ["js", "jsx", "javascriptreact"],
        wasm: resolvePath(coreDir, "assets/javascript/tree-sitter-javascript.wasm"),
        queries: { highlights: [resolvePath(coreDir, "assets/javascript/highlights.scm")] },
      },
      {
        filetype: "typescript",
        aliases: ["ts", "tsx", "typescriptreact"],
        wasm: resolvePath(coreDir, "assets/typescript/tree-sitter-typescript.wasm"),
        queries: { highlights: [resolvePath(coreDir, "assets/typescript/highlights.scm")] },
      },
    ]);

    await getTreeSitterClient().initialize();
  } catch {
    // tree-sitter unavailable; code blocks render without syntax highlighting
  }
}
