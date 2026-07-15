import { SUPPORTED_CHAT_MODELS } from "@koincode/shared";
import {
  AgentsDialogContent,
  ContextDialogContent,
  DirectoryPickerDialogContent,
  HelpDialogContent,
  ModelsDialogContent,
  ReviewStatusDialogContent,
  SessionsDialogContent,
  SetupDialogContent,
  ThemeDialogContent,
} from "../dialogs";
import type { Command } from "./types";
import { loadSkillsManifest } from "../../lib/skills";
import { restartServer } from "../../lib/server-manager";
import {
  readGlobalConfig,
  updateGlobalConfig,
} from "../../utils/configs/global-config";
import {
  checkForUpdate,
  runUpdate,
  currentVersion,
} from "../../lib/update-cli";
import { resolveUsageTarget, openUrl } from "../../lib/usage";
import { readReviewAuth, writeReviewAuth } from "../../lib/review/review-auth";
import { resolveCurrentRepo } from "../../lib/review/review-repo";
import {
  connectRepo as connectReviewRepo,
  disconnectRepo as disconnectReviewRepo,
  getReviewApiUrl,
  pollDeviceToken,
  startDeviceAuth,
  syncApiKey,
} from "../../lib/review/review-api";
import { resolveSyncableKey } from "../../lib/review/review-key-sync";

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
            model={ctx.modelDisplayName}
          />
        ),
      });
    },
  },
  {
    name: "info",
    description: "Toggle the info sidebar (context, cost, mcp, modified files)",
    value: "/info",
    action: (ctx) => {
      ctx.toggleInfoSidebar();
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
    name: "enable-browser-tools",
    description: "Toggle browser tools (serverStart, browserNavigate, etc.)",
    value: "/enable-browser-tools",
    action: (ctx) => {
      const current = readGlobalConfig().browser?.enabled ?? false;
      updateGlobalConfig({ browser: { enabled: !current } });
      if (!current) {
        // Enabling — try to resolve a browser
        import("../../lib/browser-setup").then(({ resolveBrowser }) => {
          const resolution = resolveBrowser();
          const detail =
            resolution.type === "chrome"
              ? " (using system Chrome)"
              : resolution.type === "playwright-cache"
                ? " (using cached Chromium)"
                : " — no browser found, install Chrome or run: npx playwright install chromium";
          ctx.toast.show({
            message: `Browser tools enabled${detail}`,
            variant: "success",
          });
        });
      } else {
        ctx.toast.show({
          message: "Browser tools disabled",
          variant: "info",
        });
      }
    },
  },
  {
    name: "browser-headless",
    description: "Toggle headless mode for the browser tool",
    value: "/browser-headless",
    action: (ctx) => {
      const current = readGlobalConfig().browser?.headless ?? false;
      updateGlobalConfig({ browser: { headless: !current } });
      ctx.toast.show({
        message: `Browser headless mode ${!current ? "enabled" : "disabled"}`,
        variant: "info",
      });
    },
  },
  {
    name: "notifications",
    description: "Toggle terminal bell when the agent needs your attention",
    value: "/notifications",
    action: (ctx) => {
      const current = readGlobalConfig().notificationEnabled ?? true;

      updateGlobalConfig({ notificationEnabled: !current });

      ctx.toast.show({
        message: `Terminal bell notifications ${!current ? "enabled" : "disabled"}`,
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
        ctx.toast.show({
          message: "Failed to restart server",
          variant: "error",
        });
      }
    },
  },
  {
    name: "add-dir",
    description: "Add another directory to this session's workspace",
    value: "/add-dir",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Add Directory",
        children: <DirectoryPickerDialogContent onSelect={ctx.addWorkspaceRoot} />,
      });
    },
  },
  {
    name: "usage",
    description: "Open API usage dashboard for your current provider",
    value: "/usage",
    action: (ctx) => {
      const result = resolveUsageTarget(ctx.model);
      if (result.type === "ollama") {
        ctx.toast.show({
          message: "Local model — no usage page to open",
          variant: "info",
        });
        return;
      }
      if (result.type === "custom") {
        ctx.toast.show({
          message: "No usage dashboard registered for custom providers",
          variant: "info",
        });
        return;
      }
      if (result.type === "no-keys") {
        ctx.toast.show({
          message: "No API keys configured. Run /setup to add keys.",
          variant: "error",
        });
        return;
      }
      const suffix = result.via === "openrouter" ? " (via OpenRouter)" : "";
      ctx.toast.show({
        message: `Opening usage dashboard${suffix}...`,
        variant: "info",
      });
      openUrl(result.url);
    },
  },
  {
    name: "review-login",
    description: "Connect this CLI to your KOINCODE-Review account",
    value: "/review-login",
    action: async (ctx) => {
      if (readReviewAuth()) {
        ctx.toast.show({
          message: "Already logged in to KOINCODE-Review",
          variant: "info",
        });
        return;
      }

      try {
        const { deviceCode, verificationUrl, expiresIn, interval } =
          await startDeviceAuth();

        openUrl(
          `${verificationUrl}?device_code=${encodeURIComponent(deviceCode)}`,
        );

        ctx.toast.show({
          message: "Waiting for approval in browser…",
          variant: "info",
        });

        const deadline = Date.now() + expiresIn * 1000;
        while (Date.now() < deadline) {
          await new Promise<void>((r) => setTimeout(r, interval * 1000));
          const result = await pollDeviceToken(deviceCode);

          if (result.status === "approved") {
            writeReviewAuth({ token: result.token, userId: result.userId });

            ctx.toast.show({
              message: "Logged in to KOINCODE-Review",
              variant: "success",
            });
            return;
          }

          if (result.status === "denied") {
            ctx.toast.show({
              message: "Login request denied",
              variant: "error",
            });
            return;
          }

          if (result.status === "expired") {
            ctx.toast.show({
              message: "Login request expired — run /review-login again",
              variant: "error",
            });
            return;
          }
        }

        ctx.toast.show({
          message: "Login timed out — run /review-login again",
          variant: "error",
        });
      } catch (err) {
        ctx.toast.show({
          message: err instanceof Error ? err.message : "Login failed",
          variant: "error",
        });
      }
    },
  },
  {
    name: "review-connect",
    description:
      "Connect the current repo to KOINCODE-Review for automatic PR reviews",
    value: "/review-connect",
    action: async (ctx) => {
      if (!readReviewAuth()) {
        ctx.toast.show({
          message: "Not logged in. Run /review-login first.",
          variant: "error",
        });
        return;
      }

      const resolved = resolveCurrentRepo();
      if (!resolved.ok) {
        ctx.toast.show({
          message:
            resolved.reason === "no-remote"
              ? "No git remote found in this directory"
              : "Only GitHub repositories are supported",
          variant: "error",
        });
        return;
      }

      try {
        const result = await connectReviewRepo(
          resolved.repo.owner,
          resolved.repo.repo,
        );

        ctx.toast.show({
          message: `Connected ${result.repo.fullName} to KOINCODE-Review`,
          variant: "success",
        });
      } catch (err) {
        ctx.toast.show({
          message:
            err instanceof Error ? err.message : "Failed to connect repository",
          variant: "error",
        });
      }
    },
  },
  {
    name: "review-disconnect",
    description: "Disconnect the current repo from KOINCODE-Review",
    value: "/review-disconnect",
    action: async (ctx) => {
      if (!readReviewAuth()) {
        ctx.toast.show({
          message: "Not logged in. Run /review-login first.",
          variant: "error",
        });
        return;
      }

      const resolved = resolveCurrentRepo();
      if (!resolved.ok) {
        ctx.toast.show({
          message:
            resolved.reason === "no-remote"
              ? "No git remote found in this directory"
              : "Only GitHub repositories are supported",
          variant: "error",
        });
        return;
      }

      try {
        await disconnectReviewRepo(resolved.repo.owner, resolved.repo.repo);

        ctx.toast.show({
          message: `Disconnected ${resolved.repo.owner}/${resolved.repo.repo} from KOINCODE-Review`,
          variant: "success",
        });
      } catch (err) {
        ctx.toast.show({
          message:
            err instanceof Error
              ? err.message
              : "Failed to disconnect repository",
          variant: "error",
        });
      }
    },
  },
  {
    name: "review-status",
    description: "Show KOINCODE-Review connection status for the current repo",
    value: "/review-status",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Review Status",
        children: <ReviewStatusDialogContent />,
      });
    },
  },
  {
    name: "review-open",
    description: "Open the KOINCODE-Review dashboard in your browser",
    value: "/review-open",
    action: () => {
      openUrl(`${getReviewApiUrl()}/reviews`);
    },
  },
  {
    name: "review-sync-keys",
    description:
      "Push the CLI's active provider API key + model into KOINCODE-Review",
    value: "/review-sync-keys",
    action: async (ctx) => {
      if (!readReviewAuth()) {
        ctx.toast.show({
          message: "Not logged in. Run /review-login first.",
          variant: "error",
        });
        return;
      }

      const resolved = resolveSyncableKey(ctx.model);
      if (!resolved.ok) {
        ctx.toast.show({
          message:
            resolved.reason === "unsupported-model"
              ? "Current model isn't supported by KOINCODE-Review (needs a direct Anthropic/OpenAI/Google key, or a native OpenRouter model)."
              : "No API key configured for this model's provider.",
          variant: "error",
        });
        return;
      }

      try {
        await syncApiKey(resolved.provider, resolved.model, resolved.apiKey);

        ctx.toast.show({
          message: `Synced ${resolved.provider} (${resolved.model}) to KOINCODE-Review`,
          variant: "success",
        });
      } catch (err) {
        ctx.toast.show({
          message: err instanceof Error ? err.message : "Failed to sync API key",
          variant: "error",
        });
      }
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
        ctx.toast.show({
          message: "Could not check for updates",
          variant: "error",
        });
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
