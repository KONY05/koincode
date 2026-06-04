import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

import {
  toolInputSchemas,
  CONFIG_FILE,
  CONFIG_DIR,
  type HookMatcherGroup,
} from "@koincode/shared";

function getProjectPaths() {
  const dir = join(process.cwd(), ".koincode");
  return { dir, file: join(dir, "config.json") };
}

function getGlobalPaths() {
  return { dir: CONFIG_DIR, file: CONFIG_FILE };
}

function readProjectConfig() {
  try {
    const { file } = getProjectPaths();
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function readGlobalConfig() {
  try {
    const { file } = getGlobalPaths();
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function writeProjectConfig(config: unknown) {
  const { dir, file } = getProjectPaths();
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(config, null, 2));
}

function writeGlobalConfig(config: unknown) {
  const { dir, file } = getGlobalPaths();
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(config, null, 2));
}

export async function runManageHook(input: unknown) {
  const { action, eventType, matcher, index, hook } =
    toolInputSchemas.manageHook.parse(input);

  // Default to project scope
  const scope = (input as { scope?: "project" | "global" }).scope || "project";

  const config = scope === "global" ? readGlobalConfig() : readProjectConfig();

  // Ensure hooks object exists
  if (!config.hooks) {
    config.hooks = {};
  }

  // Handle list action
  if (action === "list") {
    return {
      success: true as const,
      scope,
      hooks: config.hooks,
    };
  }

  // Validate required fields for other actions
  if (!eventType) {
    throw new Error(
      "eventType is required for add, update, and remove actions",
    );
  }
  if (!matcher) {
    throw new Error("matcher is required for add, update, and remove actions");
  }

  // Ensure event type array exists
  if (!config.hooks[eventType]) {
    config.hooks[eventType] = [];
  }

  const eventHooks = config.hooks[eventType];

  switch (action) {
    case "add": {
      if (!hook) {
        throw new Error("hook configuration is required for add action");
      }

      // Check if matcher already exists
      const existingIndex = eventHooks.findIndex(
        (h: HookMatcherGroup) => h.matcher === matcher,
      );
      if (existingIndex !== -1) {
        // Add hook to existing group (support multiple hooks per matcher)
        eventHooks[existingIndex].hooks.push(hook);
      } else {
        // Create new hook group
        eventHooks.push({ matcher, hooks: [hook] });
      }

      if (scope === "global") {
        writeGlobalConfig(config);
      } else {
        writeProjectConfig(config);
      }

      return {
        success: true as const,
        message: `Added hook for ${eventType} with matcher "${matcher}" to ${scope} config`,
      };
    }

    case "update": {
      if (!hook) {
        throw new Error("hook configuration is required for update action");
      }

      // Find existing hook group
      const existingGroupIndex = eventHooks.findIndex(
        (h: HookMatcherGroup) => h.matcher === matcher,
      );
      if (existingGroupIndex === -1) {
        throw new Error(
          `Hook with matcher "${matcher}" not found for event ${eventType}. Use add action instead.`,
        );
      }

      const hookGroup = eventHooks[existingGroupIndex];

      // If index is provided, update specific hook in the array
      if (index !== undefined) {
        if (index < 0 || index >= hookGroup.hooks.length) {
          throw new Error(
            `Hook index ${index} out of range (0-${hookGroup.hooks.length - 1})`,
          );
        }
        hookGroup.hooks[index] = hook;
      } else {
        // Replace all hooks for this matcher
        eventHooks[existingGroupIndex] = { matcher, hooks: [hook] };
      }

      if (scope === "global") {
        writeGlobalConfig(config);
      } else {
        writeProjectConfig(config);
      }

      return {
        success: true as const,
        message:
          index !== undefined
            ? `Updated hook at index ${index} for ${eventType} with matcher "${matcher}" in ${scope} config`
            : `Updated all hooks for ${eventType} with matcher "${matcher}" in ${scope} config`,
      };
    }

    case "remove": {
      const existingIndex = eventHooks.findIndex(
        (h: HookMatcherGroup) => h.matcher === matcher,
      );
      if (existingIndex === -1) {
        throw new Error(
          `Hook with matcher "${matcher}" not found for event ${eventType}`,
        );
      }

      eventHooks.splice(existingIndex, 1);

      if (scope === "global") {
        writeGlobalConfig(config);
      } else {
        writeProjectConfig(config);
      }

      return {
        success: true as const,
        message: `Removed hook for ${eventType} with matcher "${matcher}" from ${scope} config`,
      };
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
