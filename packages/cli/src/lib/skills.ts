import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";

import { BUILTIN_SKILLS } from "../skills/builtins";

export type SkillScope = "project" | "global" | "builtin";

export type ResolvedSkill = {
  name: string;
  description: string;
  tools: string[];
  scope: SkillScope;
  skillDir: string;
  files: string[];
  content?: string; // present only for built-in skills (inlined)
};

type SkillMeta = {
  name?: string;
  description?: string;
  tools?: string[];
  scope?: string;
};

/** Parses a SKILL.md string into `{ meta, body }`. Handles `key: value` and `key: [a, b, c]` fields. */
function parseFrontmatter(raw: string): { meta: SkillMeta; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const meta: Record<string, unknown> = {};
  for (const line of match[1]!.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      meta[key] = value
        .slice(1, -1)
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
    } else {
      meta[key] = value;
    }
  }

  return { meta: meta as SkillMeta, body: (match[2] ?? "").trim() };
}

/** Recursively lists all file paths inside `dir`, returned as paths relative to `base`. */
function listFilesRecursive(dir: string, base: string = dir): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...listFilesRecursive(abs, base));
      } else {
        results.push(relative(base, abs));
      }
    }
  } catch {
    // ignore unreadable dirs
  }
  return results;
}

/** Reads a single skill folder. Returns null if SKILL.md is missing or unreadable. */
function readSkillDir(skillDir: string, scope: SkillScope): ResolvedSkill | null {
  const skillMdPath = join(skillDir, "SKILL.md");
  if (!existsSync(skillMdPath)) return null;

  let raw: string;
  try {
    raw = readFileSync(skillMdPath, "utf-8");
  } catch {
    return null;
  }

  const { meta } = parseFrontmatter(raw);
  const name = meta.name ?? skillDir.split("/").at(-1) ?? "unknown";
  const files = listFilesRecursive(skillDir).filter((f) => f !== "SKILL.md");

  return {
    name,
    description: meta.description ?? "",
    tools: meta.tools ?? [],
    scope,
    skillDir,
    files,
  };
}

/** Scans a skills container directory (e.g. `~/.koincode/skills/`) and returns all valid skills found. */
function scanSkillsDir(dir: string, scope: SkillScope): ResolvedSkill[] {
  if (!existsSync(dir)) return [];
  const skills: ResolvedSkill[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skill = readSkillDir(join(dir, entry.name), scope);
      if (skill) skills.push(skill);
    }
  } catch {
    // ignore unreadable dirs
  }
  return skills;
}

// Cached after first load — skills don't change while the app is running.
let cache: ResolvedSkill[] | null = null;

/**
 * Returns all available skills in priority order: project-local > global > built-in.
 * Deduplicates by name (first-seen wins). Result is cached for the process lifetime;
 * call `invalidateSkillsCache()` after writing a new skill to force a reload.
 */
export function loadSkillsManifest(): ResolvedSkill[] {
  if (cache) return cache;

  const projectSkillsDir = resolve(process.cwd(), ".koincode", "skills");
  const globalSkillsDir = resolve(homedir(), ".koincode", "skills");

  const project = scanSkillsDir(projectSkillsDir, "project");
  const global = scanSkillsDir(globalSkillsDir, "global");
  const builtins: ResolvedSkill[] = BUILTIN_SKILLS.map((s) => ({
    name: s.name,
    description: s.description,
    tools: s.tools,
    scope: "builtin" as const,
    skillDir: "",
    files: [],
    content: s.content,
  }));

  // Deduplicate: project > global > builtin (first-seen wins)
  const seen = new Set<string>();
  const result: ResolvedSkill[] = [];
  for (const skill of [...project, ...global, ...builtins]) {
    if (!seen.has(skill.name)) {
      seen.add(skill.name);
      result.push(skill);
    }
  }

  cache = result;
  return result;
}

/** Clears the in-memory skills cache. Call after writing a skill so it's visible immediately. */
export function invalidateSkillsCache(): void {
  cache = null;
}

/** Looks up a single skill by name. Returns null if not found. */
export function resolveSkill(name: string): ResolvedSkill | null {
  return loadSkillsManifest().find((s) => s.name === name) ?? null;
}

/**
 * Returns the absolute directory path where a skill should be written.
 * - `"project"` → `.koincode/skills/<name>/` inside the current working directory.
 * - `"global"` → `~/.koincode/skills/<name>/`.
 */
export function getSkillDir(scope: "global" | "project", name: string): string {
  if (scope === "project") {
    return resolve(process.cwd(), ".koincode", "skills", name);
  }
  return resolve(homedir(), ".koincode", "skills", name);
}

export { parseFrontmatter };
