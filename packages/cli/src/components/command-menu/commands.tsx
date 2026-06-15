import { SUPPORTED_CHAT_MODELS } from "@koincode/shared";
import {
  AgentsDialogContent,
  ContextDialogContent,
  HelpDialogContent,
  ModelsDialogContent,
  SessionsDialogContent,
  SetupDialogContent,
  ThemeDialogContent,
} from "../dialogs";
import type { Command } from "./types";
import { loadSkillsManifest } from "../../lib/skills";
import { restartServer } from "../../lib/server-manager";
import { readGlobalConfig, updateGlobalConfig } from "../../utils/configs/global-config";
import { checkForUpdate, runUpdate, currentVersion } from "../../lib/update";
import { resolveUsageTarget, openUrl } from "../../lib/usage";

export const COMMANDS: Command[] = [
  {
    name: "new",
    description: "Start a new conversation",
    value: "/new",
    action: (ctx) => {
      ctx.navigate("/");
    },
  },
  {
    name: "handoff",
    description: "Summarize this session and continue in a new one",
    value: "/handoff",
    action: async (ctx) => {
      await ctx.handoff();
    },
  },
  {
    name: "agents",
    description: "Switch agents",
    value: "/agents",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Select Agent",
        children: (
          <AgentsDialogContent
            currentMode={ctx.mode}
            onSelectMode={ctx.setMode}
          />
        ),
      });
    },
  },
  {
    name: "models",
    description: "Select AI model for generation",
    value: "/models",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Select Model",
        children: (
          <ModelsDialogContent
            models={SUPPORTED_CHAT_MODELS}
            onSelectModel={ctx.setModel}
          />
        ),
      });
    },
  },
  {
    name: "sessions",
    description: "Browse past sessions",
    value: "/sessions",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Sessions",
        children: <SessionsDialogContent />,
      });
    },
  },
  {
    name: "theme",
    description: "Change color theme",
    value: "/theme",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Select Theme",
        children: <ThemeDialogContent />,
      });
    },
  },
  {
    name: "setup",
    description: "Configure API keys (OpenRouter, Anthropic, OpenAI, Gemini)",
    value: "/setup",
    action: (ctx) => {
      ctx.dialog.open({
        title: "API Key Setup",
        children: <SetupDialogContent />,
      });
    },
  },
  {
    name: "help",
    description: "Show keyboard shortcuts",
    value: "/help",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Keyboard Shortcuts",
        children: <HelpDialogContent />,
      });
    },
  },
  {
    name: "context",
    description: "View context window usage",
    value: "/context",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Context Usage",
        children: (
          <ContextDialogContent
            contextUsage={ctx.contextUsage}
            model={ctx.model}
          />
        ),
      });
    },
  },
  {
    name: "compact",
    description: "Summarize conversation and reset the context window",
    value: "/compact",
    action: async (ctx) => {
      await ctx.compact();
    },
  },
  {
    name: "clear",
    description: "Reset AI context — start fresh without losing history",
    value: "/clear",
    action: async (ctx) => {
      await ctx.clearSession();
    },
  },
  // TODO: voice input — re-enable once recorder bootstrap is reliable.
  // The infrastructure is in lib/whisper.ts and lib/voice-recorder.ts.
  // Blocker: swiftc compilation at runtime is fragile; solution is to ship a
  // pre-compiled arm64+x86_64 fat binary in the package instead.
  // {
  //   name: "voice",
  //   description: "Toggle voice input (ctrl+r to record)",
  //   value: "/voice",
  //   action: (ctx) => { ctx.toggleVoice(); },
  // },
  {
    name: "browser-headless",
    description: "Toggle headless mode for the browser tool",
    value: "/browser-headless",
    action: (ctx) => {
      const current = readGlobalConfig().browserHeadless ?? false;
      updateGlobalConfig({ browserHeadless: !current });
      ctx.toast.show({
        message: `Browser headless mode ${!current ? "enabled" : "disabled"}`,
        variant: "info",
      });
    },
  },
  {
    name: "restart-server",
    description: "Restart the background server process",
    value: "/restart-server",
    action: async (ctx) => {
      ctx.toast.show({ message: "Restarting server...", variant: "info" });
      try {
        await restartServer();
        ctx.toast.show({ message: "Server restarted", variant: "success" });
      } catch {
        ctx.toast.show({ message: "Failed to restart server", variant: "error" });
      }
    },
  },
  {
    name: "usage",
    description: "Open API usage dashboard for your current provider",
    value: "/usage",
    action: (ctx) => {
      const result = resolveUsageTarget(ctx.model);
      if (result.type === "local") {
        ctx.toast.show({ message: "Local model — no usage page to open", variant: "info" });
        return;
      }
      if (result.type === "no-keys") {
        ctx.toast.show({ message: "No API keys configured. Run /setup to add keys.", variant: "error" });
        return;
      }
      const suffix = result.via === "openrouter" ? " (via OpenRouter)" : "";
      ctx.toast.show({ message: `Opening usage dashboard${suffix}...`, variant: "info" });
      openUrl(result.url);
    },
  },
  {
    name: "update",
    description: "Check for updates and install the latest version",
    value: "/update",
    action: async (ctx) => {
      ctx.toast.show({ message: "Checking for updates...", variant: "info" });
      try {
        const newVersion = await checkForUpdate();
        if (!newVersion) {
          ctx.toast.show({
            message: `Already on the latest version (v${currentVersion})`,
            variant: "info",
          });
          return;
        }
        ctx.toast.show({
          message: `New version v${newVersion} found. Installing...`,
          variant: "info",
        });
        // Brief pause so the user sees the toast before the TUI tears down
        await new Promise<void>((r) => setTimeout(r, 800));
        runUpdate(ctx.destroyRenderer, newVersion);
      } catch {
        ctx.toast.show({ message: "Could not check for updates", variant: "error" });
      }
    },
  },
  {
    name: "exit",
    description: "Quit the application",
    value: "/exit",
    action: (ctx) => {
      ctx.exit();
    },
  },
];

export function loadSkillCommands(): Command[] {
  return loadSkillsManifest().map((skill) => ({
    name: skill.name,
    description: `[${skill.scope}] ${skill.description}`,
    value: `/${skill.name}`,
    isSkill: true,
    action: async (ctx) => {
      await ctx.invokeSkill(skill.name);
    },
  }));
}

export function getAllCommands(): Command[] {
  return [...COMMANDS, ...loadSkillCommands()];
}
