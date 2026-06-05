/**
 * Hook execution system for KOINCODE
 * Manages loading, matching, and executing hooks
 */

import { spawn } from "child_process";

import { readGlobalConfig } from "../configs/global-config";
import { readProjectConfig } from "../configs/project-config";
import { matchHook } from "./matcher";
import type {
  HookEventType,
  HooksConfig,
  CommandHookHandler,
  HookHandler,
  HookMatcherGroup,
} from "@koincode/shared";

/**
 * Hook event data passed to hooks via environment variables
 */
export interface HookEventData {
  hook_event_name: HookEventType;
  tool_name: string;
  tool_input: unknown;
  tool_response?: unknown;
  cwd: string;
  error?: string;
  duration_ms?: number;
}

/**
 * Hook execution result
 */
export interface HookResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Load hooks from project config and merge with global config
 * Project config takes precedence over global config
 */
export function loadHooks(): HooksConfig {
  const projectConfig = readProjectConfig();
  const globalConfig = readGlobalConfig();

  // Merge hooks: project config overrides global config
  const mergedHooks: HooksConfig = {
    ...globalConfig.hooks,
    ...projectConfig.hooks,
  };

  return mergedHooks;
}

/**
 * Check if a tool name matches a matcher pattern
 * @param toolName - The tool name to check
 * @param matcher - The matcher pattern
 * @returns true if the tool name matches
 */
export function matchesMatcher(toolName: string, matcher: string): boolean {
  return matchHook(toolName, matcher);
}

/**
 * Execute a single command hook
 * @param hook - The hook handler to execute
 * @param eventData - The event data to pass to the hook via environment variables
 * @returns The hook execution result
 */
export async function executeHook(
  hook: HookHandler,
  eventData: HookEventData,
): Promise<HookResult> {
  if (hook.type !== "command") {
    console.warn(`Hook type ${hook.type} not yet implemented`);
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  const commandHook = hook as CommandHookHandler;
  const timeout = commandHook.timeout || 30000; // Default 30s timeout

  return new Promise((resolve) => {
    const shell = commandHook.shell || "bash";

    // Build environment variables with hook context
    const env: Record<string, string> = {
      ...process.env,
      KOINCODE_HOOK_EVENT: eventData.hook_event_name,
      KOINCODE_TOOL_NAME: eventData.tool_name,
      KOINCODE_TOOL_INPUT: JSON.stringify(eventData.tool_input),
      KOINCODE_CWD: eventData.cwd,
    };

    if (eventData.tool_response !== undefined) {
      env.KOINCODE_TOOL_RESPONSE = JSON.stringify(eventData.tool_response);
    }

    if (eventData.error !== undefined) {
      env.KOINCODE_ERROR = eventData.error;
    }

    // Determine the command to run
    let command: string;
    let args: string[];

    if (commandHook.args && commandHook.args.length > 0) {
      // Exec form: command with args array
      command = commandHook.command;
      args = commandHook.args;
    } else {
      // Shell form: run command through shell
      command = shell;
      args = ["-c", commandHook.command];
    }

    const child = spawn(command, args, {
      cwd: eventData.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    const timeoutId = setTimeout(() => {
      child.kill("SIGKILL");
      console.warn(`Hook timed out after ${timeout}ms: ${commandHook.command}`);
      resolve({ exitCode: null, stdout, stderr });
    }, timeout);

    child.on("close", (code) => {
      clearTimeout(timeoutId);

      if (stderr) {
        console.warn(`Hook stderr: ${stderr}`);
      }

      if (code !== 0 && code !== null) {
        console.warn(`Hook exited with code ${code}: ${commandHook.command}`);
      }

      resolve({ exitCode: code, stdout, stderr });
    });

    child.on("error", (error) => {
      clearTimeout(timeoutId);
      console.error(`Hook execution error: ${error.message}`);
      resolve({ exitCode: -1, stdout, stderr });
    });
  });
}

/**
 * Run all hooks for a specific event and tool
 * @param eventType - The hook event type
 * @param toolName - The tool name
 * @param toolInput - The tool input
 * @param toolResponse - The tool response (for PostToolUse events)
 * @param cwd - The current working directory
 * @param error - The error message (for PostToolUseFailure events)
 * @returns Array of hook execution results
 */
export async function runHooks(
  eventType: HookEventType,
  toolName: string,
  toolInput: unknown,
  toolResponse?: unknown,
  cwd: string = process.cwd(),
  error?: string,
): Promise<HookResult[]> {
  const hooks = loadHooks();
  const eventHooks = hooks[eventType];

  if (!eventHooks || eventHooks.length === 0) {
    return [];
  }

  // Find matching hook groups
  const matchingGroups: HookMatcherGroup[] = eventHooks.filter((group) =>
    matchHook(toolName, group.matcher),
  );

  if (matchingGroups.length === 0) {
    return [];
  }

  const eventData: HookEventData = {
    hook_event_name: eventType,
    tool_name: toolName,
    tool_input: toolInput,
    cwd,
  };

  if (toolResponse !== undefined) {
    eventData.tool_response = toolResponse;
  }

  if (error !== undefined) {
    eventData.error = error;
  }

  // Execute all hooks in matching groups
  const results: HookResult[] = [];
  for (const group of matchingGroups) {
    for (const hook of group.hooks) {
      try {
        const result = await executeHook(hook, eventData);
        results.push(result);
      } catch (_error) {
        console.error(`Hook execution failed: ${String(_error)}`);
        // Continue with other hooks even if one fails
      }
    }
  }

  return results;
}
