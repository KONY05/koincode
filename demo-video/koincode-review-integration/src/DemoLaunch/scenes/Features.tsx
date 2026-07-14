import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fontFamilySans } from "../theme";

const FEATURES = [
  { title: "One command setup", body: "/review-connect links the repo — no dashboards" },
  { title: "Automatic PR reviews", body: "Every pull request gets reviewed the moment it opens" },
  { title: "Keys sync, once", body: "/review-sync-keys shares provider keys across machines" },
];

export const Features: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

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
      <div style={{ display: "flex", gap: 32 }}>
        {FEATURES.map((feature, i) => {
          const start = i * 10;
          const progress = spring({
            frame: frame - start,
            fps,
            config: { damping: 16, mass: 0.7 },
          });
          const opacity = interpolate(frame - start, [0, 12], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });

          return (
            <div
              key={feature.title}
              style={{
                width: 340,
                padding: "36px 30px",
                borderRadius: 16,
                background: colors.surface,
                border: `1px solid ${colors.surfaceBorder}`,
                fontFamily: fontFamilySans,
                opacity,
                transform: `translateY(${(1 - progress) * 40}px)`,
              }}
            >
              <div style={{ fontSize: 28, fontWeight: 700, color: colors.white, marginBottom: 14 }}>
                {feature.title}
              </div>
              <div style={{ fontSize: 20, lineHeight: "30px", color: colors.muted }}>
                {feature.body}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
