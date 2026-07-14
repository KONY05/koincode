import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fontFamilySans } from "../theme";

export const Intro: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const badgeOpacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  const badgeY = interpolate(frame, [0, 10], [10, 0], { extrapolateRight: "clamp" });
  const logoScale = spring({ frame: frame - 6, fps, config: { damping: 14, mass: 0.6 } });
  const taglineOpacity = interpolate(frame, [18, 32], [0, 1], { extrapolateRight: "clamp" });
  const taglineY = interpolate(frame, [18, 32], [12, 0], { extrapolateRight: "clamp" });

  const fadeOut = interpolate(
    frame,
    [durationInFrames - 15, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill
      style={{
        background: colors.background,
        alignItems: "center",
        justifyContent: "center",
        opacity: fadeOut,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 22px",
          marginBottom: 32,
          borderRadius: 999,
          border: `1px solid ${colors.amber}`,
          background: "rgba(243,168,59,0.08)",
          fontFamily: fontFamilySans,
          fontSize: 22,
          fontWeight: 600,
          color: colors.amber,
          letterSpacing: 0.5,
          opacity: badgeOpacity,
          transform: `translateY(${badgeY}px)`,
        }}
      >
        <span>✦</span>
        <span>First KOINCODE-Review integration</span>
      </div>
      <div
        style={{
          display: "flex",
          fontFamily: fontFamilySans,
          fontWeight: 800,
          fontSize: 108,
          letterSpacing: 2,
          transform: `scale(${logoScale})`,
        }}
      >
        <span style={{ color: colors.white }}>KOIN</span>
        <span style={{ color: colors.amber }}>CODE</span>
      </div>
      <div
        style={{
          marginTop: 28,
          fontFamily: fontFamilySans,
          fontSize: 32,
          color: colors.muted,
          opacity: taglineOpacity,
          transform: `translateY(${taglineY}px)`,
        }}
      >
        The local-first terminal AI coding agent
      </div>
    </AbsoluteFill>
  );
};
