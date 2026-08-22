import { familySync, versionSync } from "detect-libc";

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

  const family = familySync();
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
    const version = versionSync();
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
