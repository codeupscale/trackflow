import { AbsoluteFill, Sequence } from "remotion";
import { SCENE_DURATIONS, FPS, COLORS } from "./lib/constants";
import { Intro } from "./scenes/Intro";
import { Problem } from "./scenes/Problem";
import { Solution } from "./scenes/Solution";
import { TimeTracking } from "./scenes/TimeTracking";
import { ActivityMonitor } from "./scenes/ActivityMonitor";
import { Screenshots } from "./scenes/Screenshots";
import { Dashboard } from "./scenes/Dashboard";
import { HRSuite } from "./scenes/HRSuite";
import { Security } from "./scenes/Security";
import { Comparison } from "./scenes/Comparison";
import { Pricing } from "./scenes/Pricing";
import { CTA } from "./scenes/CTA";
import "./styles/global.css";

export const TrackFlowDemo: React.FC = () => {
  let offset = 0;

  const scenes: { component: React.FC; duration: number; name: string }[] = [
    { component: Intro, duration: SCENE_DURATIONS.intro, name: "Intro" },
    { component: Problem, duration: SCENE_DURATIONS.problem, name: "Problem" },
    { component: Solution, duration: SCENE_DURATIONS.solution, name: "Solution" },
    { component: TimeTracking, duration: SCENE_DURATIONS.timeTracking, name: "TimeTracking" },
    { component: ActivityMonitor, duration: SCENE_DURATIONS.activityMonitor, name: "ActivityMonitor" },
    { component: Screenshots, duration: SCENE_DURATIONS.screenshots, name: "Screenshots" },
    { component: Dashboard, duration: SCENE_DURATIONS.dashboard, name: "Dashboard" },
    { component: HRSuite, duration: SCENE_DURATIONS.hrSuite, name: "HRSuite" },
    { component: Security, duration: SCENE_DURATIONS.security, name: "Security" },
    { component: Comparison, duration: SCENE_DURATIONS.comparison, name: "Comparison" },
    { component: Pricing, duration: SCENE_DURATIONS.pricing, name: "Pricing" },
    { component: CTA, duration: SCENE_DURATIONS.cta, name: "CTA" },
  ];

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.darkBg }}>
      {scenes.map((scene) => {
        const from = offset;
        const durationInFrames = scene.duration * FPS;
        offset += durationInFrames;
        const SceneComponent = scene.component;

        return (
          <Sequence
            key={scene.name}
            from={from}
            durationInFrames={durationInFrames}
            name={scene.name}
          >
            <SceneComponent />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
