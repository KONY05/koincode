import React from "react";
import { useCurrentFrame } from "remotion";
import { colors, fontFamilyMono } from "./theme";

export const TerminalWindow: React.FC<{
  children: React.ReactNode;
  title?: string;
}> = ({ children, title = "koincode" }) => {
  return (
    <div
      style={{
        width: 1180,
        borderRadius: 14,
        background: colors.surface,
        border: `1px solid ${colors.surfaceBorder}`,
        boxShadow: "0 40px 120px rgba(0,0,0,0.55)",
        overflow: "hidden",
        fontFamily: fontFamilyMono,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "16px 20px",
          borderBottom: `1px solid ${colors.surfaceBorder}`,
        }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          <Dot color="#FF5F56" />
          <Dot color="#FFBD2E" />
          <Dot color="#27C93F" />
        </div>
        <div
          style={{
            flex: 1,
            textAlign: "center",
            color: colors.muted,
            fontSize: 15,
            marginRight: 60,
          }}
        >
          {title}
        </div>
      </div>
      <div style={{ padding: "28px 32px", minHeight: 460 }}>{children}</div>
    </div>
  );
};

const Dot: React.FC<{ color: string }> = ({ color }) => (
  <div
    style={{
      width: 12,
      height: 12,
      borderRadius: 999,
      background: color,
    }}
  />
);

export const Cursor: React.FC<{ visible?: boolean }> = ({ visible = true }) => {
  const frame = useCurrentFrame();
  const on = Math.floor(frame / 15) % 2 === 0;
  return (
    <span
      style={{
        display: "inline-block",
        width: 10,
        height: 26,
        marginLeft: 2,
        transform: "translateY(4px)",
        background: on && visible ? colors.amber : "transparent",
      }}
    />
  );
};

export const TypedLine: React.FC<{
  prompt?: string;
  text: string;
  startFrame: number;
  charsPerFrame?: number;
  promptColor?: string;
}> = ({ prompt = "›", text, startFrame, charsPerFrame = 1.1, promptColor = colors.amber }) => {
  const frame = useCurrentFrame();
  const elapsed = Math.max(0, frame - startFrame);
  const visibleChars = Math.min(text.length, Math.floor(elapsed * charsPerFrame));
  const done = visibleChars >= text.length;

  if (frame < startFrame) return null;

  return (
    <div
      style={{
        fontSize: 26,
        lineHeight: "40px",
        color: colors.white,
        display: "flex",
      }}
    >
      <span style={{ color: promptColor, marginRight: 14 }}>{prompt}</span>
      <span>{text.slice(0, visibleChars)}</span>
      <Cursor visible={!done || Math.floor(frame / 15) % 2 === 0} />
    </div>
  );
};

export const OutputLine: React.FC<{
  text: string;
  startFrame: number;
  tone?: "default" | "success" | "warning" | "muted";
}> = ({ text, startFrame, tone = "default" }) => {
  const frame = useCurrentFrame();
  if (frame < startFrame) return null;

  const local = frame - startFrame;
  const opacity = Math.min(1, local / 8);
  const translateY = Math.max(0, 6 - local * 1.2);

  const color =
    tone === "success"
      ? colors.success
      : tone === "warning"
        ? colors.warning
        : tone === "muted"
          ? colors.muted
          : colors.white;

  return (
    <div
      style={{
        fontSize: 24,
        lineHeight: "38px",
        color,
        opacity,
        transform: `translateY(${translateY}px)`,
        whiteSpace: "pre",
      }}
    >
      {text}
    </div>
  );
};
