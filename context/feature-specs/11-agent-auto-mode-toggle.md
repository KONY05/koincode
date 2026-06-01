# Feature Spec: Agent Auto Mode Toggle

## Overview

Allow the agent to autonomously switch between PLAN and BUILD modes based on task requirements. The agent signals intent via a `switchMode` tool call; the CLI intercepts it, optionally prompts the user, and updates the active mode.

---

## Mechanism

### Tool: `switchMode`

Defined in `@koincode/shared` alongside the existing tool contracts. Available in **both** PLAN and BUILD tool sets so the agent can always request a switch.

```ts
switchMode(target: "PLAN" | "BUILD", reason: string)
```

- `target` — the mode to switch into
- `reason` — short explanation surfaced to the user in the confirmation widget

Executed **locally in the CLI** (same pattern as all other tools — server streams the call, CLI handles it). The server never changes mode state.

---

## Mode Switch Behavior

### Edge Cases
- **Same-mode switch (PLAN → PLAN, BUILD → BUILD):** No-op. The tool returns immediately, no widget is shown, no system message is emitted. The agent gets a result of `"already in {mode} mode"` so it can continue without confusion.

### BUILD → PLAN
Always silent. No confirmation. The agent switches freely when it only needs to read/analyze.

### PLAN → BUILD
Controlled by a global config setting (see below). Either:
- **`"confirm"`** — show the `ModeSwitchWidget`, require user approval before the agent continues
- **`"auto"`** — switch silently, no prompt

---

## Global Config

Add to the global CLI settings (alongside existing prompt config):

```ts
autoModeSwitch: "confirm" | "auto"  // default: "confirm"
```

This is a UX preference, not per-project. Lives in global settings, not session state.

---

## UI

### System Message — mode switch indicator

When a mode switch occurs (confirmed or silent), render an inline divider in the chat transcript — **not** a message bubble:

```
─────────────── Switched to BUILD mode ───────────────
```

Styled like the "Compacted" context divider: centered label, muted foreground, no border or background box. Rendered as its own transcript entry type (`type: "system"`).

### ModeSwitchWidget — confirmation prompt

A slimmer variant of `ApprovalWidget` with two options only. Shown inline in the transcript when `autoModeSwitch: "confirm"` and the agent requests PLAN → BUILD.

```
┃
┃  ⚡ Switch to BUILD mode?
┃  "{reason from agent}"
┃
┃  › [1] Allow once
┃    [2] Always allow (set to auto)
┃    [3] Deny
┃
```

- Border color: `colors.warning` (escalation, not destructive)
- Keyboard: `1` / `Enter` = allow once, `2` = set global config to `"auto"` and allow, `3` / `Escape` = deny
- "Always allow" immediately updates the global `autoModeSwitch` config to `"auto"` — future switches skip the widget entirely

### On Deny

The widget dismisses. The agent is unblocked to send **one** message (not tool calls) explaining it needs BUILD mode to proceed. Then a system message appears:

```
─── BUILD mode required. Switch manually with /agent build ───
```

The agent does not retry the switch automatically.

---

## Implementation Touchpoints

| Area | Change |
|---|---|
| `@koincode/shared/schemas.ts` | Add `switchMode` to both PLAN and BUILD tool sets |
| `packages/cli/src/lib/local-tools.ts` | Handle `switchMode` tool call — update mode state, emit system message |
| `packages/cli/src/components/widget/` | New `ModeSwitchWidget` component |
| `packages/cli/src/providers/` | Add `autoModeSwitch` to global config provider |
| Chat transcript | New `system` message type rendered as a divider row |

---

## Design Decisions (Resolved)

- **System message color:** Always muted/gray. Not mode-specific.
- **Multiple switches per session:** No limit. The agent can switch back and forth freely — this is expected behavior (e.g. analyze → write → analyze again). Same-mode guard prevents redundant no-op calls. No thrashing risk since the agent needs a deliberate tool call each time.
