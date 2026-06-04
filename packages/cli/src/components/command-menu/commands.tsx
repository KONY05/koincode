import { SUPPORTED_CHAT_MODELS } from "@koincode/shared";
import {
  AgentsDialogContent,
  HelpDialogContent,
  ModelsDialogContent,
  SessionsDialogContent,
  SetupDialogContent,
  ThemeDialogContent,
} from "../dialogs";
import type { Command } from "./types";

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
    name: "exit",
    description: "Quit the application",
    value: "/exit",
    action: (ctx) => {
      ctx.exit();
    },
  },
];
