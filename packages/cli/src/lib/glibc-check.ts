import { familySync, versionSync } from "detect-libc";
import { execSync } from "child_process";

// The prebuilt libsql native addon bundled into the Linux binaries (and installed from source)
// references GLIBC_2.18 symbols, so on older systems the server dies at startup with a cryptic
// `ERR_DLOPEN_FAILED: version 'GLIBC_2.18' not found`. We detect that up front and explain
// instead. See the Requirements section in README.md.
const MIN_GLIBC_VERSION = "2.18";

/** Numeric-aware version compare ("2.9" < "2.18"), unlike naive string comparison. */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  const length = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < length; i++) {
    const segA = partsA[i] ?? 0;
    const segB = partsB[i] ?? 0;
    if (segA !== segB) return segA < segB ? -1 : 1;
  }
  return 0;
}

/** True when a Bun.main-style path points into a single-file executable's embedded filesystem. */
export function looksLikeCompiledBinary(mainPath: string): boolean {
  // "/$bunfs/root/..." on unix, "B:\~BUN\..." on Windows.
  return mainPath.includes("$bunfs") || /^B:[\\/]~BUN/i.test(mainPath);
}

function isCompiledBinary(): boolean {
  if (process.env.KOINCODE_TEST_COMPILED === "true") return true;
  if (process.env.KOINCODE_TEST_COMPILED === "false") return false;
  return looksLikeCompiledBinary(Bun.main);
}

/**
 * Returns an error message when this Linux machine can't run koincode, null otherwise.
 * Non-Linux platforms are always fine. Detection failures fail open (null) so an exotic
 * system is never falsely rejected — if it genuinely can't load the addon, the server's
 * startup error (now surfaced with log tails by server-manager) will say so.
 */
export function getGlibcProblem(): string | null {
  if (process.platform !== "linux") return null;

  let family: string | null = familySync();
  let version: string | null = versionSync();

  // Fallback: if detect-libc failed to identify libc details, try standard Linux commands.
  if (!family || !version) {
    try {
      const getconfOut = execSync("getconf GNU_LIBC_VERSION", { stdio: "pipe", encoding: "utf-8", timeout: 5000 }).trim();
      const match = getconfOut.match(/^(glibc)\s+(\d+\.\d+(?:\.\d+)?)/i);
      if (match) {
        family = "glibc";
        version = match[2] ?? null;
      }
    } catch {
      try {
        const lddOut = execSync("ldd --version", { stdio: "pipe", encoding: "utf-8", timeout: 5000 });
        const firstLine = lddOut.split("\n")[0] ?? "";
        if (/glibc|gnu/i.test(firstLine)) {
          family = "glibc";
          // Match glibc version specifically (e.g., 'ldd (Ubuntu GLIBC 2.35-0ubuntu3) 2.35')
          const match = firstLine.match(/glibc.*?([\d.]+)/i) || firstLine.match(/([\d.]+)/);
          if (match) {
            version = match[1] ?? null;
          }
        }
      } catch {
        // ignore fallback failures and continue to let detect-libc results stand
      }
    }
  }

  if (family === "musl") {
    // We don't ship musl builds of the compiled binaries, so the embedded glibc addon
    // can't load there. Running from source on musl is fine — bun install picks the
    // musl libsql addon for the host.
    if (isCompiledBinary()) {
      return (
        "koincode's prebuilt Linux binaries require glibc, but this system uses musl (e.g. Alpine).\n" +
        "Run koincode inside a glibc-based distro or container image instead."
      );
    }
    return null;
  }

  if (family === "glibc") {
    if (version && compareVersions(version, MIN_GLIBC_VERSION) < 0) {
      return (
        `koincode requires Linux with glibc >= ${MIN_GLIBC_VERSION} (this machine reports glibc ${version}).\n` +
        "Your OS looks end-of-life (e.g. CentOS/RHEL 7). To run koincode:\n" +
        "  - Upgrade to a current distro: RHEL/Alma/Rocky 8+, Debian 10+, Ubuntu 18.04+, Amazon Linux 2+\n" +
        "  - Or run koincode inside a container with a modern base image"
      );
    }
  }

  return null;
}

/** Exits with a clear message when the host Linux can't run koincode; no-op otherwise. */
export function ensureGlibcCompatible(): void {
  const problem = getGlibcProblem();
  if (problem) {
    process.stderr.write(`koincode: unsupported system\n\n${problem}\n`);
    process.exit(1);
  }
}
