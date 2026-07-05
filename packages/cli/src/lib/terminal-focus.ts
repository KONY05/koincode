// Tracks terminal window focus via DEC private mode 1004 (focus reporting).
// Enabled once in index.tsx (`\x1b[?1004h`); the terminal then sends `\x1b[I` /
// `\x1b[O` on stdin whenever the window gains/loses focus. Registered as an
// OpenTUI `prependInputHandlers` entry since these sequences aren't keys or
// mouse events and would otherwise be dropped as unrecognized input.
let focused = true;

export function isTerminalFocused(): boolean {
  return focused;
}

export function handleFocusSequence(sequence: string): boolean {
  if (sequence === "\x1b[I") {
    focused = true;
    return true;
  }
  if (sequence === "\x1b[O") {
    focused = false;
    return true;
  }
  return false;
}
