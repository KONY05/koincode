# Feature Spec 55 — Image reads in the `readFile` tool

## Background

When an agent is doing research and encounters an image on disk, it currently has two options: wait for the user to tag the image (which uploads it through the `POST /images` store, creates a `[#image:iN]` placeholder, and injects it into the next user message), or give up. Neither is acceptable during autonomous tool-loop execution — the model initiated the read, not the user.

The `[#image:iN]` map-and-tag flow exists because `sendMessage`'s text-only path strips custom message parts. That is a constraint on *user input*, not on tool results. Tool results already have their own, simpler path: the CLI executes the tool locally and calls `chat.addToolOutput({ output })`, which the ai SDK serialises via `convertToModelMessages` and ships to the server as a typed tool-result message. There is no stripping; the output goes straight through.

This means the image-upload store is simply the wrong mechanism. The right fix is to extend the tool itself.

---

## Goal

Allow a vision-capable model to `readFile` an image path and receive the image content directly in the tool-result message, the same way `browserScreenshot` already returns a base64 `image` part today. No new server routes, no upload store, no ID tracking.

---

## Decisions

| # | Decision |
|---|---|
| Size cap | 10 MB — reusing the existing cap from `use-image-attachment.ts` |
| Vision gate placement | Inside `runReadFile` — throw a clear error for non-vision models |
| Supported formats | `.png .jpg .jpeg .gif .webp` only (`.bmp` and `.ico` excluded) |
| CLI renderer | No change — tool output is not rendered in the CLI pane (only input is shown) |

---

## What changes

### 1. `packages/cli/src/tools/read-file.ts`

**Image extension carve-out**

`BINARY_EXTENSIONS` currently includes `.png .jpg .jpeg .gif .webp .bmp .ico`. The image-readable subset is extracted into a separate constant, `IMAGE_EXTENSIONS` (`.png .jpg .jpeg .gif .webp`). `.bmp` and `.ico` stay in `BINARY_EXTENSIONS` and continue to throw.

The tool receives `modelId` as a new optional parameter so `extractFileContent` can gate on it.

Inside `extractFileContent`, before falling through to the binary/text path, check if the resolved extension is in `IMAGE_EXTENSIONS`:

```ts
type ImageFileResult = {
  isImage: true;
  path: string;      // display path (formatWorkspacePath output)
  mediaType: string; // e.g. "image/png"
  data: string;      // base64-encoded file bytes
  filename: string;  // basename only, for the SDK's filename hint
  summary: string;   // "image/png · 48 KB"
};
```

**`runReadFile` logic for images**

1. Stat the file. Reject with a clear error if `size > 10_485_760` (10 MB).
2. Check `isVisionModel(modelId)`. If false, throw: `"This file is an image. Switch to a vision-capable model to read it directly."`. Consistent with how `extractFileContent` already throws for other unreadable formats.
3. Read the whole file, base64-encode it.
4. Return `ImageFileResult` directly — skip line-numbering, pagination, and AGENTS.md logic (text-only concerns).

Non-image paths return the existing shape unchanged.

---

### 2. `packages/cli/src/hooks/use-chat.ts` — tool output submission

When `executeLocalTool` returns an `ImageFileResult`, dispatch `chat.addToolOutput` with a `content` array (same `LanguageModelV3ToolResultOutput` shape MCP tools use):

```ts
if (
  toolCall.toolName === "readFile" &&
  output &&
  typeof output === "object" &&
  "isImage" in output &&
  (output as ImageFileResult).isImage
) {
  const img = output as ImageFileResult;
  chat.addToolOutput({
    tool: "readFile",
    toolCallId: toolCall.toolCallId,
    output: img.summary,   // short text for session history
    content: [
      {
        type: "file",
        data: img.data,
        mediaType: img.mediaType,
        filename: img.filename,
      },
    ],
  });
} else {
  chat.addToolOutput({
    tool: toolCall.toolName as keyof ChatTools,
    toolCallId: toolCall.toolCallId,
    output,
  });
}
```

---

## Files touched

| File | Change |
|---|---|
| `packages/cli/src/tools/read-file.ts` | Carve out `IMAGE_EXTENSIONS`; add image read branch returning `ImageFileResult`; gate on `isVisionModel`; add 10 MB size rejection |
| `packages/cli/src/hooks/use-chat.ts` | Detect `ImageFileResult` output; dispatch with `content` array |
| `packages/shared/src/models.ts` | No change — `isVisionModel` is already exported |

No server changes. No new routes. No new DB columns. No new store.

---

## What is deliberately out of scope

- `.svg` — XML/text; the existing text path already handles it.
- `.pdf` / `.docx` — already handled via text extraction (`unpdf`, `mammoth`).
- `.bmp` / `.ico` — excluded from initial image set; continue to throw as binary.
- Other binary formats (`.mp4`, `.zip`, etc.) — unchanged; still throw `Cannot read binary file`.
- Session history persistence of image bytes — base64 bytes live only in the in-flight tool-result message, never written to the DB. Matches `browserScreenshot` behaviour.
