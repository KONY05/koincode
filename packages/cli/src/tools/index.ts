import { Mode, type ModeType } from "@koincode/shared";
import { runShellCommand } from "./shell";
import { runEditFile } from "./edit-file";
import { runGlob } from "./glob";
import { runGrep } from "./grep";
import { runListDirectory } from "./list-directory";
import { runReadFile } from "./read-file";
import { runWebFetch } from "./web-fetch";
import { runWriteFile } from "./write-file";
import { runWebSearch } from "./web-search";

const PLAN_TOOLS = ["readFile", "listDirectory", "glob", "grep", "createTodos", "updateTodos", "webFetch", "webSearch", "askUser"];

export async function executeLocalTool(toolName: string, input: unknown, mode: ModeType) {
  if (mode === Mode.PLAN && !PLAN_TOOLS.includes(toolName)) {
    throw new Error(`Tool ${toolName} is not available in PLAN mode`);
  }

  switch (toolName) {
    case "readFile":
      return runReadFile(input);
    case "listDirectory":
      return runListDirectory(input);
    case "glob":
      return runGlob(input);
    case "grep":
      return runGrep(input);
    case "writeFile":
      return runWriteFile(input);
    case "editFile":
      return runEditFile(input);
    case "shell":
      return runShellCommand(input);
    case "webFetch":
      return runWebFetch(input);
    case "webSearch":
      return runWebSearch(input);
    case "createTodos":
    case "updateTodos":
      return { ok: true };
    // case "askUser": Fully handled in use-chat.ts before reaching here; this path should never run.
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
