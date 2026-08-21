import { toolInputSchemas } from "@koincode/shared";
import {
  DEFAULT_TIMEOUT,
  MAX_OUTPUT,
  resolveFromCwd,
  truncate,
  truncateTail,
} from "./utils";
import { registerBackgroundWork } from "../lib/background/session-background-work";
import {
  registerBackgroundProcess,
  markProcessExited
} from "../lib/background/background-process-status";
import {
  createBackgroundTask,
  completeBackgroundTask,
  failBackgroundTask,
} from "../lib/background/background-tasks";

// Commands that warrant an approval prompt but retain legitimate uses —
// matched as plain substrings of the command line.
const BLOCKED_COMMAND_PATTERNS = [
  "dd if=/dev/zero",
  "dd if=/dev/random",
  "mkfs",
  "shutdown",
  "reboot",
  "halt",
  "poweroff",
  "init 0",
  "init 6",
];

// Refused outright, with no approval path — no legitimate use in an agent
// session.
const FORK_BOMB = ":(){ :|:& };:";

// `dd if=/dev/zero of=/dev/sda`-style writes nuke real disks/devices.
const RAW_DEVICE_OF_RE = /\bof=\/dev\/(?:sd|hd|nvme|mmcblk|disk)/;

// Wrappers that may prefix a real rm/chmod invocation; anything else before
// the binary means the dangerous text is merely being mentioned (e.g. echo).
const COMMAND_WRAPPERS = new Set([
  "sudo",
  "nohup",
  "command",
  "exec",
  "time",
  "nice",
  "env",
  "xargs",
]);

// Catastrophic rm/chmod targets. These are matched against actual argument
// targets rather than raw substrings, so `rm -rf /` is blocked while
// `rm -rf /tmp/cache` (which merely contains the text "rm -rf /") stays allowed.
const CATASTROPHIC_TARGETS = new Set([
  "/",
  "~",
  "~/*",
  "/*",
  "$home",
  "${home}",
]);

// Shells whose `-c '<payload>'` form is recursed into when scanning.
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

// Matches `sh -c '<payload>'` (incl. flag variants like `bash -lc`) so the
// quoted payload can be scanned too. Applied before whitespace tokenization,
// which would otherwise shred quoted arguments apart.
const SHELL_C_PAYLOAD_RE =
  /(?:^|[\s;&|(])(?:sh|bash|zsh|dash|ksh)\s+(?:-{1,2}[\w-]+\s+)*-[\w]*c[\w]*\s+(["'])([\s\S]*?)\1/;

function isCatastrophicTarget(rawToken: string): boolean {
  let target = rawToken.trim();
  // Strip surrounding quotes so `rm -rf '/'` still hits.
  if (
    target.length >= 2 &&
    ((target.startsWith('"') && target.endsWith('"')) ||
      (target.startsWith("'") && target.endsWith("'")))
  ) {
    target = target.slice(1, -1);
  }
  // Collapse trailing slashes so "/", "~/", "/tmp/" normalize cleanly.
  target = target.replace(/\/+$/, "");
  if (target === "") target = "/";
  target = target.toLowerCase();

  if (CATASTROPHIC_TARGETS.has(target)) return true;

  // Lexically resolve "."/".." on absolute paths so tricks like "/.."
  // don't slip through as an ordinary target.
  if (target.startsWith("/")) {
    const resolved: string[] = [];
    for (const segment of target.split("/")) {
      if (segment === "" || segment === ".") continue;
      if (segment === "..") resolved.pop();
      else resolved.push(segment);
    }
    if (resolved.length === 0) return true;
  }
  return false;
}

function findDangerousTargets(
  tokens: string[],
  start: number,
  skipModeOperand: boolean,
): string | null {
  let index = start;
  // Skip option flags (-rf, -fr, -R, --recursive, ...), honoring "--".
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === undefined) break;
    if (token === "--") {
      index++;
      break;
    }
    if (token.startsWith("-")) {
      index++;
      continue;
    }
    break;
  }
  // For chmod the first operand is the mode (e.g. 777); targets follow it.
  if (skipModeOperand && index < tokens.length) index++;
  for (; index < tokens.length; index++) {
    const token = tokens[index];
    if (token !== undefined && isCatastrophicTarget(token)) return token;
  }
  return null;
}

function tokenizeLoose(segment: string): string[] {
  // Strip quote characters before tokenizing so dangerous targets hiding at
  // quote boundaries (`rm -rf '/'`, or a text mention like echo "... rm -rf /")
  // still resolve to their bare form.
  return segment
    .replace(/["']/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * True when the token at cmdIndex is actually being invoked — every preceding
 * token is an env assignment (`FOO=bar`) or a known wrapper (`sudo`, `xargs`,
 * …). Otherwise the dangerous text is merely a mention inside some other
 * command (e.g. `echo "never run rm -rf /"`).
 */
function isDirectInvocation(tokens: string[], cmdIndex: number): boolean {
  for (let index = 0; index < cmdIndex; index++) {
    const token = tokens[index];
    if (token === undefined) continue;
    if (COMMAND_WRAPPERS.has(token)) continue;
    if (/^[a-z_][a-z0-9_]*=/.test(token)) continue;
    return false;
  }
  return true;
}

type DangerMatch = { pattern: string; catastrophic: boolean };

function scanSegment(segment: string): DangerMatch | null {
  let worst: DangerMatch | null = null;
  const consider = (match: DangerMatch) => {
    if (!worst || (match.catastrophic && !worst.catastrophic)) worst = match;
  };

  const tokens = tokenizeLoose(segment);
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === undefined) continue;

    if (token === "rm" || token === "chmod") {
      const hit = findDangerousTargets(tokens, index + 1, token === "chmod");
      if (hit) {
        // A directly-invoked `rm` against root/home annihilates the system —
        // hard-refused. Everything else (mentions, `chmod 777 /`) only
        // warrants an approval prompt.
        const catastrophic =
          token === "rm" && isDirectInvocation(tokens, index);
        consider({ pattern: `${token} ${hit}`, catastrophic });
      }
    }

    if (
      token === "dd" &&
      isDirectInvocation(tokens, index) &&
      RAW_DEVICE_OF_RE.test(segment)
    ) {
      consider({ pattern: "dd write to raw device", catastrophic: true });
    }

    if (SHELLS.has(token) && isDirectInvocation(tokens, index)) {
      // Recurse into `sh -c '<inner>'` style payloads.
      for (let j = index + 1; j < tokens.length - 1; j++) {
        const flag = tokens[j];
        const payload = tokens[j + 1];
        if (
          flag !== undefined &&
          /^-[a-z]*c$/.test(flag) &&
          payload !== undefined
        ) {
          const inner = scanSegment(payload);
          if (inner) consider(inner);
        }
      }
    }
  }
  return worst;
}

function scanCommand(command: string): DangerMatch | null {
  const normalized = command.toLowerCase().replace(/\s+/g, " ").trim();

  // Checked before segment-splitting: the fork bomb's own body consists of
  // the very operators (`;`, `|`, `&`) that splitting cuts on.
  if (normalized.includes(FORK_BOMB)) {
    return { pattern: FORK_BOMB, catastrophic: true };
  }

  let worst: DangerMatch | null = null;
  const consider = (match: DangerMatch | null) => {
    if (match && (!worst || (match.catastrophic && !worst.catastrophic))) {
      worst = match;
    }
  };

  const substringHit = BLOCKED_COMMAND_PATTERNS.find((pattern) =>
    normalized.includes(pattern),
  );
  if (substringHit) consider({ pattern: substringHit, catastrophic: false });

  // Check each pipeline/sequence segment separately so wrappers like
  // `cd /tmp && rm -rf /` are caught too.
  for (const segment of normalized.split(/&&|\|\||;|\||&|\n/)) {
    // Scan `sh -c '<payload>'` innards first, quote-aware.
    const payload = segment.match(SHELL_C_PAYLOAD_RE)?.[2];
    if (payload !== undefined) consider(scanSegment(payload));
    consider(scanSegment(segment));
  }
  return worst;
}

/**
 * Matches that are refused outright — `runShellCommand` throws on these and
 * no approval flow exists.
 */
export function findCatastrophicPattern(command: string): string | null {
  const match = scanCommand(command);
  return match?.catastrophic ? match.pattern : null;
}

/** Matches that require explicit user approval before running. */
export function findBlockedPattern(command: string): string | null {
  const match = scanCommand(command);
  return match && !match.catastrophic ? match.pattern : null;
}

export async function runShellCommand(input: unknown, sessionId?: string) {
  const { command, description, cwd, timeout, run_in_background } =
    toolInputSchemas.shell.parse(input);
  const spawnCwd = resolveFromCwd(cwd ?? ".").resolved;

  // Catastrophic patterns are refused outright — no approval path exists.
  // Prompt-class gating lives in the permission layer
  // (utils/permissions/shell.ts), so by the time this runs, anything left was
  // approved or explicitly allowed.
  const catastrophic = findCatastrophicPattern(command);
  if (catastrophic) {
    throw new Error(
      `Command blocked for safety: matched pattern "${catastrophic}"`,
    );
  }

  const shell =
    process.platform === "win32" ? "cmd.exe" : (process.env.SHELL ?? "/bin/sh");

  const shellArgs =
    process.platform === "win32"
      ? [shell, "/c", command]
      : [shell, "-c", command];

  if (run_in_background) {
    const proc = Bun.spawn(shellArgs, {
      cwd: spawnCwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });

    registerBackgroundProcess(proc.pid);

    const taskId = createBackgroundTask("shell", description, String(proc.pid));

    // Background commands are expected to potentially run indefinitely by
    // design (a build/test/watch process) — unlike the foreground path, no
    // default timeout is applied. Only kill it if the model explicitly asked
    // for a bound via `timeout`.
    let timedOut = false;
    const timer =
      timeout != null
        ? setTimeout(() => {
            timedOut = true;
            proc.kill();
          }, timeout)
        : null;

    void (async () => {
      try {
        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        const exitCode = await proc.exited;
        if (timer) clearTimeout(timer);

        markProcessExited(proc.pid, exitCode);

        // A non-zero exit code is a normal, informative result (e.g. a `ps -p`
        // liveness check), not necessarily a failure — same reasoning as the
        // tool-view's own success/error indicator. Only an exception below
        // (the process failing to run at all) counts as a task error.
        const output = [stdout, stderr].filter(Boolean).join("\n");
        const status = timedOut
          ? `timed out after ${timeout}ms and was killed`
          : `finished — exit ${exitCode}`;
        const deliveryText =
          `Background shell command (PID ${proc.pid}, "${command}") ${status}.` +
          (output
            ? `\n\nOutput:\n${truncateTail(output, MAX_OUTPUT)}`
            : "\n\nNo output.");

        completeBackgroundTask(taskId, deliveryText);
      } catch (error) {
        if (timer) clearTimeout(timer);
        failBackgroundTask(
          taskId,
          `Background shell command (PID ${proc.pid}, "${command}") failed to run: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    })();

    if (sessionId) {
      const deregister = registerBackgroundWork(sessionId, () => proc.kill());
      // Don't leak the registration once the process exits on its own.
      void proc.exited.then(deregister);
    }

    return {
      pid: proc.pid,
      message: `Process started in background (PID ${proc.pid}). Its result will be delivered here automatically once it exits — no need to poll. Optionally use scheduleWakeup with waitingOnTaskId: "${proc.pid}" to also resume with a specific follow-up prompt the moment it's done.`,
    };
  }

  const proc = Bun.spawn(shellArgs, {
    cwd: spawnCwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, TERM: "dumb" },
  });

  const timer = setTimeout(() => proc.kill(), timeout ?? DEFAULT_TIMEOUT);

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  clearTimeout(timer);

  return {
    stdout: truncate(stdout, MAX_OUTPUT),
    stderr: truncate(stderr, MAX_OUTPUT),
    exitCode,
  };
}
