import { Composition } from "remotion";
import { DemoLaunchVideo, DEMO_LAUNCH_DURATION } from "./DemoLaunch";

export const DemoLaunchComposition = () => {
  return (
    <Composition
      id="DemoLaunch"
      component={DemoLaunchVideo}
      durationInFrames={DEMO_LAUNCH_DURATION}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
