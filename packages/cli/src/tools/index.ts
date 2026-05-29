import { Mode, type ModeType } from "@koincode/shared";
import { runBash } from "./bash";
import { runEditFile } from "./edit-file";
import { runGlob } from "./glob";
import { runGrep } from "./grep";
import { runListDirectory } from "./list-directory";
import { runReadFile } from "./read-file";
import { runWriteFile } from "./write-file";
import { runWebSearch } from "./web-search";

const PLAN_TOOLS = ["readFile", "listDirectory", "glob", "grep", "createTodos", "updateTodos", "webSearch"];

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
    case "bash":
      return runBash(input);
    case "webSearch":
      return runWebSearch(input);
    case "createTodos":
    case "updateTodos":
      return { ok: true };
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
