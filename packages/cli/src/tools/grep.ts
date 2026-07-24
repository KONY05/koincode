import { relative } from "path";

import { toolInputSchemas } from "@koincode/shared";
import { MAX_MATCHES, resolveFromCwd } from "./utils";

export async function runGrep(input: unknown) {
  const { pattern, path, include } = toolInputSchemas.grep.parse(input);
  const { cwd, resolved } = resolveFromCwd(path);

  const args = ["-rn", "--color=never", "--exclude-dir=node_modules", "--exclude-dir=.git", "-E"];

  if (include) {
    // grep's --include matches the basename only — a pattern with a directory component
    // (e.g. the model passing "packages/cli/**/*.ts" to scope a path) can never match any
    // file and would silently zero out every result. Salvage the trailing glob segment
    // instead of dropping the filter to a no-op; directory scoping belongs in `path`.
    const basenameGlob = include.includes("/") ? include.slice(include.lastIndexOf("/") + 1) : include;
    if (basenameGlob) args.push(`--include=${basenameGlob}`);
  }
  args.push(pattern, resolved);

  
  const proc = Bun.spawn(["grep", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  if (exitCode !== 0 && exitCode !== 1) throw new Error(`grep failed: ${stderr.trim()}`);
  if (!stdout.trim()) return { matches: [], message: "No matches found" };

  const lines = stdout.trim().split("\n");
  const matches: { file: string; line: number; content: string }[] = [];
  let truncated = false;

  for (const line of lines) {
    if (matches.length >= MAX_MATCHES) {
      truncated = true;
      break;
    }
    const match = line.match(/^(.+?):(\d+):(.*)$/);
    if (match) {
      matches.push({
        file: relative(cwd, match[1]!),
        line: Number(match[2]),
        content: match[3]!,
      });
    }
  }

  return { matches, ...(truncated ? { truncated: true, totalMatches: lines.length } : {}) };
}
