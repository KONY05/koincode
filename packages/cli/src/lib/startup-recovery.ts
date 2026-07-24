import { checkForUpdate, runCliUpdate, currentVersion } from "./update-cli";
import { isNewerVersion } from "./version";
import { Sentry } from "./sentry";

/**
 * Last-resort recovery when the app fails to even start — a bad build that throws during startup,
 * before the TUI is up (e.g. a fatal error while importing the render tree, the class of crash
 * that shipped in the `@opentui/core` 0.4.5 regression). Called from `bin/koincode.ts`'s startup
 * try/catch.
 *
 * If a *strictly newer* version is published, self-update to it so a user on a broken build isn't
 * stranded having to know about `koincode --update` — the whole point is that the fix reaches them
 * automatically once it's released. Only strictly-newer (never a downgrade, and never a re-install
 * of the same version) so a genuinely-broken current release can't loop on itself. If there's
 * nothing newer to recover with (offline, or already on latest), report the failure and exit.
 *
 * Deliberately opentui-free (only imports update-cli / version / sentry, none of which touch the
 * render layer) so it stays importable even after the render tree is what crashed.
 */
export async function handleStartupCrash(err: unknown): Promise<never> {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`\nkoincode failed to start:\n${message}\n`);

  try {
    Sentry.captureException(err);
  } catch {
    // Sentry not initialized / offline — reporting is best-effort, never block recovery on it.
  }

  let latest: string | null = null;
  try {
    latest = await checkForUpdate();
  } catch {
    // Registry unreachable (offline etc.) — nothing to recover with, fall through to exit.
  }

  if (latest && isNewerVersion(latest, currentVersion)) {
    process.stderr.write(
      `\nA newer version (v${latest}) is available — updating to try to recover...\n`,
    );
    await runCliUpdate(); // performs the update and exits the process itself
  }

  process.stderr.write(
    `\nNo newer version available to recover with. ` +
      `Please report this at https://github.com/KONY05/koincode/issues\n`,
  );
  process.exit(1);
}
