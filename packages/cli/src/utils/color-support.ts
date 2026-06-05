import type { ThemeColors } from "../providers/theme/theme";

export function supportsTrueColor(): boolean {
  const { COLORTERM, TERM, TERM_PROGRAM } = process.env;
  if (COLORTERM === "truecolor" || COLORTERM === "24bit") return true;
  if (TERM === "xterm-kitty") return true;
  if (TERM_PROGRAM === "iTerm.app") return true;
  if (TERM_PROGRAM === "WezTerm") return true;
  if (TERM_PROGRAM === "ghostty") return true;
  if (TERM_PROGRAM === "vscode") return true;
  return false;
}

// The ANSI 256-color cube has 6 levels per channel with these exact RGB values.
// We snap each channel to the nearest level so colors stay intentional rather
// than being randomly approximated by the terminal.
function snapChannel(v: number): number {
  if (v < 48) return 0;
  if (v < 115) return 95;
  if (v < 155) return 135;
  if (v < 195) return 175;
  if (v < 235) return 215;
  return 255;
}

function quantizeHex(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const rq = snapChannel(r);
  const gq = snapChannel(g);
  const bq = snapChannel(b);
  return `#${rq.toString(16).padStart(2, "0")}${gq.toString(16).padStart(2, "0")}${bq.toString(16).padStart(2, "0")}`;
}

export function quantizeThemeColors(colors: ThemeColors): ThemeColors {
  return Object.fromEntries(
    Object.entries(colors).map(([key, value]) => [key, quantizeHex(value)]),
  ) as ThemeColors;
}
