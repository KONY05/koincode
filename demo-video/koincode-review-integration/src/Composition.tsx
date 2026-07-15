import { Composition, Still } from "remotion";
import { DemoLaunchVideo, DEMO_LAUNCH_DURATION } from "./DemoLaunch";
import { WorkspacesAnnounce } from "./WorkspacesAnnounce";

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

export const WorkspacesAnnounceStill = () => {
  return (
    <Still
      id="WorkspacesAnnounce"
      component={WorkspacesAnnounce}
      width={1920}
      height={1080}
    />
  );
};
