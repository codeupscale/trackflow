import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Raleway";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { COLORS, WIDTH, HEIGHT } from "../lib/constants";

const { fontFamily: raleway } = loadFont();
const { fontFamily: jetbrainsMono } = loadMono();

const platformBadges = ["Web", "Desktop", "API"];

/**
 * Solution scene — 5 seconds (150 frames at 30fps)
 * "Meet TrackFlow" springs in, subheading fades, counter animates 0->70+,
 * three platform badges fade in.
 */
export const Solution: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // "Meet TrackFlow" heading springs in
  const headingScale = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 100, mass: 0.7 },
  });

  // Subheading fades in at frame 20
  const subOpacity = interpolate(frame, [20, 45], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const subY = interpolate(frame, [20, 45], [20, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Counter: 0 -> 70 over 1.5 seconds (45 frames), starting at frame 50
  const counterProgress = interpolate(frame, [50, 95], [0, 70], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const counterValue = Math.floor(counterProgress);
  const counterOpacity = interpolate(frame, [45, 55], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // "+" appears after counter finishes
  const plusOpacity = interpolate(frame, [95, 105], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // "Features" label fades in with counter
  const labelOpacity = interpolate(frame, [55, 70], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Platform badges stagger starting at frame 100
  const badgeStartFrames = [100, 108, 116];

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
      {/* Subtle gradient bg */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at 50% 30%, ${COLORS.primary}10 0%, transparent 60%)`,
        }}
      />

      {/* Heading: Meet TrackFlow */}
      <div
        style={{
          transform: `scale(${headingScale})`,
          fontFamily: raleway,
          fontSize: 72,
          fontWeight: 800,
          color: COLORS.white,
          marginBottom: 24,
          zIndex: 1,
        }}
      >
        Meet{" "}
        <span style={{ color: COLORS.primary }}>TrackFlow</span>
      </div>

      {/* Subheading */}
      <div
        style={{
          opacity: subOpacity,
          transform: `translateY(${subY}px)`,
          fontFamily: raleway,
          fontSize: 24,
          fontWeight: 400,
          color: COLORS.textMuted,
          textAlign: "center",
          maxWidth: 900,
          lineHeight: 1.6,
          marginBottom: 60,
          zIndex: 1,
        }}
      >
        One platform that replaces your time tracker, activity monitor,
        leave system, payroll tool, and attendance software
      </div>

      {/* Animated counter */}
      <div
        style={{
          opacity: counterOpacity,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          marginBottom: 50,
          zIndex: 1,
        }}
      >
        <div
          style={{
            fontFamily: jetbrainsMono,
            fontSize: 120,
            fontWeight: 700,
            color: COLORS.primary,
            lineHeight: 1,
            display: "flex",
            alignItems: "baseline",
          }}
        >
          <span>{counterValue}</span>
          <span
            style={{
              opacity: plusOpacity,
              fontSize: 80,
              color: COLORS.accent,
              marginLeft: 4,
            }}
          >
            +
          </span>
        </div>
        <div
          style={{
            opacity: labelOpacity,
            fontFamily: raleway,
            fontSize: 28,
            fontWeight: 500,
            color: COLORS.textMuted,
            marginTop: 8,
            letterSpacing: 4,
            textTransform: "uppercase",
          }}
        >
          Features
        </div>
      </div>

      {/* Platform badges */}
      <div
        style={{
          display: "flex",
          gap: 24,
          zIndex: 1,
        }}
      >
        {platformBadges.map((badge, index) => {
          const startFrame = badgeStartFrames[index];
          const badgeOpacity = interpolate(
            frame,
            [startFrame, startFrame + 15],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );
          const badgeScale = spring({
            frame: Math.max(0, frame - startFrame),
            fps,
            config: { damping: 15, stiffness: 120 },
          });

          return (
            <div
              key={badge}
              style={{
                opacity: badgeOpacity,
                transform: `scale(${badgeScale})`,
                fontFamily: raleway,
                fontSize: 20,
                fontWeight: 600,
                color: COLORS.white,
                backgroundColor: COLORS.darkSurface,
                border: `2px solid ${COLORS.darkBorder}`,
                borderRadius: 40,
                padding: "12px 36px",
                letterSpacing: 1,
              }}
            >
              {badge}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Solution;
