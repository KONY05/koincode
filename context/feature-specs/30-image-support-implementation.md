# 30 — Image Support Implementation

## Summary

Users can attach images to prompts by pasting file paths into the textarea. The CLI auto-detects image paths, reads the file, uploads to the server's in-memory image store, and replaces the path with an `[#image:iN]` tag. When the chat request is processed, the server parses image tags from the user text, fetches stored images, and injects them as `FilePart`s into the model messages before calling `streamText`. The feature is gated by the model's `vision` capability.

## Architecture

Images bypass the AI SDK message pipeline entirely. The flow:

1. **CLI detects image path** in textarea → reads file → base64 encodes
2. **CLI uploads** via `POST /images` → server stores in memory `Map`, returns `{ id }`
3. **CLI replaces path** with `[#image:id]` in textarea, shows toast
4. **User sends message** → text with `[#image:iN]` tags goes through normal `sendMessage`
5. **Server chat route** parses `[#image:iN]` from user model message → fetches from store → injects `FilePart`s into model message content → clears used images

This was chosen because the AI SDK strips custom data from message metadata and the `files` parameter on `sendMessage` doesn't reliably include `FileUIPart`s in the message parts for non-browser environments.

## Supported Image Extensions

`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` (max 10MB)

## Detection

- Regex: `/(?:^|\s)((?:\/|\.\/|~\/|\.\.\/)?[^\s]+\.(?:png|jpe?g|gif|webp))(?=\s|$)/gi`
- Matches absolute paths, relative paths, `~/` paths, and bare filenames
- Bare filenames resolve against `process.cwd()`
- Only replaces if file exists, is readable, and under 10MB
- Debounced via `imageProcessingRef` to avoid duplicate processing

## Vision Model Gating

- Check at **submit time** using `isVisionModel(model)` from `@koincode/shared`
- If non-vision model: toast error, block send
- Users can attach images first and switch models before sending

## Files Changed

### `packages/server/src/routes/images.ts` (new)
- In-memory `Map` store for uploaded images
- `POST /` — accepts `{ base64, mimeType, filename }`, returns `{ id }`
- Exports `getStoredImages(ids)` and `clearStoredImages(ids)` for the chat route

### `packages/server/src/index.ts`
- Registers `/images` route

### `packages/server/src/routes/chat.ts`
- After `convertToModelMessages`, parses `[#image:iN]` tags from last user model message
- Fetches stored images, injects as `FilePart`s into message content
- Clears used images from store after injection

### `packages/cli/src/components/input-bar.tsx`
- `tryReadImage()` — resolves path, validates extension/size, reads to base64
- `detectAndReplaceImagePaths()` — scans text for image paths, uploads to server, replaces with `[#image:id]`
- `handleSubmit` gates on `isVisionModel()` when `[#image:iN]` tags present
- Vision model check and toast on submit

### No changes to
- `use-chat.ts` — images don't flow through the chat hook
- `session-shell.tsx` / `session.tsx` — `onSubmit` stays `(text: string) => void`
- `@koincode/shared` — `vision` flag and `isVisionModel()` already existed

## Out of Scope

- Drag and drop (terminal limitation)
- Clipboard binary image paste (OpenTUI is text-oriented)
- Image preview/thumbnail in terminal
- Image compression/resizing
- Persisting images across server restarts (in-memory store is ephemeral)
