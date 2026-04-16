import { Composition } from "remotion";
import { TrackFlowDemo } from "./TrackFlowDemo";
import { TOTAL_DURATION_FRAMES, FPS, WIDTH, HEIGHT } from "./lib/constants";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="TrackFlowDemo"
        component={TrackFlowDemo}
        durationInFrames={TOTAL_DURATION_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      <Composition
        id="TrackFlowDemoSocial"
        component={TrackFlowDemo}
        durationInFrames={TOTAL_DURATION_FRAMES}
        fps={FPS}
        width={1080}
        height={1080}
      />
    </>
  );
};
