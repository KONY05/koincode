# Feature Spec: Browser Control Integration

## Goal

Allow the agent to autonomously control a browser — navigate to URLs, click elements, fill forms, take screenshots, and read console logs — so it can test web apps it builds, observe the result, and self-correct without user involvement.

## Prerequisites (must be built first)

These two foundations unblock browser control and are useful on their own:

### P: Background Shell Execution

The current `shell` tool blocks until the process exits. `bun run dev` never exits, so the agent can't start a dev server and continue working.

**Change:** Add `run_in_background: boolean` to the `shell` tool schema. When `true`:
- Spawn the process detached (do not wait for exit)
- Return immediately with `{ pid, message: "Process started in background" }`
- The process continues running independently

Also add a `server_start` tool — wraps background shell + port polling so the agent gets a clean `"Server ready on port N"` signal instead of guessing when the server is up.

### M: Multimodal Tool Results

Screenshots are images. Only vision-capable models can interpret them. Text-only models cannot see images regardless of format.

**Changes required:**

1. **Model registry** (`packages/shared/src/models.ts`) — add `vision: boolean` to `SupportedChatModelDefinition`. Mark all current Anthropic and Google models as `true`; OpenAI GPT-5.x as `true`; OpenRouter free-tier models as `false` (unknown/varies).

2. **Tool result format** — `browser_screenshot` returns an array of content parts, not a plain object:
   ```ts
   [
     { type: "image", data: "<base64>", mimeType: "image/png" },
     { type: "text", text: "<page title and visible text as fallback>" }
   ]
   ```
   The AI SDK (`ai` package) supports this format natively in `addToolOutput`. The server's `convertToModelMessages` passes it through to the provider unchanged.

3. **Vision gate** — before the agent can call any `browser_*` tool, check the active model's `vision` flag. If `false`, skip the image part and return only the text fallback. Display a notice in the UI: *"Browser screenshots require a vision-capable model. Text fallback used."*

4. **Storage** — messages containing base64 images stored in the `Message` table will be large. No schema change needed (content is already a TEXT blob), but screenshots should be compressed to JPEG at 85% quality before encoding to keep sizes reasonable (~50–150 KB per screenshot).

---

## Browser Tools

All browser tools are BUILD-mode only. They are executed locally in the CLI (same pattern as `shell`, `writeFile`, etc.). The server never touches the browser.

### Tool Contracts (`packages/shared/src/schemas.ts`)

```ts
browserNavigate: z.object({
  url: z.string().describe("URL to navigate to"),
  waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).default("load"),
})

browserScreenshot: z.object({
  fullPage: z.boolean().default(false).describe("Capture full scrollable page vs. viewport only"),
})

browserClick: z.object({
  selector: z.string().describe("CSS selector of element to click"),
})

browserType: z.object({
  selector: z.string().describe("CSS selector of input to type into"),
  text: z.string().describe("Text to type"),
  clearFirst: z.boolean().default(true).describe("Clear existing value before typing"),
})

browserGetConsoleLogs: z.object({
  types: z.array(z.enum(["log", "info", "warn", "error"])).default(["warn", "error"]),
})

browserClose: z.object({})

serverStart: z.object({
  command: z.string().describe("Shell command to start the server (e.g. 'bun run dev')"),
  port: z.number().describe("Port to poll until ready"),
  timeout: z.number().default(30).describe("Seconds to wait for the port to open"),
})
```

### Tool Implementations (`packages/cli/src/tools/browser/`)

**Session management:** A single Playwright `Browser` and `Page` instance is held in module-level state within `packages/cli/src/tools/browser/session.ts`. It is created lazily on the first `browserNavigate` call and reused across all subsequent tool calls in the same KOINCODE process. `browserClose` tears it down.

```
packages/cli/src/tools/browser/
  session.ts         — holds chromium instance + page, getPage() / closeBrowser()
  navigate.ts        — page.goto()
  screenshot.ts      — page.screenshot(), compress to JPEG, return multimodal content
  click.ts           — page.click()
  type.ts            — page.fill() or page.type()
  console-logs.ts    — collects page.on('console') events, returns on demand
  close.ts           — closeBrowser()
  index.ts           — re-exports all handlers
```

**Playwright dependency:** `playwright` (Bun-compatible). Added to `packages/cli/package.json`. Uses `chromium` only — no Firefox/WebKit needed. Headless by default; headed mode can be enabled via a future config flag.

---

## Shell Tool Changes (`packages/cli/src/tools/shell.ts`)

Add `run_in_background` to the schema and fork behavior:

```ts
if (run_in_background) {
  const proc = Bun.spawn(shellArgs, {
    cwd,
    stdout: "ignore",
    stderr: "ignore",
    env: { ...process.env },
  });
  return { pid: proc.pid, message: `Process started in background (PID ${proc.pid})` };
}
// existing blocking path unchanged
```

`serverStart` internally runs the command in background (same as `shell` with `run_in_background: true`), then polls the port using `Bun.connect` until it accepts a TCP connection or the timeout expires. It never shells out for the poll — no `curl`, no `>/dev/null`, no write-redirection false positive in the permission system.

The key reason for a dedicated tool: the polling command `until curl -s localhost:3000 >/dev/null 2>&1; ...` contains `>` which triggers `hasWriteRedirection` in the permission classifier, showing the user **"Write via shell redirection"** — a misleading and alarming label for what is just a port check. `serverStart` gets its own clean permission key: `shell:bin:serverStart` with label `"Start server and wait for port"`.

This works for any TCP server, not just web apps. Anything that listens on a port.

---

## Model Registry Changes (`packages/shared/src/models.ts`)

```ts
type SupportedChatModelDefinition = {
  id: string;
  provider: SupportedProvider;
  pricing: ModelPricing;
  contextWindow: number;
  vision: boolean;   // ← new
};
```

Vision flag by model family:
- All `claude-*` → `true`
- All `gemini-*` → `true`
- `gpt-5*`, `gpt-4*` → `true`
- OpenRouter free-tier models (owl-alpha, gemma-4, gpt-oss-120b, nex-n2, nemotron) → `false`

Add helper: `export function isVisionModel(modelId: string): boolean`

---

## `executeLocalTool` Changes (`packages/cli/src/tools/index.ts`)

Add cases for all six browser tools and `serverStart`. Browser tools forward to the implementations in `tools/browser/index.ts`.

---

## System Prompt

Add a `# Browser Control` section to `buildSystemPrompt` in BUILD mode (only):

```
# Browser Control
You have access to browser tools: browserNavigate, browserScreenshot, browserClick,
browserType, browserGetConsoleLogs, and browserClose.

Autonomous testing workflow:
1. Use serverStart to launch the server and wait for it to be ready.
2. Call browserNavigate to open the app.
4. Call browserScreenshot to observe the page. Analyze the screenshot carefully.
5. If you see layout issues, errors, or missing features — fix the code, then screenshot again.
6. Use browserGetConsoleLogs to catch JS errors not visible on screen.
7. Call browserClose when testing is complete.

Always close the browser when done. Never leave a browser session open between unrelated tasks.
```

---

## UI

No new UI components required. Browser tool calls render via the existing tool call display in `bot-message.tsx` with plain text labels:

- `browserNavigate` → `"Navigating to <url>"`
- `browserScreenshot` → `"Screenshot taken"`
- `browserClick` → `"Clicked <selector>"`
- `browserType` → `"Typed into <selector>"`
- `browserGetConsoleLogs` → console output as text
- `browserClose` → `"Browser closed"`
- `serverStart` → `"Server ready on port N"` or `"Timed out waiting for port N"`

The screenshot image is returned to the model in the tool result but not rendered in the terminal UI. See Deferred for the inline image preview.

---

## Autonomous Testing Loop (Example)

```
[agent creates a React app with writeFile]
→ serverStart({ command: "bun run dev", port: 3000 })
  ← "Server ready on port 3000"
→ browserNavigate({ url: "http://localhost:3000" })
→ browserScreenshot({})
  ← [image: page with misaligned button]
  "The submit button is overflowing its container. Fixing CSS..."
→ editFile({ path: "src/App.css", ... })
→ browserScreenshot({})
  ← [image: layout fixed]
→ browserClick({ selector: "#submit-btn" })
→ browserGetConsoleLogs({ types: ["error"] })
  ← [{ type: "error", text: "TypeError: Cannot read properties of undefined" }]
  "JS error on click. Fixing handler..."
→ editFile({ path: "src/App.tsx", ... })
→ browserScreenshot({})
  ← [image: working form]
  "All tests pass. Closing browser."
→ browserClose({})
```

---

## Implementation Order

1. **Background shell** — smallest change, unblocks server startup
2. **`serverStart` tool** — builds on background shell; uses `Bun.connect` to poll, no shell-out
3. **Vision flag on model registry** — one-line addition per model, no behavior change yet
4. **Playwright session + browser tools** — core implementation
5. **Multimodal tool result support** — wire up image content parts in `addToolOutput` → verify it reaches the model
6. **Vision gate** — check model capability before returning image content
7. **System prompt section** — add browser control instructions to BUILD mode prompt

---

## Deferred

- **Screenshot inline preview** — render the screenshot image inline in the terminal UI so the user can see what the agent sees. Requires an image rendering primitive in OpenTUI or a sixel/kitty graphics protocol implementation.
- **Headed mode toggle** — run browser in headed (visible window) mode for debugging. Useful but not needed for autonomous operation.
- **Multi-tab support** — single page per session for now.
- **Mobile viewport emulation** — set device viewport dimensions to simulate mobile.
- **Firefox/WebKit** — Chromium only for now.
- **Recording/replaying test scripts** — save browser interactions as reusable test scripts.
