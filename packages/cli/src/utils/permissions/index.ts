import { isSensitivePath } from "./file";
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
  | `shell:bin:${string}`;

export type PendingApproval = {
  key: PermissionKey;
  label: string;
  description: string;
  tier: PermissionTier;
};

export type ApprovalResponse =
  | { type: "allow-once" }
  | { type: "allow-for-project" }
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
      return { requiresApproval: false };
    }
    default:
      return { requiresApproval: false };
  }
}