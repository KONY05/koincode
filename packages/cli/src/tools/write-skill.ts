import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { toolInputSchemas } from "@koincode/shared";
import { getSkillDir, invalidateSkillsCache, parseFrontmatter } from "../lib/skills";

/**
 * Creates or updates a skill's SKILL.md file.
 *
 * - Writes only SKILL.md — never overwrites scripts/, references/, or assets/ subdirectories.
 * - Creates the skill directory (and any parents) if it doesn't exist yet.
 * - Validates that the content has parseable frontmatter with a `name` field before writing.
 * - Detects create vs. update by checking whether SKILL.md already exists.
 * - Busts the in-memory skills cache so the change is visible immediately without a restart.
 * - Returns `{ skillDir, created: boolean, action: "created" | "updated" }`.
 */
export function runWriteSkill(input: unknown) {
  const { name, content, scope } = toolInputSchemas.writeSkill.parse(input);

  // Validate that the content has parseable frontmatter with a name field
  const { meta } = parseFrontmatter(content);
  if (!meta.name) {
    throw new Error(
      "SKILL.md content must include frontmatter with a 'name' field",
    );
  }

  const skillDir = getSkillDir(scope, name);
  const skillMdPath = join(skillDir, "SKILL.md");
  const alreadyExists = existsSync(skillMdPath);

  // Create directory if needed (preserves existing scripts/, references/, assets/)
  mkdirSync(skillDir, { recursive: true });

  writeFileSync(skillMdPath, content, "utf-8");

  // Bust cache so the new/updated skill appears immediately
  invalidateSkillsCache();

  return {
    skillDir,
    created: !alreadyExists,
    action: alreadyExists ? "updated" : "created",
  };
}
