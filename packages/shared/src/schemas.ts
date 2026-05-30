import { z } from "zod";
import { tool } from "ai";

export const Mode = {
  BUILD: "BUILD",
  PLAN: "PLAN",
} as const;

export const modeSchema = z.enum([Mode.BUILD, Mode.PLAN]);

export type ModeType = (typeof Mode)[keyof typeof Mode];

const todoItemSchema = z.object({
  id: z.number().describe("Unique todo item ID starting from 1"),
  text: z.string().describe("Description of the task"),
  completed: z.boolean().describe("Whether the task is done"),
});

export type TodoItem = z.infer<typeof todoItemSchema>;

export const toolInputSchemas = {
  readFile: z.object({
    path: z.string().describe("Relative path to the file to read"),
  }),
  listDirectory: z.object({
    path: z.string().default(".").describe("Relative directory path to list"),
  }),
  glob: z.object({
    pattern: z.string().describe("Glob pattern to match files"),
    path: z.string().default(".").describe("Directory to search from"),
  }),
  grep: z.object({
    pattern: z.string().describe("Regex pattern to search for"),
    path: z.string().default(".").describe("Directory to search from"),
    include: z.string().optional().describe("Optional glob for files to include"),
  }),
  writeFile: z.object({
    path: z.string().describe("Relative path to write"),
    content: z.string().describe("File contents"),
  }),
  editFile: z.object({
    path: z.string().describe("Relative path to edit"),
    oldString: z.string().describe("Exact text to replace; must be unique"),
    newString: z.string().describe("Replacement text"),
  }),
  shell: z.object({
    command: z.string().describe("Shell command to run"),
    description: z.string().optional().describe("Short description of the command"),
    timeout: z.number().optional().describe("Timeout in milliseconds"),
  }),
  createTodos: z.object({
    todos: z.array(todoItemSchema).describe("Ordered list of tasks to complete"),
  }),
  updateTodos: z.object({
    todos: z.array(todoItemSchema).describe("Full updated list with current completion state"),
  }),
  webFetch: z.object({
    url: z.url().describe("URL to fetch"),
    timeout: z.number().min(5).max(120).default(30).describe("Request timeout in seconds (5–120, default 30)"),
  }),
  webSearch: z.object({
    query: z.string().describe("Search query"),
    maxResults: z.number().int().min(1).max(20).default(10).describe("Maximum number of results to return"),
  }),
} as const;

export const readOnlyToolContracts = {
  readFile: tool({
    description: "Read a file from the current project directory.",
    inputSchema: toolInputSchemas.readFile,
  }),
  listDirectory: tool({
    description: "List entries in a directory under the current project directory.",
    inputSchema: toolInputSchemas.listDirectory,
  }),
  glob: tool({
    description: "Find files matching a glob pattern under the current project directory.",
    inputSchema: toolInputSchemas.glob,
  }),
  grep: tool({
    description:
      "Search file contents with a regular expression under the current project directory.",
    inputSchema: toolInputSchemas.grep,
  }),
  createTodos: tool({
    description:
      "Create a numbered todo list to plan your approach before implementing. Call this at the start of any non-trivial task.",
    inputSchema: toolInputSchemas.createTodos,
  }),
  updateTodos: tool({
    description:
      "Update the todo list to reflect current progress. Mark items completed as you finish them.",
    inputSchema: toolInputSchemas.updateTodos,
  }),
  webFetch: tool({
    description: "Fetch the content of a URL and return the response body as text.",
    inputSchema: toolInputSchemas.webFetch,
  }),
  webSearch: tool({
    description:
      "Search the web using DuckDuckGo and return a list of results with title, URL, and snippet.",
    inputSchema: toolInputSchemas.webSearch,
  }),
} as const;

export const buildToolContracts = {
  ...readOnlyToolContracts,
  writeFile: tool({
    description: "Create or overwrite a file under the current project directory.",
    inputSchema: toolInputSchemas.writeFile,
  }),
  editFile: tool({
    description: "Replace exact text in a file under the current project directory.",
    inputSchema: toolInputSchemas.editFile,
  }),
  shell: tool({
    description: "Run a shell command in the current project directory.",
    inputSchema: toolInputSchemas.shell,
  }),
} as const;

export type ToolContracts = typeof buildToolContracts;

export function getToolContracts(mode: ModeType) {
  return mode === Mode.PLAN 
    ? readOnlyToolContracts 
    : buildToolContracts;
};
