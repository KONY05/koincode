import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { loadFont } from "@remotion/google-fonts/JetBrainsMono";
import { colors } from "./theme";
import { Intro } from "./scenes/Intro";
import { HomeToggle } from "./scenes/HomeToggle";
import { TerminalDemo } from "./scenes/TerminalDemo";
import { Outro } from "./scenes/Outro";

loadFont();

const INTRO_DURATION = 75;
const HOME_TOGGLE_DURATION = 180;
const TERMINAL_DURATION = 240;
const OUTRO_DURATION = 90;

export const DEMO_LAUNCH_DURATION =
  INTRO_DURATION + HOME_TOGGLE_DURATION + TERMINAL_DURATION + OUTRO_DURATION;

export const DemoLaunchVideo: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: colors.background }}>
      <Sequence durationInFrames={INTRO_DURATION}>
        <Intro durationInFrames={INTRO_DURATION} />
      </Sequence>
      <Sequence from={INTRO_DURATION} durationInFrames={HOME_TOGGLE_DURATION}>
        <HomeToggle durationInFrames={HOME_TOGGLE_DURATION} />
      </Sequence>
      <Sequence
        from={INTRO_DURATION + HOME_TOGGLE_DURATION}
        durationInFrames={TERMINAL_DURATION}
      >
        <TerminalDemo durationInFrames={TERMINAL_DURATION} />
      </Sequence>
      <Sequence
        from={INTRO_DURATION + HOME_TOGGLE_DURATION + TERMINAL_DURATION}
        durationInFrames={OUTRO_DURATION}
      >
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
};
