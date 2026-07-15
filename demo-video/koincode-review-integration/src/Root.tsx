import "./index.css";
import { DemoLaunchComposition, WorkspacesAnnounceStill } from "./Composition";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <DemoLaunchComposition />
      <WorkspacesAnnounceStill />
    </>
  );
};
