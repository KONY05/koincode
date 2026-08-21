import { describe, expect, test } from "bun:test";

import getShellPermissionInfo from "../utils/permissions/shell";

describe("getShellPermissionInfo — prompt-class escalation", () => {
  test("escalates prompt-class patterns to shell:destructive", () => {
    for (const command of [
      "chmod 777 /",
      "chmod -R 777 /",
      "shutdown -h now",
      "dd if=/dev/zero of=disk.img",
      // A mention inside an otherwise read-only command still surfaces.
      'echo "never run rm -rf /"',
    ]) {
      const info = getShellPermissionInfo(command);
      expect(info.requiresApproval).toBe(true);
      if (info.requiresApproval) {
        expect(info.key).toBe("shell:destructive");
        expect(info.tier).toBe("destructive");
        // Session-only: no permanent project-wide allow for this class.
        expect(info.sessionOnly).toBe(true);
      }
    }
  });

  test("catastrophic rm falls through to the normal rm classification", () => {
    // `rm -rf /` is refused upstream in use-chat's onToolCall (no prompt at
    // all), so the classifier intentionally treats it like any other rm here.
    const info = getShellPermissionInfo("rm -rf /");
    expect(info.requiresApproval).toBe(true);
    if (info.requiresApproval) {
      expect(info.key).toBe("shell:rm");
    }
  });

  test("does not escalate ordinary scoped deletes", () => {
    const info = getShellPermissionInfo("rm -rf /tmp/koincode-cache");
    expect(info.requiresApproval).toBe(true);
    if (info.requiresApproval) {
      expect(info.key).toBe("shell:rm");
      expect(info.tier).toBe("destructive");
    }
  });

  test("leaves harmless commands unprompted", () => {
    expect(getShellPermissionInfo("echo hello")).toEqual({
      requiresApproval: false,
    });
    expect(getShellPermissionInfo("ls -la | grep src")).toEqual({
      requiresApproval: false,
    });
  });
});
