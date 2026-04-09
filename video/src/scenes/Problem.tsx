import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Raleway";
import { COLORS, WIDTH, HEIGHT } from "../lib/constants";

const { fontFamily: raleway } = loadFont();

/** Simple clock icon — circle with two hands */
const ClockIcon: React.FC = () => (
  <svg width={48} height={48} viewBox="0 0 48 48" fill="none">
    <circle cx={24} cy={24} r={20} stroke={COLORS.primary} strokeWidth={3} />
    <line
      x1={24}
      y1={24}
      x2={24}
      y2={12}
      stroke={COLORS.primary}
      strokeWidth={3}
      strokeLinecap="round"
    />
    <line
      x1={24}
      y1={24}
      x2={32}
      y2={24}
      stroke={COLORS.primary}
      strokeWidth={3}
      strokeLinecap="round"
    />
    <circle cx={24} cy={24} r={2.5} fill={COLORS.primary} />
  </svg>
);

/** Eye-slash icon — eye with diagonal strike */
const EyeSlashIcon: React.FC = () => (
  <svg width={48} height={48} viewBox="0 0 48 48" fill="none">
    {/* Eye shape */}
    <path
      d="M6 24s6-12 18-12 18 12 18 12-6 12-18 12S6 24 6 24z"
      stroke={COLORS.primary}
      strokeWidth={3}
      strokeLinejoin="round"
      fill="none"
    />
    {/* Pupil */}
    <circle cx={24} cy={24} r={5} stroke={COLORS.primary} strokeWidth={3} />
    {/* Slash line */}
    <line
      x1={10}
      y1={10}
      x2={38}
      y2={38}
      stroke={COLORS.red}
      strokeWidth={3}
      strokeLinecap="round"
    />
  </svg>
);

/** Document stack icon */
const DocumentStackIcon: React.FC = () => (
  <svg width={48} height={48} viewBox="0 0 48 48" fill="none">
    {/* Back doc */}
    <rect
      x={12}
      y={4}
      width={26}
      height={34}
      rx={3}
      stroke={COLORS.textMuted}
      strokeWidth={2}
      fill="none"
    />
    {/* Front doc */}
    <rect
      x={8}
      y={10}
      width={26}
      height={34}
      rx={3}
      stroke={COLORS.primary}
      strokeWidth={3}
      fill={COLORS.darkSurface}
    />
    {/* Lines on front doc */}
    <line
      x1={14}
      y1={20}
      x2={28}
      y2={20}
      stroke={COLORS.textMuted}
      strokeWidth={2}
      strokeLinecap="round"
    />
    <line
      x1={14}
      y1={27}
      x2={28}
      y2={27}
      stroke={COLORS.textMuted}
      strokeWidth={2}
      strokeLinecap="round"
    />
    <line
      x1={14}
      y1={34}
      x2={22}
      y2={34}
      stroke={COLORS.textMuted}
      strokeWidth={2}
      strokeLinecap="round"
    />
  </svg>
);

interface PainPoint {
  icon: React.ReactNode;
  text: string;
}

const painPoints: PainPoint[] = [
  { icon: <ClockIcon />, text: "Scattered time tracking tools" },
  { icon: <EyeSlashIcon />, text: "No visibility into actual work" },
  { icon: <DocumentStackIcon />, text: "Manual HR processes eating your week" },
];

/**
 * Problem scene — 5 seconds (150 frames at 30fps)
 * Heading fades in, then 3 pain point cards stagger in from below.
 */
export const Problem: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Heading fade in
  const headingOpacity = interpolate(frame, [0, 25], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const headingY = interpolate(frame, [0, 25], [-20, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Card stagger: each starts 9 frames (0.3s) apart, beginning at frame 30
  const cardStartFrames = [30, 39, 48];

  return (
    <div
      style={{
        position: "absolute",
        width: WIDTH,
        height: HEIGHT,
        backgroundColor: COLORS.darkBg,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {/* Heading */}
      <div
        style={{
          opacity: headingOpacity,
          transform: `translateY(${headingY}px)`,
          fontFamily: raleway,
          fontSize: 48,
          fontWeight: 700,
          color: COLORS.white,
          textAlign: "center",
          maxWidth: 1200,
          lineHeight: 1.2,
          marginBottom: 80,
        }}
      >
        Managing Remote Teams Shouldn&apos;t Require{" "}
        <span style={{ color: COLORS.red }}>5 Different Tools</span>
      </div>

      {/* Pain point cards */}
      <div
        style={{
          display: "flex",
          gap: 40,
          justifyContent: "center",
        }}
      >
        {painPoints.map((point, index) => {
          const startFrame = cardStartFrames[index];

          const cardOpacity = interpolate(
            frame,
            [startFrame, startFrame + 20],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );
          const cardY = interpolate(
            frame,
            [startFrame, startFrame + 20],
            [60, 0],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );

          return (
            <div
              key={index}
              style={{
                opacity: cardOpacity,
                transform: `translateY(${cardY}px)`,
                backgroundColor: COLORS.darkSurface,
                border: `1px solid ${COLORS.darkBorder}`,
                borderRadius: 16,
                padding: "48px 40px",
                width: 340,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 24,
              }}
            >
              {/* Icon */}
              <div
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: 16,
                  backgroundColor: `${COLORS.primary}15`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {point.icon}
              </div>

              {/* Text */}
              <div
                style={{
                  fontFamily: raleway,
                  fontSize: 22,
                  fontWeight: 500,
                  color: COLORS.white,
                  textAlign: "center",
                  lineHeight: 1.4,
                }}
              >
                {point.text}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Problem;
