import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { colors, fontFamilyMono } from "../theme";
import { AppViewport, BotText, InputBarFrame, KeybindHints, MessageBubble, StatusRow } from "../Terminal";

const MODEL = "Claude Sonnet 5";

export const TerminalDemo: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();

  const introOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });
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
        opacity: Math.min(introOpacity, fadeOut),
      }}
    >
      <AppViewport>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 20, overflow: "hidden" }}>
          <MessageBubble
            mode="Build"
            incognito
            startFrame={5}
            text="got 10 mins before my system design interview — quiz me on CAP theorem"
          />
          <BotText
            startFrame={70}
            text={"Consistency — every read gets the latest write\nAvailability — every request gets a response\nPartition tolerance — keeps working through network splits\n\nPick 2 of 3. Postgres? CP."}
          />
          <BotText
            startFrame={110}
            fontSize={18}
            text="✓ Nothing saved — this session disappears when you close it"
          />
        </div>

        <div>
          <InputBarFrame mode="Build" incognito>
            <div style={{ fontFamily: fontFamilyMono, fontSize: 20, color: colors.dimSeparator }}>
              Ask anything...
            </div>
            <StatusRow mode="Build" incognito model={MODEL} />
          </InputBarFrame>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              <KeybindHints />
              <span style={{ fontFamily: fontFamilyMono, fontSize: 13, color: colors.dimSeparator }}>
                ~/code/my-app:main
              </span>
            </div>
          </div>
        </div>
      </AppViewport>
    </AbsoluteFill>
  );
};
