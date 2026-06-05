i want to implement hook usage, like after the model does something it runs a command after or before the operation, how can we implement this in our application.

# how Claude Code implements theirs
theirs is a project scoped (per repository) `.claude/setting.local.json` file, this is so cool, like each repo can customize their hooks however they want.

**Example**
```json
{ 
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "npx tsc --noEmit --pretty 2>&1 | head -20"
          }
        ]
      }
    ]
  }
}
```

there is also a reference implementation from a tutorial that inspired this project.

## reference implementation
this is just an example of how it was implemented somewhere else, so we can use this to get a rough idea of how to go about it

```python
class HookSystem:
    def __init__(self, config: Config):
        self.config = config
        self.hooks: list[HookConfig] = []
        if self.config.hooks_enabled:
            self.hooks = [hook for hook in self.config.hooks if hook.enabled]

    async def _run_hook(self, hook: HookConfig, env: dict[str, str]) -> None:
        try:
            if hook.command:
                await self._run_command(hook.command, hook.timeout_sec, env)
            else:
                with tempfile.NamedTemporaryFile(
                    mode="w", suffix=".sh", delete=False
                ) as f:
                    f.write("#!/bin/bash\n")
                    f.write(hook.script)
                    script_path = f.name
                try:
                    os.chmod(script_path, 0o755)
                    await self._run_command(script_path, hook.timeout_sec, env)
                finally:
                    os.unlink(script_path)
        except Exception as e:
            print(e)

    async def _run_command(
        self,
        command: str,
        timeout: float,
        env: dict[str, str],
    ) -> None:
        process = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=self.config.cwd,
            env=env,
            start_new_session=True,
        )

        try:
            await asyncio.wait_for(process.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            if sys.platform != "win32":
                os.killpg(os.getpgid(process.pid), signal.SIGKILL)
            else:
                process.kill()
            await process.wait()

    def _build_env(
        self,
        trigger: HookTrigger,
        tool_name: str | None = None,
        user_message: str | None = None,
        error: Exception | None = None,
    ) -> dict[str, str]:
        env = os.environ.copy()
        env["AI_AGENT_TRIGGER"] = trigger.value
        env["AI_AGENT_CWD"] = str(self.config.cwd)

        if tool_name:
            env["AI_AGENT_TOOL_NAME"] = tool_name

        if user_message:
            env["AI_AGENT_USER_MESSAGE"] = user_message

        if error:
            env["AI_AGENT_ERROR"] = str(error)

        return env

    async def trigger_before_agent(self, user_message: str) -> None:
        env = self._build_env(
            HookTrigger.BEFORE_AGENT,
            user_message=user_message,
        )

        for hook in self.hooks:
            if hook.trigger == HookTrigger.BEFORE_AGENT:
                await self._run_hook(hook, env)

    async def trigger_after_agent(
        self,
        user_message: str,
        agent_response: str,
    ) -> None:
        env = self._build_env(
            HookTrigger.AFTER_AGENT,
            user_message=user_message,
        )
        env["AI_AGENT_RESPONSE"] = agent_response

        for hook in self.hooks:
            if hook.trigger == HookTrigger.AFTER_AGENT:
                await self._run_hook(hook, env)

    async def trigger_before_tool(
        self,
        tool_name: str,
        tool_params: dict[str, Any],
    ) -> None:
        env = self._build_env(HookTrigger.BEFORE_TOOL, tool_name=tool_name)
        env["AI_AGENT_TOOL_PARAMS"] = json.dumps(tool_params)

        for hook in self.hooks:
            if hook.trigger == HookTrigger.BEFORE_TOOL:
                await self._run_hook(hook, env)

    async def trigger_after_tool(
        self,
        tool_name: str,
        tool_params: dict[str, Any],
        tool_result: ToolResult,
    ) -> None:
        env = self._build_env(HookTrigger.AFTER_TOOL, tool_name=tool_name)
        env["AI_AGENT_TOOL_PARAMS"] = json.dumps(tool_params)
        env["AI_AGENT_TOOL_RESULT"] = tool_result.to_model_output()

        for hook in self.hooks:
            if hook.trigger == HookTrigger.AFTER_TOOL:
                await self._run_hook(hook, env)

    async def trigger_on_error(self, error: Exception) -> None:
        env = self._build_env(HookTrigger.ON_ERROR, error=error)

        for hook in self.hooks:
            if hook.trigger == HookTrigger.ON_ERROR:
                await self._run_hook(hook, env)

```
# Claude Code Command Hook Documentation
[https://code.claude.com/docs/en/hooks#command-hook-fields](https://code.claude.com/docs/en/hooks#command-hook-fields)
## Command hook fields
In addition to the common fields, command hooks accept these fields:
Field	Required	Description
command	yes	Shell command to execute. With args, the executable to spawn directly. See Exec form and shell form
args	no	Argument list. When present, command is resolved as an executable and spawned directly with args as the argument vector, with no shell involved. See Exec form and shell form
async	no	If true, runs in the background without blocking. See Run hooks in the background
asyncRewake	no	If true, runs in the background and wakes Claude on exit code 2. Implies async. The hook’s stderr, or stdout if stderr is empty, is shown to Claude as a system reminder so it can react to a long-running background failure
shell	no	Shell to use for this hook. Accepts "bash" (default) or "powershell". Setting "powershell" runs the command via PowerShell on Windows. Does not require CLAUDE_CODE_USE_POWERSHELL_TOOL since hooks spawn PowerShell directly. Ignored when args is set
Exec form and shell form
A command hook runs as exec form when args is set, and shell form when args is omitted. Set args whenever the hook references a path placeholder, since each element is passed as one argument with no quoting. Omit args when you need shell features like pipes or &&, or when neither concern applies.
Exec form runs when args is present. Claude Code resolves command as an executable on PATH and spawns it directly with args as the argument vector. There is no shell, so each args element is one argument exactly as written, and path placeholders like ${CLAUDE_PLUGIN_ROOT} are substituted into command and into each args element as plain strings. Special characters such as apostrophes, $, and backticks pass through verbatim because there is no shell to interpret them. No shell tokenization happens on any platform.
Shell form runs when args is absent. The command string is passed to a shell: sh -c on macOS and Linux, Git Bash on Windows, or PowerShell when Git Bash isn’t installed. Set the shell field to choose explicitly. The shell tokenizes the string, expands variables, and interprets pipes, &&, redirects, and globs.
On Windows, exec form requires command to resolve to a real executable such as a .exe. The .cmd and .bat shims that npm, npx, eslint, and other tools install in node_modules/.bin are not executables and cannot be spawned without a shell. To run them in exec form, invoke the underlying script with node directly, for example "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/node_modules/eslint/bin/eslint.js"]. The node plus script-path pattern works on every platform because node.exe is a real binary. To run a .cmd or .bat shim by name, use shell form.
This example runs a Node script bundled with a plugin. Exec form passes the resolved script path as one argument with no quoting:
{
  "type": "command",
  "command": "node",
  "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/format.js", "--fix"]
}
The equivalent shell form needs quoting to handle paths with spaces or special characters:
{
  "type": "command",
  "command": "node \"${CLAUDE_PLUGIN_ROOT}\"/scripts/format.js --fix"
}
Both forms support the same path placeholders, and both export them as the environment variables CLAUDE_PROJECT_DIR, CLAUDE_PLUGIN_ROOT, and CLAUDE_PLUGIN_DATA on the spawned process, so a script can read process.env.CLAUDE_PLUGIN_ROOT regardless of how it was launched. Plugin hooks additionally substitute ${user_config.*} values; see User configuration.
In exec form, command is the executable name or path only. If command is a bare name with no path separator and contains whitespace alongside args, Claude Code logs a warning because the spawn will fail: there is no executable named node script.js. Move the extra tokens into args. Absolute paths with spaces, such as C:\Program Files\nodejs\node.exe, are a single valid executable and do not trigger the warning.

## Testing and Validation
**Manual testing scenarios**:

- Create a project with hooks configured
- Test PreToolUse hook that denies a specific tool
- Test PostToolUse hook that runs a linter
- Test PostToolUseFailure hook that logs errors
- Test matcher patterns (exact, OR, wildcard)
- Test hook timeout behavior
- Test hook that modifies tool input/output

**Scope Limitations (Phase 1)**
Not implementing initially:

- HTTP hooks (type: "http")
- MCP tool hooks (type: "mcp_tool")
- Prompt hooks (type: "prompt")
- Agent hooks (type: "agent")
- Async background hooks
- PermissionRequest and PermissionDenied hook events
- Session-level hooks (SessionStart, SessionEnd, etc.)
- File change hooks (FileChanged, CwdChanged, etc.)
