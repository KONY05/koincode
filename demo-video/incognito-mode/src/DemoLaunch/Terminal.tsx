import React from "react";
import { useCurrentFrame } from "remotion";
import { colors, fontFamilyMono, fontFamilySans } from "./theme";

/**
 * Plain viewport frame — the real app has no window chrome (no traffic-light
 * dots, no title bar); it just fills whatever terminal it's running in. This
 * is only a thin rounded-rect border so the content reads as "a terminal
 * window" on video, without inventing fake macOS chrome the app doesn't have.
 */
export const AppViewport: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div
      style={{
        width: 1400,
        height: 700,
        borderRadius: 10,
        background: colors.background,
        border: `1px solid ${colors.thinkingBorder}`,
        boxShadow: "0 40px 120px rgba(0,0,0,0.55)",
        overflow: "hidden",
        fontFamily: fontFamilyMono,
        padding: "36px 52px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {children}
    </div>
  );
};

/** Mirrors the small two-tone "Koin"/"Code" wordmark in components/header.tsx. */
export const AppHeader: React.FC = () => (
  <div
    style={{
      display: "flex",
      justifyContent: "center",
      fontFamily: fontFamilyMono,
      fontSize: 30,
      fontWeight: 700,
      letterSpacing: 1,
      marginBottom: 50,
    }}
  >
    <span style={{ color: colors.white }}>KOIN</span>
    <span style={{ color: colors.primary }}>CODE</span>
  </div>
);

export const Cursor: React.FC<{ visible?: boolean; color?: string }> = ({
  visible = true,
  color = colors.primary,
}) => {
  const frame = useCurrentFrame();
  const on = Math.floor(frame / 15) % 2 === 0;
  return (
    <span
      style={{
        display: "inline-block",
        width: 9,
        height: 24,
        marginLeft: 2,
        transform: "translateY(3px)",
        background: on && visible ? color : "transparent",
      }}
    />
  );
};

/** No leading prompt glyph — the real textarea/UserMessage never shows one. */
export const TypedLine: React.FC<{
  text: string;
  startFrame: number;
  charsPerFrame?: number;
  color?: string;
  fontSize?: number;
}> = ({ text, startFrame, charsPerFrame = 1.1, color = colors.white, fontSize = 22 }) => {
  const frame = useCurrentFrame();
  const elapsed = Math.max(0, frame - startFrame);
  const visibleChars = Math.min(text.length, Math.floor(elapsed * charsPerFrame));
  const done = visibleChars >= text.length;

  if (frame < startFrame) return null;

  return (
    <div style={{ fontSize, lineHeight: `${fontSize + 12}px`, color, display: "flex" }}>
      <span>{text.slice(0, visibleChars)}</span>
      <Cursor visible={!done || Math.floor(frame / 15) % 2 === 0} />
    </div>
  );
};

/** Mirrors BotMessage's plain-text rendering (no border — only tool/reasoning
 * blocks get the fixed thinkingBorder treatment, which this demo never shows). */
export const BotText: React.FC<{ text: string; startFrame: number; fontSize?: number }> = ({
  text,
  startFrame,
  fontSize = 22,
}) => {
  const frame = useCurrentFrame();
  if (frame < startFrame) return null;

  const local = frame - startFrame;
  const opacity = Math.min(1, local / 10);
  const translateY = Math.max(0, 6 - local * 1.2);

  return (
    <div
      style={{
        fontSize,
        lineHeight: `${fontSize + 12}px`,
        color: colors.white,
        opacity,
        transform: `translateY(${translateY}px)`,
        whiteSpace: "pre-wrap",
      }}
    >
      {text}
    </div>
  );
};

type Mode = "Build" | "Plan";

/** Mirrors components/input-bar.tsx's outer bordered box exactly: left-only
 * border, solid "┃" per mode or dashed "┆" when incognito, `╹` bottom-left
 * corner, surface background inside. */
export const InputBarFrame: React.FC<{
  children: React.ReactNode;
  mode: Mode;
  incognito?: boolean;
}> = ({ children, mode, incognito = false }) => {
  const accent = incognito ? colors.info : mode === "Build" ? colors.primary : colors.planMode;
  return (
    <div
      style={{
        borderLeft: `4px ${incognito ? "dashed" : "solid"} ${accent}`,
        background: colors.surface,
        padding: "16px 24px",
      }}
    >
      {children}
    </div>
  );
};

/** Mirrors status-bar.tsx's left segment group: modeLabel (colored) › model name. */
export const StatusRow: React.FC<{ mode: Mode; incognito?: boolean; model: string }> = ({
  mode,
  incognito = false,
  model,
}) => {
  const modeShortLabel = mode;
  const modeLabel = incognito ? `Incognito · ${modeShortLabel}` : modeShortLabel;
  const modeColor = incognito ? colors.info : mode === "Build" ? colors.primary : colors.planMode;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginTop: 14,
        fontFamily: fontFamilyMono,
        fontSize: 16,
      }}
    >
      <span style={{ color: modeColor, fontWeight: 700 }}>{modeLabel}</span>
      <span style={{ color: colors.dimSeparator }}>›</span>
      <span style={{ color: colors.white }}>{model}</span>
    </div>
  );
};

/** Mirrors UserMessage: left-border bubble, solid/dashed per mode/incognito. */
export const MessageBubble: React.FC<{
  text: string;
  mode: Mode;
  incognito?: boolean;
  startFrame: number;
}> = ({ text, mode, incognito = false, startFrame }) => {
  const frame = useCurrentFrame();
  if (frame < startFrame) return null;

  const accent = incognito ? colors.info : mode === "Build" ? colors.primary : colors.planMode;
  const opacity = Math.min(1, (frame - startFrame) / 8);

  return (
    <div
      style={{
        borderLeft: `4px ${incognito ? "dashed" : "solid"} ${accent}`,
        background: colors.surface,
        padding: "18px 24px",
        fontFamily: fontFamilyMono,
        fontSize: 22,
        color: colors.white,
        opacity,
      }}
    >
      {text}
    </div>
  );
};

/** Mirrors session-shell.tsx's bottom-right keybinding hint row. */
export const KeybindHints: React.FC = () => {
  const pairs: [string, string][] = [
    ["opt+enter", "newline"],
    ["ctrl+c", "copy"],
    ["ctrl+z", "undo"],
    ["tab", "agents"],
  ];
  return (
    <div style={{ display: "flex", gap: 20, fontFamily: fontFamilySans, fontSize: 14 }}>
      {pairs.map(([key, label]) => (
        <div key={key} style={{ display: "flex", gap: 6 }}>
          <span style={{ color: colors.white }}>{key}</span>
          <span style={{ color: colors.dimSeparator }}>{label}</span>
        </div>
      ))}
    </div>
  );
};
