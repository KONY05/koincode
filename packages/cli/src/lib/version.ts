/**
 * Compares two plain `major.minor.patch` version strings. koincode versions never carry
 * pre-release/build suffixes — they're synced verbatim from package.json. Returns <0 if a<b,
 * 0 if equal, >0 if a>b. A missing part counts as 0 (so "1.2" === "1.2.0"); an unparseable part
 * becomes NaN, which makes both `> 0` and `>= 0` comparisons false — callers treat that as "not
 * newer / not acceptable", the safe conservative default.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10));
  const pb = b.split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** True if `candidate` is strictly newer than `current`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}
