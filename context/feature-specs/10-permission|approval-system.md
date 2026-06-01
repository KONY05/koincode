# Feature Spec: Permission / Approval System

## Overview

When the agent wants to execute a tool (especially destructive ones like `shell`, `writeFile`, `editFile`), the CLI replaces the text input with an **approval widget** the user must interact with before execution continues. The model can also proactively trigger the widget mid-task using a dedicated `askUser` tool.

---

## Two Trigger Modes

### A — Tool-call boundary (reactive / permission check)
The CLI intercepts outgoing tool calls and checks if they need approval. If yes, the input area is replaced by the approval widget. This is the primary safety mechanism.

### B — Model-initiated question (proactive)
The model explicitly calls an `askUser` tool to ask the user something before acting. Example: "I can implement this two ways — which do you prefer?" Same widget UI, different trigger path.

---

## Approval Widget Options

| Option | Behavior |
|---|---|
| **Allow once** | Execute now. If the same permission key appears again this session, ask again. |
| **Allow for project** | Persist `permissionKey → allowed` to `.koincode/config.json`. Auto-approved in future turns and sessions. |
| **Deny** | Hard stop. Agent receives `{ denied: true }` as the tool result and acknowledges gracefully. |
| **Custom / free-text** | Always present as a de-emphasized last option. User types a response. Prevents the user being stuck if the model forgot to offer the right choice. |

The widget can also support any number of model-defined options (for `askUser` calls) — not limited to the three above.

---

## Deny Behavior

Deny is a hard stop. The tool is not executed. The model receives:
```json
{ "denied": true, "reason": "User rejected this action" }
```
The model is expected to acknowledge and ask the user how to proceed, rather than silently continuing.

---

## Permission Key Derivation (System-Derived, No Model Involvement)

The CLI derives a `permissionKey` automatically from the tool call — the model does not supply it, and the tool schemas are not changed.

### Shell tool key derivation (from first token of command)

| Command pattern | Permission key | Risk tier |
|---|---|---|
| `git *` | `shell:git` | normal |
| `npm *`, `bun *`, `yarn *`, `pnpm *` | `shell:npm` | normal |
| `rm *`, `rmdir *` | `shell:rm` | destructive |
| `mv *`, `cp *`, `tee *` | `shell:write` | normal |
| Anything else | `shell:unknown` | normal |

### File tool keys

| Tool | Permission key |
|---|---|
| `writeFile` | `file:write` |
| `editFile` | `file:edit` |
| `readFile` | auto-allowed (read-only, no prompt) |

Destructive-tier tools get a warning indicator in the approval widget UI.

---

## File Operation Rules

File operations default to **allowed** in BUILD mode. The permission system only intervenes at the edges — not on routine writes inside the project.

### Tiers

**Auto-allowed (no prompt):**
- Any `readFile` — always
- Any `writeFile` / `editFile` on a file inside the project root that doesn't match a sensitive pattern

**Always requires approval:**

| Pattern | Reason |
|---|---|
| `.env`, `.env.*`, `.env.local` | Credentials / secrets |
| `**/*.pem`, `**/*.key`, `**/id_rsa`, `**/id_ed25519` | Private keys |
| `.git/config` | Could redirect remotes or change git identity |
| `.github/workflows/**` | CI/CD — runs arbitrary code on push |
| `.koincode/config.json` | Agent must not self-modify its own permissions |
| Any path outside the project root | Writing to `~/.zshrc`, `/etc/hosts`, etc. |

**Destructive warning (prompt shown with red warning label, not a hard gate):**
- Any `deleteFile` call — user sees a warning indicator in the widget but can still allow or deny

### User-Extensible Sensitive Patterns

Users can extend the sensitive list in `.koincode/config.json`. Default patterns are hardcoded in the CLI; user patterns are merged on top.

```json
{
  "sensitivePatterns": [
    "src/config/production.ts",
    "infra/**"
  ]
}
```

---

## Shell vs File Tool Distinction

Shell commands stay tiered by binary name (as defined above) because shell can touch anything regardless of project boundary. File tools (`writeFile`, `editFile`) are safer to default-allow because they operate on explicit, readable paths.

---

## Config File: `.koincode/config.json`

Per-project config. Permissions are one key among others (model overrides, custom instructions, etc. can live here too).

```json
{
  "permissions": {
    "shell:git": "allowed",
    "shell:npm": "allowed",
    "file:edit": "allowed"
  }
}
```

"Allow for project" writes to this file. The CLI reads it at startup and checks it before showing the approval widget.

---

## `askUser` Tool (Model-Initiated Questions)

A tool the model can call explicitly to ask the user a multi-option question mid-task.

```json
{
  "tool": "askUser",
  "question": "Which approach should I take?",
  "options": [
    { "label": "Rewrite from scratch", "value": "rewrite" },
    { "label": "Refactor incrementally", "value": "refactor" }
  ],
  "allowFreeText": true
}
```

The approval widget renders the options. The model receives the user's selected `value` (or typed text) as the tool result and continues.

---

## What Is Not In Scope (Yet)

- Global (cross-project) allow lists
- Per-user permission profiles
- Time-limited permissions ("allow for this session")
- Undo / audit log of approved actions
