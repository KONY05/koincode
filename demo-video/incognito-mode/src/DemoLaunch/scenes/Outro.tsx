import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fontFamilyMono, fontFamilySans } from "../theme";

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({ frame, fps, config: { damping: 14, mass: 0.6 } });
  const commandOpacity = interpolate(frame, [16, 30], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        background: colors.background,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          fontFamily: fontFamilySans,
          fontWeight: 800,
          fontSize: 88,
          letterSpacing: 2,
          transform: `scale(${scale})`,
        }}
      >
        <span style={{ color: colors.white }}>KOIN</span>
        <span style={{ color: colors.primary }}>CODE</span>
      </div>

      <div
        style={{
          marginTop: 40,
          padding: "18px 32px",
          borderRadius: 12,
          background: colors.surface,
          border: `1px dashed ${colors.info}`,
          fontFamily: fontFamilyMono,
          fontSize: 22,
          color: colors.white,
          opacity: commandOpacity,
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ color: colors.info }}>/incognito</span>
      </div>

      <div
        style={{
          marginTop: 26,
          fontFamily: fontFamilySans,
          fontSize: 22,
          color: colors.dimSeparator,
          opacity: commandOpacity,
        }}
      >
        Ask a quick question. Keep working. Nothing gets saved.
      </div>
    </AbsoluteFill>
  );
};
