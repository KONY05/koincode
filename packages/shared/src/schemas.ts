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
  askUser: z.object({
    question: z.string().describe("The question to ask the user"),
    options: z
      .array(
        z.object({
          label: z.string().describe("Display text shown to the user"),
          value: z.string().describe("Value returned when this option is selected"),
        }),
      )
      .min(1)
      .describe("Options for the user to choose from"),
    allowFreeText: z.boolean().optional().default(false).describe("Whether to also accept a custom typed response"),
  }),
  switchMode: z.object({
    target: modeSchema.describe("The mode to switch into"),
    reason: z.string().describe("Short explanation of why the switch is needed"),
  }),
  memoryAdd: z.object({
    key: z.string().describe("Unique identifier for this memory"),
    value: z.string().describe("Content to remember"),
  }),
  memoryUpdate: z.object({
    key: z.string().describe("Key of the memory to update"),
    value: z.string().describe("New content to store"),
  }),
  memoryDelete: z.object({
    key: z.string().describe("Key of the memory to delete"),
  }),
  memoryList: z.object({}),
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
  askUser: tool({
    description:
      "Ask the user a question and wait for their response. Use this when you need a decision or clarification before proceeding. Provide clear options; set allowFreeText: true if the user may need to type a custom answer.",
    inputSchema: toolInputSchemas.askUser,
  }),
  switchMode: tool({
    description:
      "Switch between PLAN (read-only analysis) and BUILD (file editing and shell) modes. Use when the task requires capabilities not available in the current mode. No-op if already in the target mode.",
    inputSchema: toolInputSchemas.switchMode,
  }),
  memoryAdd: tool({
    description:
      "Save a new memory with a unique key. Use this to remember facts, preferences, or context that should persist across sessions.",
    inputSchema: toolInputSchemas.memoryAdd,
  }),
  memoryUpdate: tool({
    description: "Update the value of an existing memory by key.",
    inputSchema: toolInputSchemas.memoryUpdate,
  }),
  memoryDelete: tool({
    description: "Delete a memory by key.",
    inputSchema: toolInputSchemas.memoryDelete,
  }),
  memoryList: tool({
    description: "List all stored memories.",
    inputSchema: toolInputSchemas.memoryList,
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
