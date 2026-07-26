import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { colors, fontFamilyMono, fontFamilySans } from "../theme";
import { AppHeader, AppViewport, InputBarFrame, StatusRow, TypedLine } from "../Terminal";

// Frame the "/incognito" command commits and the UI reacts — mirrors the real
// home screen: typing the command, then the status label and input border
// updating immediately, then the tip row swapping in a beat later.
const TOGGLE_FRAME = 42;
const MODEL = "Claude Sonnet 5";

export const HomeToggle: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();

  const introOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 15, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const isIncognito = frame >= TOGGLE_FRAME;
  const tipOpacity = interpolate(frame, [TOGGLE_FRAME + 12, TOGGLE_FRAME + 26], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: colors.background,
        alignItems: "center",
        justifyContent: "center",
        opacity: Math.min(introOpacity, fadeOut),
      }}
    >
      <AppViewport>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <AppHeader />

          <div style={{ width: "100%", maxWidth: 900, margin: "0 auto" }}>
            <InputBarFrame mode="Build" incognito={isIncognito}>
              <TypedLine text="/incognito" startFrame={10} charsPerFrame={0.8} />
              <StatusRow mode="Build" incognito={isIncognito} model={MODEL} />
            </InputBarFrame>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                marginTop: 10,
                fontFamily: fontFamilySans,
                fontSize: 14,
              }}
            >
              <span style={{ color: colors.white }}>tab</span>
              <span style={{ color: colors.dimSeparator }}>agents</span>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: 10,
                marginTop: 8,
                fontFamily: fontFamilyMono,
                fontSize: 15,
              }}
            >
              <span style={{ color: colors.dimSeparator }}>•</span>
              <span style={{ color: isIncognito ? colors.info : colors.primary, fontWeight: 700 }}>
                {isIncognito ? "Incognito" : "Tip"}
              </span>
              <span style={{ color: colors.dimSeparator, opacity: isIncognito ? tipOpacity : 1 }}>
                {isIncognito
                  ? "Chat history won't be saved while incognito mode is on"
                  : "Press tab to toggle between Plan and Build mode"}
              </span>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontFamily: fontFamilyMono,
            fontSize: 14,
            color: colors.dimSeparator,
          }}
        >
          <span>~/code/my-app:main</span>
          <span>v1.24.0</span>
        </div>
      </AppViewport>
    </AbsoluteFill>
  );
};
