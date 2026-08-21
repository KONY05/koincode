import { describe, expect, test } from "bun:test";

import {
  findBlockedPattern,
  findCatastrophicPattern,
} from "../tools/shell";

describe("findCatastrophicPattern — refused outright, no approval path", () => {
  test("matches direct rm invocations against root or home", () => {
    for (const command of [
      "rm -rf /",
      "rm -rf / ",
      "rm -fr /",
      "rm -r -f /",
      "rm --recursive --force /",
      "rm -rf /*",
      "rm -rf ~",
      "rm -rf ~/",
      "rm -rf ~/*",
      "sudo rm -rf /",
      "env rm -rf ~",
      "cd /tmp && rm -rf /",
      "sh -c \"rm -rf /\"",
      "bash -lc 'rm -rf ~'",
    ]) {
      expect(findCatastrophicPattern(command)).not.toBeNull();
    }
  });

  test("matches quoted and variable-expanded dangerous targets", () => {
    expect(findCatastrophicPattern("rm -rf '/'")).not.toBeNull();
    expect(findCatastrophicPattern('rm -rf "~"')).not.toBeNull();
    expect(findCatastrophicPattern('rm -rf "$HOME"')).not.toBeNull();
    expect(findCatastrophicPattern("rm -rf ${HOME}")).not.toBeNull();
    expect(findCatastrophicPattern("rm -rf /tmp/..")).not.toBeNull();
    expect(findCatastrophicPattern("rm -rf /..")).not.toBeNull();
  });

  test("matches the fork bomb and raw-device dd writes", () => {
    expect(findCatastrophicPattern(":(){ :|:& };:")).not.toBeNull();
    expect(
      findCatastrophicPattern("dd if=/dev/zero of=/dev/sda"),
    ).not.toBeNull();
    expect(
      findCatastrophicPattern("sudo dd if=/dev/random of=/dev/disk2"),
    ).not.toBeNull();
  });

  test("does NOT match scoped deletes or mere mentions", () => {
    // Scoped deletes are fine (or go through the normal rm prompt).
    expect(findCatastrophicPattern("rm -rf /tmp/koincode-cache")).toBeNull();
    expect(findCatastrophicPattern("git rm -rf subdir")).toBeNull();
    // A mention inside another command is not an invocation — prompt class.
    expect(findCatastrophicPattern('echo "never run rm -rf /"')).toBeNull();
    expect(findCatastrophicPattern("dd if=/dev/zero of=disk.img")).toBeNull();
  });
});

describe("findBlockedPattern — requires explicit user approval", () => {
  test("matches prompt-class dangers", () => {
    expect(findBlockedPattern('echo "never run rm -rf /"')).toMatch(/rm \//);
    expect(findBlockedPattern("chmod 777 /")).toMatch(/chmod \//);
    expect(findBlockedPattern("chmod -R 777 /")).toMatch(/chmod \//);
    expect(findBlockedPattern("mkfs.ext4 /dev/disk1")).toMatch(/mkfs/);
    expect(findBlockedPattern("shutdown -h now")).toMatch(/shutdown/);
    expect(findBlockedPattern("reboot")).toMatch(/reboot/);
    expect(findBlockedPattern("dd if=/dev/zero of=disk.img")).toMatch(/dd/);
  });

  test("returns null for catastrophic matches (handled upstream instead)", () => {
    expect(findBlockedPattern("rm -rf /")).toBeNull();
    expect(findBlockedPattern("sudo rm -rf /*")).toBeNull();
    expect(findBlockedPattern(":(){ :|:& };:")).toBeNull();
    // Catastrophic beats prompt-class when both appear.
    expect(findBlockedPattern("dd if=/dev/zero of=/dev/sda")).toBeNull();
  });

  test("allows ordinary commands and scoped deletes entirely", () => {
    expect(findBlockedPattern("ls -la")).toBeNull();
    expect(findBlockedPattern("bun test")).toBeNull();
    expect(findBlockedPattern("rm -rf /tmp/koincode-cache")).toBeNull();
    expect(findBlockedPattern("rm -rf ~/projects/tmp-build")).toBeNull();
    expect(findBlockedPattern("rm -rf ./dist")).toBeNull();
    expect(findBlockedPattern("git rm -rf subdir")).toBeNull();
    expect(findBlockedPattern("chmod 777 /tmp/upload")).toBeNull();
    expect(findBlockedPattern("chmod -R 644 ./public")).toBeNull();
  });
});
