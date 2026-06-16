import { Mode, readOnlyToolContracts, type ModeType } from "@koincode/shared";
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
  runServerStart,
} from "./browser";
import { runHooks } from "../utils/hooks";

const PLAN_TOOLS = new Set(Object.keys(readOnlyToolContracts));

export async function executeLocalTool(
  toolName: string,
  input: unknown,
  mode: ModeType,
  modelId?: string,
  sessionId?: string,
) {
  if (mode === Mode.PLAN && !PLAN_TOOLS.has(toolName)) {
    throw new Error(`Tool ${toolName} is not available in PLAN mode`);
  }

  let toolOutput: unknown;
  try {
    switch (toolName) {
      case "readFile":
        toolOutput = runReadFile(input);
        break;
      case "listDirectory":
        toolOutput = runListDirectory(input);
        break;
      case "glob":
        toolOutput = runGlob(input);
        break;
      case "grep":
        toolOutput = runGrep(input);
        break;
      case "writeFile":
        toolOutput = runWriteFile(input);
        break;
      case "editFile":
        toolOutput = runEditFile(input);
        break;
      case "shell":
        toolOutput = runShellCommand(input);
        break;
      case "webFetch":
        toolOutput = runWebFetch(input);
        break;
      case "webSearch":
        toolOutput = runWebSearch(input);
        break;
      case "createTodos":
      case "updateTodos":
        toolOutput = { ok: true };
        break;
      case "memoryAdd":
        toolOutput = runMemoryAdd(input);
        break;
      case "memoryUpdate":
        toolOutput = runMemoryUpdate(input);
        break;
      case "memoryDelete":
        toolOutput = runMemoryDelete(input);
        break;
      case "memoryList":
        toolOutput = runMemoryList(input);
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
      case "serverStart":
        toolOutput = await runServerStart(input);
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
