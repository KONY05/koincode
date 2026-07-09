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
    offset: z.number().int().min(0).optional().describe("Character offset to start reading from (for paginating large files)"),
    limit: z.number().int().min(1).optional().describe("Maximum number of characters to read"),
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
    include: z
      .string()
      .optional()
      .describe("Optional glob for files to include"),
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
    description: z
      .string()
      .describe("Short human-readable description of what this command does"),
    timeout: z
      .number()
      .optional()
      .describe(
        "Timeout in milliseconds before the command is killed. Defaults to 30s for a normal (blocking) call. For run_in_background: true, the command is allowed to run indefinitely unless you set this explicitly — pass it if you want a hung or runaway background command to be killed automatically after a bound you choose.",
      ),
    run_in_background: z.boolean().default(false).describe("Spawn without waiting for exit. Returns immediately with the process PID; its result (stdout/stderr/exit code) is delivered here automatically once it exits — no need to poll. Optionally use scheduleWakeup with waitingOnTaskId (the PID, as a string) to also resume with a specific follow-up prompt the moment it's done."),
  }),
  createTodos: z.object({
    todos: z
      .array(todoItemSchema)
      .describe("Ordered list of tasks to complete"),
  }),
  updateTodos: z.object({
    todos: z
      .array(todoItemSchema)
      .describe("Full updated list with current completion state"),
  }),
  webFetch: z.object({
    url: z.url().describe("URL to fetch"),
    timeout: z
      .number()
      .min(5)
      .max(120)
      .default(30)
      .describe("Request timeout in seconds (5–120, default 30)"),
  }),
  webSearch: z.object({
    query: z.string().describe("Search query"),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(10)
      .describe("Maximum number of results to return"),
  }),
  askUser: z.object({
    question: z.string().describe("The question to ask the user"),
    options: z
      .array(
        z.object({
          label: z.string().describe("Display text shown to the user"),
          value: z
            .string()
            .describe("Value returned when this option is selected"),
        }),
      )
      .min(1)
      .describe("Options for the user to choose from"),
    allowFreeText: z
      .boolean()
      .optional()
      .default(false)
      .describe("Whether to also accept a custom typed response"),
  }),
  switchMode: z.object({
    target: modeSchema.describe("The mode to switch into"),
    reason: z
      .string()
      .describe("Short explanation of why the switch is needed"),
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
  spawnAgent: z.object({
    name: z.string().describe("Short name/identifier for this sub-agent"),
    description: z
      .string()
      .describe("Short description of what this sub-agent will do"),
    task: z.string().describe("The full task to delegate to the sub-agent"),
    startingMode: modeSchema
      .optional()
      .default("PLAN")
      .describe("Starting mode for the sub-agent"),
    runInBackground: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Run the sub-agent without blocking this turn. Returns a taskId immediately — use checkAgentTask to poll for its result, or scheduleWakeup to check back later.",
      ),
    maxTurns: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .default(20)
      .describe(
        "Maximum number of turns before the sub-agent is stopped and returns whatever progress it made so far, instead of running unbounded. Default 20.",
      ),
    timeoutSeconds: z
      .number()
      .int()
      .min(30)
      .max(1800)
      .optional()
      .default(300)
      .describe(
        "Maximum wall-clock seconds before the sub-agent is stopped and returns whatever progress it made so far. Default 300 (5 minutes).",
      ),
  }),
  manageMcp: z.object({}),
  scheduleWakeup: z.object({
    delaySeconds: z
      .number()
      .int()
      .min(10)
      .max(1800)
      .describe("Seconds to wait before automatically resuming this session (10-1800)"),
    reason: z
      .string()
      .describe("Short human-readable reason shown in the transcript, e.g. 'waiting on background build'"),
    prompt: z
      .string()
      .describe("The exact instruction to resume with when this wakeup fires — reference specific task ids, files, or what to check next"),
    waitingOnTaskId: z
      .string()
      .optional()
      .describe(
        "If this wakeup is specifically waiting on a runInBackground spawnAgent task or a run_in_background shell command, pass its taskId (the spawnAgent taskId, or the shell command's PID as a string) — this session resumes immediately with that task's result the moment it completes or errors, instead of waiting out the full delay. The delay still applies as a fallback if the task runs long.",
      ),
  }),
  checkAgentTask: z.object({
    taskId: z.string().describe("The task id returned by a spawnAgent call made with runInBackground: true"),
  }),
  readSkill: z.object({
    name: z.string().describe("Skill name to read"),
    file: z
      .string()
      .optional()
      .describe(
        "Relative path within the skill directory (e.g. 'references/guide.md'). Omit to read SKILL.md and get a directory listing.",
      ),
  }),
  writeSkill: z.object({
    name: z
      .string()
      .describe("Kebab-case skill name (e.g. 'my-skill')"),
    content: z
      .string()
      .describe("Full SKILL.md content including frontmatter"),
    scope: z
      .enum(["global", "project"])
      .describe(
        "Where to save: 'project' for .koincode/skills/, 'global' for ~/.koincode/skills/",
      ),
  }),
  browserNavigate: z.object({
    url: z.string().describe("URL to navigate to"),
    waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).default("load").describe("When to consider navigation complete"),
  }),
  browserScreenshot: z.object({
    fullPage: z.boolean().default(false).describe("Capture full scrollable page vs viewport only"),
  }),
  browserClick: z.object({
    selector: z.string().describe("CSS selector of element to click"),
  }),
  browserType: z.object({
    selector: z.string().describe("CSS selector of input to type into"),
    text: z.string().describe("Text to type"),
    clearFirst: z.boolean().default(true).describe("Clear existing value before typing"),
  }),
  browserGetConsoleLogs: z.object({
    types: z.array(z.enum(["log", "info", "warn", "error"])).default(["warn", "error"]).describe("Log types to return"),
  }),
  browserClose: z.object({}),
  serverStart: z.object({
    command: z.string().describe("Shell command to start the server (e.g. 'bun run dev')"),
    port: z.number().int().describe("Port to poll until the server accepts TCP connections"),
    timeout: z.number().int().default(30).describe("Seconds to wait before giving up"),
  }),
  manageHook: z.object({
    action: z
      .enum(["add", "update", "remove", "list"])
      .describe("Action to perform on hooks"),
    scope: z
      .enum(["project", "global"])
      .optional()
      .default("project")
      .describe(
        "Config scope: 'project' for .koincode/config.json, 'global' for ~/.koincode/config.json",
      ),
    eventType: z
      .enum(["PreToolUse", "PostToolUse", "PostToolUseFailure"])
      .describe("Hook event type"),
    matcher: z
      .string()
      .optional()
      .describe("Matcher pattern (e.g., 'Edit|Write', 'Bash', '*')"),
    index: z
      .number()
      .optional()
      .describe(
        "Index of hook to update (for update action). If not provided, replaces all hooks for the matcher",
      ),
    hook: z
      .discriminatedUnion("type", [
        z.object({
          type: z.literal("command"),
          command: z.string(),
          args: z.array(z.string()).optional(),
          timeout: z.number().optional(),
          shell: z.enum(["bash", "powershell"]).optional(),
          async: z.boolean().optional(),
          if: z.string().optional(),
        }),
        z.object({
          type: z.literal("mcp_tool"),
          tool: z.string().describe("Namespaced MCP tool name, e.g. 'slack__post_message'"),
          args: z.record(z.string(), z.unknown()).optional(),
          timeout: z.number().optional(),
          async: z.boolean().optional(),
          if: z.string().optional(),
        }),
      ])
      .optional()
      .describe("Hook handler configuration"),
  }),
} as const;

export const readOnlyToolContracts = {
  readFile: tool({
    description: "Read a file from the current project directory. Supports plain text/code files as well as .pdf and .docx, which are extracted to plain text (visual layout, tables, and embedded images are not preserved). For large files that get truncated, call again with an offset to read the next chunk.",
    inputSchema: toolInputSchemas.readFile,
  }),
  listDirectory: tool({
    description:
      "List entries in a directory under the current project directory.",
    inputSchema: toolInputSchemas.listDirectory,
  }),
  glob: tool({
    description:
      "Find files matching a glob pattern under the current project directory.",
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
    description:
      "Fetch the content of a URL using a headless browser and return the rendered HTML as text. Can handle JavaScript-rendered content from modern frameworks like Next.js and React.",
    inputSchema: toolInputSchemas.webFetch,
  }),
  webSearch: tool({
    description:
      "Search the web using DuckDuckGo and return a list of results with title, URL, and snippet.",
    inputSchema: toolInputSchemas.webSearch,
  }),
  askUser: tool({
    description:
      "Ask the user a question and wait for their response. Use this when you need a decision from the user or clarification before proceeding. Provide clear options; set allowFreeText: true if the user may need to type a custom answer.",
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
  spawnAgent: tool({
    description:
      "Spawn a sub-agent to handle a delegated subtask. The sub-agent runs its own full LLM loop (with tool calls and mode switching) and returns a final text result. Multiple sub-agents can be spawned in parallel in a single turn. Pass runInBackground: true to avoid blocking this turn — its result is delivered here automatically once it finishes, no polling needed. checkAgentTask and scheduleWakeup (with waitingOnTaskId) are optional if you want to check sooner or resume with a specific follow-up prompt. Lower maxTurns/timeoutSeconds for a quick, narrow lookup; raise them for a genuinely long research task — if the sub-agent runs out of either, it returns its partial progress rather than nothing.",
    inputSchema: toolInputSchemas.spawnAgent,
  }),
  checkAgentTask: tool({
    description:
      "Check the status of a sub-agent spawned with runInBackground: true. Returns 'running' with no result yet, or 'completed'/'error' with the final output.",
    inputSchema: toolInputSchemas.checkAgentTask,
  }),
  manageHook: tool({
    description:
      "Manage project hooks in .koincode/config.json. Only modifies the hooks object, leaving permissions and other config untouched. Actions: add (add a hook), update (replace existing hook), remove (delete hook), list (show current hooks).",
    inputSchema: toolInputSchemas.manageHook,
  }),
  readSkill: tool({
    description:
      "Read a skill's instructions and file listing. Omit 'file' to read SKILL.md and see all available files in the skill directory. Pass a relative 'file' path (e.g. 'scripts/run.sh') to read a specific file within the skill. The returned skillDir is the absolute path — use it when constructing shell commands to run skill scripts.",
    inputSchema: toolInputSchemas.readSkill,
  }),
  manageMcp: tool({
    description:
      "List all configured MCP servers, their connection status, and how many tools each one provides. Use this to check which external services (GitHub, Slack, etc.) are available before trying to use their tools.",
    inputSchema: toolInputSchemas.manageMcp,
  }),
} as const;

export const browserToolContracts = {
  serverStart: tool({
    description:
      "Start a server process in the background and wait until the given port accepts TCP connections. Use this before navigating to a locally running app. Works for any TCP server, not just web apps.",
    inputSchema: toolInputSchemas.serverStart,
  }),
  browserNavigate: tool({
    description: "Navigate the browser to a URL and wait for the page to load.",
    inputSchema: toolInputSchemas.browserNavigate,
  }),
  browserScreenshot: tool({
    description:
      "Take a screenshot of the current browser page. Returns an image for vision-capable models and page text for all models. Use after navigating or making changes to verify the visual result.",
    inputSchema: toolInputSchemas.browserScreenshot,
  }),
  browserClick: tool({
    description: "Click an element on the current browser page by CSS selector.",
    inputSchema: toolInputSchemas.browserClick,
  }),
  browserType: tool({
    description: "Type text into an input element on the current browser page by CSS selector.",
    inputSchema: toolInputSchemas.browserType,
  }),
  browserGetConsoleLogs: tool({
    description:
      "Return browser console logs captured since the last call (then clears the buffer). Use to catch JS errors not visible on screen.",
    inputSchema: toolInputSchemas.browserGetConsoleLogs,
  }),
  browserClose: tool({
    description: "Close the browser session. Always call this when testing is complete.",
    inputSchema: toolInputSchemas.browserClose,
  }),
} as const;

export const buildToolContracts = {
  ...readOnlyToolContracts,
  writeFile: tool({
    description:
      "Create or overwrite a file under the current project directory.",
    inputSchema: toolInputSchemas.writeFile,
  }),
  editFile: tool({
    description:
      "Replace exact text in a file under the current project directory.",
    inputSchema: toolInputSchemas.editFile,
  }),
  shell: tool({
    description:
      "Run a shell command in the current project directory. Pass run_in_background: true to avoid blocking this turn on a long-running build/test/watch command — its result is delivered here automatically once it exits, no polling needed. scheduleWakeup (with waitingOnTaskId set to the process's PID, as a string) is optional if you want to resume with a specific follow-up prompt the moment it's done. For starting a dev server, use serverStart instead, which waits for the port to accept connections.",
    inputSchema: toolInputSchemas.shell,
  }),
  scheduleWakeup: tool({
    description:
      "Defer your own next check-in by a delay instead of blocking or polling immediately. Use this when waiting on something you started in the background (e.g. a backgrounded shell command or a runInBackground sub-agent). When the delay elapses, this session automatically continues with the exact prompt you provide. Pass waitingOnTaskId to also resume immediately the moment that specific task finishes, without waiting out the full delay.",
    inputSchema: toolInputSchemas.scheduleWakeup,
  }),
  writeSkill: tool({
    description:
      "Create or update a skill. Writes SKILL.md to the correct scope directory (.koincode/skills/ for project, ~/.koincode/skills/ for global). Only touches SKILL.md — never overwrites scripts/, references/, or assets/. Returns whether the skill was created or updated.",
    inputSchema: toolInputSchemas.writeSkill,
  }),
} as const;

export const buildToolContractsWithBrowser = {
  ...buildToolContracts,
  ...browserToolContracts,
} as const;

export type ToolContracts = typeof buildToolContractsWithBrowser;

export function getToolContracts(mode: ModeType, browserTools?: boolean) {
  if (mode === Mode.PLAN) return readOnlyToolContracts;
  return browserTools ? buildToolContractsWithBrowser : buildToolContracts;
}
