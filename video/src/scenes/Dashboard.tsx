import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Raleway";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { COLORS } from "../lib/constants";

const { fontFamily } = loadFont();
const { fontFamily: monoFamily } = loadMono();

const BAR_HEIGHTS = [0.65, 0.8, 0.45, 0.9, 0.7, 0.85, 0.55];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const TEAM_MEMBERS = [
  { name: "Sarah C.", activity: "87%" },
  { name: "Marcus W.", activity: "92%" },
  { name: "Priya S.", activity: "78%" },
  { name: "Alex K.", activity: "95%" },
  { name: "Jordan L.", activity: "81%" },
];

export const Dashboard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Heading animation
  const headingOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });
  const headingY = interpolate(frame, [0, 20], [-30, 0], {
    extrapolateRight: "clamp",
  });

  // Dashboard card entrance
  const cardScale = spring({
    frame: frame - 10,
    fps,
    config: { damping: 200, stiffness: 100 },
  });

  // Subtitle
  const subtitleOpacity = interpolate(frame, [180, 210], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        width: 1920,
        height: 1080,
        backgroundColor: COLORS.darkBg,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Heading */}
      <h1
        style={{
          fontSize: 64,
          fontWeight: 700,
          color: COLORS.white,
          opacity: headingOpacity,
          transform: `translateY(${headingY}px)`,
          marginBottom: 40,
          textAlign: "center",
        }}
      >
        Real-Time Team{" "}
        <span style={{ color: COLORS.primary }}>Dashboard</span>
      </h1>

      {/* Dashboard Card */}
      <div
        style={{
          width: 1200,
          backgroundColor: COLORS.darkSurface,
          borderRadius: 20,
          padding: 40,
          transform: `scale(${cardScale})`,
          border: `1px solid ${COLORS.darkBorder}`,
          display: "flex",
          flexDirection: "column",
          gap: 32,
        }}
      >
        {/* Bar Chart Section */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <span
            style={{
              fontSize: 18,
              color: COLORS.textMuted,
              fontWeight: 600,
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            Weekly Hours
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 20,
              height: 180,
            }}
          >
            {BAR_HEIGHTS.map((h, i) => {
              const barDelay = 30 + i * 3;
              const barProgress = interpolate(
                frame,
                [barDelay, barDelay + 30],
                [0, 1],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
              );
              const barHeight = h * 160 * barProgress;
              const opacity = 0.5 + h * 0.5;

              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 8,
                    flex: 1,
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      maxWidth: 80,
                      height: barHeight,
                      backgroundColor: COLORS.primary,
                      opacity,
                      borderRadius: 8,
                      transition: "none",
                    }}
                  />
                  <span
                    style={{
                      fontSize: 14,
                      color: COLORS.textMuted,
                      fontFamily: monoFamily,
                    }}
                  >
                    {DAYS[i]}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Team Status Section */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <span
            style={{
              fontSize: 18,
              color: COLORS.textMuted,
              fontWeight: 600,
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            Team Status
          </span>
          <div
            style={{
              display: "flex",
              gap: 24,
            }}
          >
            {TEAM_MEMBERS.map((member, i) => {
              const dotDelay = 60 + i * 12;
              const dotOpacity = interpolate(
                frame,
                [dotDelay, dotDelay + 10],
                [0, 1],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
              );

              // Activity number counting up
              const numericActivity = parseInt(member.activity);
              const countDelay = 80 + i * 12;
              const countProgress = interpolate(
                frame,
                [countDelay, countDelay + 40],
                [0, 1],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
              );
              const displayNumber = Math.round(numericActivity * countProgress);

              return (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    backgroundColor: COLORS.darkBg,
                    borderRadius: 12,
                    padding: 16,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 10,
                    border: `1px solid ${COLORS.darkBorder}`,
                    opacity: dotOpacity,
                  }}
                >
                  {/* Status dot */}
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      backgroundColor: COLORS.green,
                      boxShadow: `0 0 8px ${COLORS.green}60`,
                    }}
                  />
                  {/* Name */}
                  <span
                    style={{
                      fontSize: 16,
                      color: COLORS.white,
                      fontWeight: 600,
                    }}
                  >
                    {member.name}
                  </span>
                  {/* Activity */}
                  <span
                    style={{
                      fontSize: 28,
                      color: COLORS.primary,
                      fontWeight: 700,
                      fontFamily: monoFamily,
                    }}
                  >
                    {displayNumber}%
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: COLORS.textMuted,
                      textTransform: "uppercase",
                      letterSpacing: 1,
                    }}
                  >
                    Activity
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Subtitle */}
      <p
        style={{
          fontSize: 28,
          color: COLORS.textMuted,
          marginTop: 36,
          opacity: subtitleOpacity,
          textAlign: "center",
        }}
      >
        See who's working, what they're on, and how active they are
      </p>
    </div>
  );
};

export default Dashboard;
