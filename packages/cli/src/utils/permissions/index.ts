import { dirname, resolve } from "path";
import { isOutsideProject, isSensitivePath } from "./file";
import getShellPermissionInfo from "./shell";

export type PermissionTier = "normal" | "destructive";

export type PermissionKey =
  | "shell:git"
  | "shell:npm"
  | "shell:cd"
  | "shell:rm"
  | "shell:write"
  | "shell:sudo"
  | "shell:subshell"
  | "shell:interpreter"
  | "file:sensitive"
  | `file:outside:${string}`
  | `shell:bin:${string}`
  | `mcp:${string}`;

export type PendingApproval = {
  key: PermissionKey;
  label: string;
  description: string;
  tier: PermissionTier;
  /** When true, the widget shows "Allow for session" instead of "Allow for project". */
  sessionOnly?: boolean;
};

export type ApprovalResponse =
  | { type: "allow-once" }
  | { type: "allow-for-project" }
  | { type: "allow-for-session" }
  | { type: "deny" };

export type PermissionInfo =
  | { requiresApproval: false }
  | ({ requiresApproval: true } & PendingApproval);



export function getPermissionInfo(
  toolName: string,
  input: unknown,
  extraSensitivePatterns: string[] = [],
): PermissionInfo {
  switch (toolName) {
    case "shell": {
      const { command } = input as { command: string };
      return getShellPermissionInfo(command, extraSensitivePatterns);
    }
    case "serverStart": {
      const { command, port } = input as { command: string; port: number };
      return {
        requiresApproval: true,
        key: "shell:bin:serverStart" as const,
        label: "Start server",
        description: `${command} (waiting for port ${port})`,
        tier: "normal",
      };
    }
    case "writeFile":
    case "editFile": {
      const { path } = input as { path: string };
      if (isSensitivePath(path, extraSensitivePatterns)) {
        return {
          requiresApproval: true,
          key: "file:sensitive",
          label: "Write to sensitive file",
          description: path,
          tier: "destructive",
        };
      }
      if (isOutsideProject(path)) {
        const targetDir = dirname(resolve(path));
        return {
          requiresApproval: true,
          key: `file:outside:${targetDir}` as const,
          label: "Write outside project",
          description: path,
          tier: "normal",
          sessionOnly: true,
        };
      }
      return { requiresApproval: false };
    }
    case "readFile": {
      const { path } = input as { path: string };
      if (isOutsideProject(path)) {
        const targetDir = dirname(resolve(path));
        return {
          requiresApproval: true,
          key: `file:outside:${targetDir}` as const,
          label: "Read outside project",
          description: path,
          tier: "normal",
          sessionOnly: true,
        };
      }
      return { requiresApproval: false };
    }
    default:
      return { requiresApproval: false };
  }
}