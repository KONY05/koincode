const LINUX_CANDIDATES: Array<[string, string[]]> = [
  ["wl-copy", []],
  ["xclip", ["-selection", "clipboard"]],
  ["xsel", ["--clipboard", "--input"]],
];

function candidatesForPlatform(): Array<[string, string[]]> {
  if (process.platform === "darwin") return [["pbcopy", []]];
  if (process.platform === "win32") return [["clip", []]];
  return LINUX_CANDIDATES;
}

/** Writes text to the OS clipboard by shelling out to the platform's native copy tool. */
export async function copyToClipboard(text: string): Promise<boolean> {
  for (const [cmd, args] of candidatesForPlatform()) {
    try {
      const proc = Bun.spawn([cmd, ...args], {
        stdin: new Response(text),
        stdout: "ignore",
        stderr: "ignore",
      });
      const exitCode = await proc.exited;
      if (exitCode === 0) return true;
    } catch {
      // try the next candidate (binary likely not installed)
    }
  }
  return false;
}
