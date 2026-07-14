import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { colors, fontFamilySans } from "../theme";
import { OutputLine, TerminalWindow, TypedLine } from "../Terminal";

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
      <div
        style={{
          fontFamily: fontFamilySans,
          fontSize: 26,
          color: colors.muted,
          marginBottom: 22,
          textAlign: "center",
        }}
      >
        Connect a repo to <span style={{ color: colors.amber }}>KOINCODE-Review</span> in three
        commands
      </div>
      <TerminalWindow>
        <TypedLine text="/review-login" startFrame={10} />
        <OutputLine
          text="  → opening browser to authorize this device..."
          startFrame={30}
          tone="muted"
        />
        <OutputLine text="  ✓ logged in as konyinsola" startFrame={45} tone="success" />

        <div style={{ height: 22 }} />
        <TypedLine text="/review-connect" startFrame={80} />
        <OutputLine
          text="  ✓ connected KOINCODE-Review to this repository"
          startFrame={104}
          tone="success"
        />
        <OutputLine
          text="    reviews will run automatically on every pull request"
          startFrame={116}
          tone="muted"
        />

        <div style={{ height: 22 }} />
        <TypedLine text="/review-status" startFrame={150} />
        <OutputLine text="  PR #142  fix/session-timeout    ✓ approved" startFrame={174} />
        <OutputLine
          text="  PR #144  feat/phase2             ⚠ 3 findings"
          startFrame={186}
          tone="warning"
        />
      </TerminalWindow>
    </AbsoluteFill>
  );
};
