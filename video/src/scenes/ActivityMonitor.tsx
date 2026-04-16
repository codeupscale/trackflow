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

interface AppUsageData {
  name: string;
  time: string;
  minutes: number; // total minutes for bar width calc
  color: string;
}

const appUsage: AppUsageData[] = [
  { name: "VS Code", time: "3h 12m", minutes: 192, color: COLORS.amber },
  { name: "Chrome", time: "1h 45m", minutes: 105, color: COLORS.blue },
  { name: "Slack", time: "0h 32m", minutes: 32, color: COLORS.purple },
];

const maxMinutes = 192; // VS Code is the longest

/**
 * ActivityMonitor scene -- 8 seconds (240 frames at 30fps)
 * Heading, animated circular activity ring filling to 78%,
 * app usage bars growing from left.
 */
export const ActivityMonitor: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // --- Heading ---
  const headingOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const headingY = interpolate(frame, [0, 20], [-20, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // --- Activity ring ---
  // Ring animates from 0% to 78% over frames 15-90
  const targetPercent = 78;
  const ringProgress = interpolate(frame, [15, 90], [0, targetPercent], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // SVG circle math
  const ringRadius = 110;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringStrokeDashoffset =
    ringCircumference - (ringProgress / 100) * ringCircumference;

  // Center percentage counting up
  const displayPercent = Math.floor(ringProgress);

  // Ring container fade in
  const ringOpacity = interpolate(frame, [10, 25], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // --- App usage bars ---
  const barsStartFrame = 70;
  const barStagger = 15;

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
        overflow: "hidden",
        padding: "60px 0",
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
          marginBottom: 60,
        }}
      >
        Know What&apos;s Happening,{" "}
        <span style={{ color: COLORS.accent }}>Not Just When</span>
      </div>

      {/* Main content row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 120,
          flex: 1,
        }}
      >
        {/* Left: Activity ring */}
        <div
          style={{
            opacity: ringOpacity,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 20,
          }}
        >
          <div style={{ position: "relative", width: 260, height: 260 }}>
            <svg
              width={260}
              height={260}
              viewBox="0 0 260 260"
              style={{ transform: "rotate(-90deg)" }}
            >
              {/* Background track */}
              <circle
                cx={130}
                cy={130}
                r={ringRadius}
                stroke={COLORS.darkBorder}
                strokeWidth={16}
                fill="none"
              />
              {/* Progress arc */}
              <circle
                cx={130}
                cy={130}
                r={ringRadius}
                stroke={COLORS.green}
                strokeWidth={16}
                fill="none"
                strokeDasharray={ringCircumference}
                strokeDashoffset={ringStrokeDashoffset}
                strokeLinecap="round"
              />
            </svg>

            {/* Center text */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  fontFamily: jetbrainsMono,
                  fontSize: 56,
                  fontWeight: 700,
                  color: COLORS.white,
                  lineHeight: 1,
                }}
              >
                {displayPercent}%
              </div>
              <div
                style={{
                  fontFamily: raleway,
                  fontSize: 16,
                  fontWeight: 500,
                  color: COLORS.textMuted,
                  marginTop: 4,
                }}
              >
                Activity Score
              </div>
            </div>
          </div>
        </div>

        {/* Right: App usage bars */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 32,
            width: 500,
          }}
        >
          {/* Section label */}
          <div
            style={{
              fontFamily: raleway,
              fontSize: 18,
              fontWeight: 600,
              color: COLORS.textMuted,
              textTransform: "uppercase",
              letterSpacing: 3,
              opacity: interpolate(frame, [barsStartFrame - 10, barsStartFrame], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            App Usage
          </div>

          {appUsage.map((app, index) => {
            const startFrame = barsStartFrame + index * barStagger;

            // Bar width animates from 0 to full
            const barWidthPercent = interpolate(
              frame,
              [startFrame, startFrame + 30],
              [0, (app.minutes / maxMinutes) * 100],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
            );

            // Row fade in
            const rowOpacity = interpolate(
              frame,
              [startFrame, startFrame + 15],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
            );

            return (
              <div
                key={app.name}
                style={{
                  opacity: rowOpacity,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {/* Label row */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div
                    style={{
                      fontFamily: raleway,
                      fontSize: 20,
                      fontWeight: 600,
                      color: COLORS.white,
                    }}
                  >
                    {app.name}
                  </div>
                  <div
                    style={{
                      fontFamily: jetbrainsMono,
                      fontSize: 18,
                      fontWeight: 500,
                      color: app.color,
                    }}
                  >
                    {app.time}
                  </div>
                </div>

                {/* Bar track */}
                <div
                  style={{
                    width: "100%",
                    height: 12,
                    backgroundColor: COLORS.darkSurface,
                    borderRadius: 6,
                    overflow: "hidden",
                  }}
                >
                  {/* Bar fill */}
                  <div
                    style={{
                      width: `${barWidthPercent}%`,
                      height: "100%",
                      backgroundColor: app.color,
                      borderRadius: 6,
                      boxShadow: `0 0 10px ${app.color}40`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ActivityMonitor;
