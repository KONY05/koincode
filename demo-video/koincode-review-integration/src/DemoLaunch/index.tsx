import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { loadFont } from "@remotion/google-fonts/JetBrainsMono";
import { colors } from "./theme";
import { Intro } from "./scenes/Intro";
import { TerminalDemo } from "./scenes/TerminalDemo";
import { Features } from "./scenes/Features";
import { Outro } from "./scenes/Outro";

loadFont();

const INTRO_DURATION = 75;
const TERMINAL_DURATION = 300;
const FEATURES_DURATION = 105;
const OUTRO_DURATION = 90;

export const DEMO_LAUNCH_DURATION =
  INTRO_DURATION + TERMINAL_DURATION + FEATURES_DURATION + OUTRO_DURATION;

export const DemoLaunchVideo: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: colors.background }}>
      <Sequence
        durationInFrames={INTRO_DURATION}
        style={{
          translate: "1px 0px",
        }}
      >
        <Intro durationInFrames={INTRO_DURATION} />
      </Sequence>
      <Sequence from={INTRO_DURATION} durationInFrames={TERMINAL_DURATION}>
        <TerminalDemo durationInFrames={TERMINAL_DURATION} />
      </Sequence>
      <Sequence
        from={INTRO_DURATION + TERMINAL_DURATION}
        durationInFrames={FEATURES_DURATION}
      >
        <Features durationInFrames={FEATURES_DURATION} />
      </Sequence>
      <Sequence
        from={INTRO_DURATION + TERMINAL_DURATION + FEATURES_DURATION}
        durationInFrames={OUTRO_DURATION}
      >
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
};
