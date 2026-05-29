import { createRequire } from "module";
import { resolve as resolvePath, dirname } from "path";
import { addDefaultParsers, getTreeSitterClient } from "@opentui/core";

export async function initTreeSitter(): Promise<void> {
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
