/**
 * Minimal YAML-frontmatter parser shared by every `.md`-defined resource
 * (skills, agents).
 *
 * Returns the raw key/value map rather than any one consumer's shape: skills and
 * agents declare different frontmatter fields, and typing the return as either
 * one makes the parser lie to the other. Previously this lived in `lib/skills.ts`
 * and returned `SkillMeta`, so the agent loader had to cast to reach `permission`,
 * `mode` and `model` — fields the type said didn't exist. That worked (the parser
 * never actually dropped keys), but it meant a future change making the return
 * type honest — filtering to known keys, or validating against `SkillMeta` —
 * would have silently stripped an agent's tool restrictions and permission
 * overlay while still parsing cleanly, since agents validate with zod and
 * `description` alone would still pass. A restricted agent quietly becoming
 * unrestricted is not a failure worth risking to save a cast.
 *
 * Each consumer applies its own typed view: skills casts to `SkillMeta`, agents
 * validates with `agentFrontmatterSchema`.
 *
 * Supports `key: value` and `key: [a, b, c]`. Nested maps are not supported —
 * agents express their `permission` map as inline JSON (`{"shell:rm": "ask"}`)
 * and parse it themselves, rather than growing a YAML implementation here.
 */
export function parseFrontmatter(raw: string): {
  meta: Record<string, unknown>;
  body: string;
} {
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

  return { meta, body: (match[2] ?? "").trim() };
}
