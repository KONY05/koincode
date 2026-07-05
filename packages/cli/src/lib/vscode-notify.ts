import fs from "node:fs";

import { GLOBAL_CONFIG_DIR, NOTIFY_REQUEST_FILE } from "@koincode/shared";

// Fallback for VS Code-family integrated terminals, which ignore the BEL
// character (\x07) by default. The bundled editor extension (ide-extension.ts)
// watches NOTIFY_REQUEST_FILE and relays this as a real editor notification.
export function notifyVsCode(message: string): void {
  if (process.env.TERM_PROGRAM !== "vscode") return;
  try {
    fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(
      NOTIFY_REQUEST_FILE,
      JSON.stringify({ message, at: Date.now() }),
    );
  } catch {
    // Non-fatal — falls back to the terminal bell only.
  }
}
