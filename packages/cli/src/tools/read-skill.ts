import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { toolInputSchemas } from "@koincode/shared";
import { loadSkillsManifest, resolveSkill } from "../lib/skills";
import { MAX_FILE_SIZE } from "./utils";

/**
 * Reads a skill's content and directory listing.
 *
 * - Omit `file` → returns SKILL.md body + list of all files inside the skill directory.
 * - Pass a relative `file` path → returns that specific file's content (path traversal guarded).
 * - Always returns `skillDir` (absolute path) so the agent can construct correct shell commands,
 *   e.g. `bash /home/user/.koincode/skills/code-review/scripts/run.sh`.
 * - Built-in skills have inlined content and no filesystem directory; sub-file reads are rejected for them.
 * - If the skill name is not found, the error lists all available skill names.
 */
export function runReadSkill(input: unknown) {
  const { name, file } = toolInputSchemas.readSkill.parse(input);

  const skill = resolveSkill(name);
  if (!skill) {
    const available = loadSkillsManifest().map((s) => s.name).join(", ");
    throw new Error(
      `Skill "${name}" not found. Available skills: ${available || "none"}`,
    );
  }

  // Built-in skill: content is inlined, no filesystem to read.
  if (skill.scope === "builtin") {
    if (file) {
      throw new Error(
        `Built-in skill "${name}" has no additional files. Only SKILL.md is available.`,
      );
    }
    return {
      skillDir: null,
      content: skill.content ?? "",
      files: [],
    };
  }

  const skillDir = skill.skillDir;

  if (!file) {
    // Return SKILL.md content + directory listing
    const skillMdPath = join(skillDir, "SKILL.md");
    let content: string;
    try {
      content = readFileSync(skillMdPath, "utf-8");
    } catch {
      throw new Error(`Could not read SKILL.md for skill "${name}"`);
    }
    return {
      skillDir,
      content: content.length > MAX_FILE_SIZE ? content.slice(0, MAX_FILE_SIZE) : content,
      files: skill.files,
    };
  }

  // Guard against path traversal — resolved path must stay inside skillDir
  const resolvedFile = resolve(skillDir, file);
  const rel = relative(skillDir, resolvedFile);
  if (rel.startsWith("..") || rel === "") {
    throw new Error("File path is outside the skill directory");
  }

  let content: string;
  try {
    content = readFileSync(resolvedFile, "utf-8");
  } catch {
    throw new Error(`Could not read "${file}" from skill "${name}"`);
  }

  return {
    skillDir,
    content: content.length > MAX_FILE_SIZE ? content.slice(0, MAX_FILE_SIZE) : content,
  };
}
