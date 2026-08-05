import {
  resolveAgent,
  resolveToolContracts,
  type AgentId,
  type WorkspaceRoot,
} from "@koincode/shared";
import { loadAgents } from "../lib/agents";
import { runShellCommand } from "./shell";
import { runEditFile } from "./edit-file";
import { runGlob } from "./glob";
import { runGrep } from "./grep";
import { runListDirectory } from "./list-directory";
import { runReadFile } from "./read-file";
import { runWebFetch } from "./web-fetch";
import { runWriteFile } from "./write-file";
import { runWebSearch } from "./web-search";
import {
  runMemoryAdd,
  runMemoryUpdate,
  runMemoryDelete,
  runMemoryList,
} from "./memory";
import { runManageHook } from "./manage-hook";
import { runCheckAgentTask } from "./check-agent-task";
import { runReadSkill } from "./read-skill";
import { runWriteSkill } from "./write-skill";
import { runMcpTool, runManageMcp } from "./mcp";
import {
  runBrowserNavigate,
  runBrowserScreenshot,
  runBrowserClick,
  runBrowserType,
  runBrowserGetConsoleLogs,
  runBrowserClose,
} from "./browser";
import {
  runServerStart,
  runCheckServerLogs,
  runServerStop,
} from "./server"
import { runHooks } from "../utils/hooks";

export async function executeLocalTool(
  toolName: string,
  input: unknown,
  mode: AgentId,
  modelId?: string,
  sessionId?: string,
  roots: WorkspaceRoot[] = [],
  alreadyLoadedAgentsMd: Map<string, string> = new Map(),
) {
  // Client-side enforcement of the active agent's tool set — the server decides
  // which tools to *offer*, this makes sure a call the model made anyway can't
  // execute outside them. Registry-driven now, so a user agent's `tools:` list is
  // enforced the same way PLAN's read-only set always has been.
  //
  // Browser tools are resolved permissively (`true`): they're gated by not being
  // offered when the user's browser flag is off, which is how it worked before the
  // registry existed. MCP tools are exempt — they're namespaced (`server__tool`),
  // never part of a contract set, and carry their own per-server approval gate.
  if (!toolName.includes("__")) {
    const agent = resolveAgent(mode, loadAgents());
    // `Object.hasOwn`, not `in`: `toolName` comes from the model, and `in` walks the
    // prototype chain, so a call to "toString"/"constructor" would slip past this gate.
    if (!Object.hasOwn(resolveToolContracts(agent, true), toolName)) {
      throw new Error(`Tool ${toolName} is not available to the ${agent.label} agent`);
    }
  }

  let toolOutput: unknown;
  try {
    switch (toolName) {
      case "readFile":
        toolOutput = await runReadFile(input, roots, alreadyLoadedAgentsMd, modelId);
        break;
      case "listDirectory":
        toolOutput = await runListDirectory(input, roots);
        break;
      case "glob":
        toolOutput = await runGlob(input, roots);
        break;
      case "grep":
        toolOutput = await runGrep(input);
        break;
      case "writeFile":
        toolOutput = await runWriteFile(input, roots);
        break;
      case "editFile":
        toolOutput = await runEditFile(input, roots);
        break;
      case "shell":
        toolOutput = await runShellCommand(input, sessionId);
        break;
      case "webFetch":
        toolOutput = await runWebFetch(input);
        break;
      case "webSearch":
        toolOutput = await runWebSearch(input);
        break;
      case "createTodos":
      case "updateTodos":
        toolOutput = { ok: true };
        break;
      case "memoryAdd":
        toolOutput = await runMemoryAdd(input);
        break;
      case "memoryUpdate":
        toolOutput = await runMemoryUpdate(input);
        break;
      case "memoryDelete":
        toolOutput = await runMemoryDelete(input);
        break;
      case "memoryList":
        toolOutput = await runMemoryList(input);
        break;
      case "manageHook":
        toolOutput = await runManageHook(input);
        break;
      case "readSkill":
        toolOutput = runReadSkill(input);
        break;
      case "writeSkill":
        toolOutput = runWriteSkill(input);
        break;
      case "manageMcp":
        toolOutput = await runManageMcp();
        break;
      case "checkAgentTask":
        toolOutput = runCheckAgentTask(input);
        break;
      case "serverStart":
        toolOutput = await runServerStart(input, sessionId);
        break;
      case "checkServerLogs":
        toolOutput = runCheckServerLogs(input);
        break;
      case "serverStop":
        toolOutput = runServerStop(input);
        break;
      case "browserNavigate":
        toolOutput = await runBrowserNavigate(input, sessionId);
        break;
      case "browserScreenshot":
        toolOutput = await runBrowserScreenshot(input, modelId, sessionId);
        break;
      case "browserClick":
        toolOutput = await runBrowserClick(input, sessionId);
        break;
      case "browserType":
        toolOutput = await runBrowserType(input, sessionId);
        break;
      case "browserGetConsoleLogs":
        toolOutput = runBrowserGetConsoleLogs(input);
        break;
      case "browserClose":
        toolOutput = await runBrowserClose(input);
        break;
      // These are fully handled in use-chat.ts before reaching here; these paths should never run.
      // case "askUser":
      // case "switchMode":
      // case "spawnAgent":
      // case "scheduleWakeup":
      default:
        if (toolName.includes("__")) {
          toolOutput = await runMcpTool(toolName, input);
          break;
        }
        throw new Error(`Unknown tool: ${toolName}`);
    }

    // Run PostToolUse hooks
    await runHooks(
      "PostToolUse",
      toolName,
      input,
      toolOutput,
    );

    // Log hook results (hooks can log to stdout/stderr which we already capture)
    // PostToolUse hooks cannot block the tool since it already executed
    // They can only provide context or notifications

    return toolOutput;
  } catch (error) {
    // Run PostToolUseFailure hooks
    await runHooks(
      "PostToolUseFailure",
      toolName,
      input,
      undefined,
      process.cwd(),
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}
