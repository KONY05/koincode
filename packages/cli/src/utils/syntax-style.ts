import { RGBA, SyntaxStyle } from "@opentui/core";

import type { ThemeColors } from "../providers/theme/theme";

export function createMarkdownSyntaxStyle(colors: ThemeColors): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    // Markdown structure
    "markup.heading": { bold: true, fg: RGBA.fromHex(colors.primary) },
    "markup.strong": { bold: true },
    "markup.italic": { italic: true },
    "markup.strikethrough": { dim: true },
    "markup.raw": { fg: RGBA.fromHex(colors.info) },
    "markup.link.label": { underline: true, fg: RGBA.fromHex(colors.primary) },
    "markup.link.url": { dim: true },
    "markup.link": { underline: true },
    // Code syntax highlight groups (tree-sitter capture names)
    keyword: { fg: RGBA.fromHex(colors.planMode) },
    "keyword.operator": { fg: RGBA.fromHex(colors.planMode) },
    "keyword.return": { fg: RGBA.fromHex(colors.planMode) },
    string: { fg: RGBA.fromHex(colors.success) },
    "string.special": { fg: RGBA.fromHex(colors.success) },
    comment: { fg: RGBA.fromHex(colors.dimSeparator), dim: true },
    number: { fg: RGBA.fromHex(colors.primary) },
    function: { fg: RGBA.fromHex(colors.info) },
    "function.method": { fg: RGBA.fromHex(colors.info) },
    "function.builtin": { fg: RGBA.fromHex(colors.info) },
    type: { fg: RGBA.fromHex(colors.primary) },
    "type.builtin": { fg: RGBA.fromHex(colors.planMode) },
    constant: { fg: RGBA.fromHex(colors.planMode) },
    "constant.builtin": { fg: RGBA.fromHex(colors.planMode) },
    "variable.builtin": { fg: RGBA.fromHex(colors.planMode) },
    operator: { fg: RGBA.fromHex(colors.primary) },
    property: { fg: RGBA.fromHex(colors.selection) },
    tag: { fg: RGBA.fromHex(colors.error) },
    attribute: { fg: RGBA.fromHex(colors.planMode) },
    "punctuation.bracket": { fg: RGBA.fromHex(colors.dimSeparator) },
    "punctuation.delimiter": { fg: RGBA.fromHex(colors.dimSeparator) },
  });
}
