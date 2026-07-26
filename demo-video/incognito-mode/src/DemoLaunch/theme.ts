// Exact values from the real app's default theme ("Ayu Dark",
// packages/cli/src/providers/theme/theme.ts) — not invented colors, so the
// video's palette matches what the feature actually looks like on screen.
export const colors = {
  background: "#0B0E14",
  surface: "#11151C",
  primary: "#E6B450",
  planMode: "#D2A6FF",
  info: "#59C2FF",
  success: "#7FD962",
  error: "#D95757",
  thinkingBorder: "#2D3640",
  dimSeparator: "#475266",
  white: "#FFFFFF",
} as const;

export const fontFamilyMono =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

export const fontFamilySans =
  '-apple-system, "Inter", "Helvetica Neue", Arial, sans-serif';
