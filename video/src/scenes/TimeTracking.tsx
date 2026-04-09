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

/** WiFi icon as inline SVG */
const WifiIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg width={40} height={40} viewBox="0 0 40 40" fill="none">
    {/* Outer arc */}
    <path
      d="M4 16c8.8-8 23.2-8 32 0"
      stroke={color}
      strokeWidth={3}
      strokeLinecap="round"
      fill="none"
    />
    {/* Middle arc */}
    <path
      d="M10 22c5.5-5 14.5-5 20 0"
      stroke={color}
      strokeWidth={3}
      strokeLinecap="round"
      fill="none"
    />
    {/* Inner arc */}
    <path
      d="M15 28c2.8-2.5 7.2-2.5 10 0"
      stroke={color}
      strokeWidth={3}
      strokeLinecap="round"
      fill="none"
    />
    {/* Dot */}
    <circle cx={20} cy={34} r={3} fill={color} />
  </svg>
);

const bulletPoints = [
  "Start/stop with one click",
  "Atomic project switching (zero gaps)",
  "Never lose time \u2014 local SQLite backup",
  "Works offline, syncs when connected",
];

/**
 * TimeTracking scene -- 8 seconds (240 frames at 30fps)
 * Left: animated ticking timer. Right: staggered bullet points.
 * Bottom: WiFi online/offline/reconnect animation.
 */
export const TimeTracking: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // --- Timer display ---
  // Base time: 02:34:17, incrementing seconds based on frame
  const baseHours = 2;
  const baseMinutes = 34;
  const baseSeconds = 17;
  const elapsedSeconds = Math.floor(frame / fps);
  const totalSeconds =
    baseHours * 3600 + baseMinutes * 60 + baseSeconds + elapsedSeconds;
  const displayH = Math.floor(totalSeconds / 3600)
    .toString()
    .padStart(2, "0");
  const displayM = Math.floor((totalSeconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const displayS = (totalSeconds % 60).toString().padStart(2, "0");

  // Timer fade in
  const timerOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Green dot pulsing (using sine wave)
  const dotScale = 1 + 0.3 * Math.sin((frame * Math.PI * 2) / 30);
  const dotOpacity = 0.6 + 0.4 * Math.sin((frame * Math.PI * 2) / 30);

  // --- Bullet points stagger ---
  const bulletStartFrame = 20;
  const bulletStagger = 12; // ~0.4s apart

  // --- WiFi status ---
  // 0-90: green (online), 90-180: red (offline), 180+: green (back online)
  const isOffline = frame >= 90 && frame < 180;
  const isBackOnline = frame >= 180;
  const wifiColor = isOffline ? COLORS.red : COLORS.green;

  // "Synced!" text at frame 200
  const syncedOpacity = interpolate(frame, [200, 215], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const syncedScale = spring({
    frame: Math.max(0, frame - 200),
    fps,
    config: { damping: 12, stiffness: 100 },
  });

  // Offline label
  const offlineOpacity = isOffline
    ? interpolate(frame, [90, 100], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : isBackOnline
      ? interpolate(frame, [180, 190], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 0;

  return (
    <div
      style={{
        position: "absolute",
        width: WIDTH,
        height: HEIGHT,
        backgroundColor: COLORS.darkBg,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Main content area — left/right split */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 120,
          paddingTop: 40,
        }}
      >
        {/* Left side: Timer */}
        <div
          style={{
            opacity: timerOpacity,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
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
              marginBottom: 20,
            }}
          >
            Time Tracking
          </div>

          {/* Timer container */}
          <div
            style={{
              backgroundColor: COLORS.darkSurface,
              border: `2px solid ${COLORS.darkBorder}`,
              borderRadius: 24,
              padding: "48px 60px",
              display: "flex",
              alignItems: "center",
              gap: 20,
            }}
          >
            {/* Green pulsing dot */}
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                backgroundColor: COLORS.green,
                opacity: dotOpacity,
                transform: `scale(${dotScale})`,
                boxShadow: `0 0 12px ${COLORS.green}60`,
              }}
            />

            {/* Timer digits */}
            <div
              style={{
                fontFamily: jetbrainsMono,
                fontSize: 80,
                fontWeight: 700,
                color: COLORS.white,
                letterSpacing: 4,
              }}
            >
              <span>{displayH}</span>
              <span style={{ color: COLORS.primary, margin: "0 4px" }}>:</span>
              <span>{displayM}</span>
              <span style={{ color: COLORS.primary, margin: "0 4px" }}>:</span>
              <span>{displayS}</span>
            </div>
          </div>

          {/* Project name pill */}
          <div
            style={{
              marginTop: 16,
              fontFamily: raleway,
              fontSize: 16,
              fontWeight: 500,
              color: COLORS.accent,
              backgroundColor: `${COLORS.accent}15`,
              border: `1px solid ${COLORS.accent}30`,
              borderRadius: 20,
              padding: "6px 20px",
            }}
          >
            TrackFlow Dashboard
          </div>
        </div>

        {/* Right side: Bullet points */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 28,
            maxWidth: 500,
          }}
        >
          {bulletPoints.map((point, index) => {
            const startFrame = bulletStartFrame + index * bulletStagger;
            const pointOpacity = interpolate(
              frame,
              [startFrame, startFrame + 18],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
            );
            const pointX = interpolate(
              frame,
              [startFrame, startFrame + 18],
              [40, 0],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
            );

            return (
              <div
                key={index}
                style={{
                  opacity: pointOpacity,
                  transform: `translateX(${pointX}px)`,
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                }}
              >
                {/* Checkmark circle */}
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    backgroundColor: `${COLORS.green}20`,
                    border: `2px solid ${COLORS.green}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <svg width={18} height={18} viewBox="0 0 18 18" fill="none">
                    <path
                      d="M4 9l3.5 3.5L14 6"
                      stroke={COLORS.green}
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>

                {/* Text */}
                <div
                  style={{
                    fontFamily: raleway,
                    fontSize: 22,
                    fontWeight: 500,
                    color: COLORS.white,
                    lineHeight: 1.4,
                  }}
                >
                  {point}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom: WiFi animation */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          paddingBottom: 60,
        }}
      >
        <WifiIcon color={wifiColor} />

        {/* Status label */}
        <div
          style={{
            fontFamily: jetbrainsMono,
            fontSize: 18,
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          {/* Online label */}
          {!isOffline && !isBackOnline && (
            <span style={{ color: COLORS.green }}>Online</span>
          )}

          {/* Offline label */}
          <span
            style={{
              opacity: offlineOpacity,
              color: COLORS.red,
            }}
          >
            {isOffline ? "Offline \u2014 Timer keeps running" : ""}
          </span>

          {/* Back online + synced */}
          {isBackOnline && (
            <span style={{ color: COLORS.green }}>Online</span>
          )}
        </div>

        {/* "Synced!" badge */}
        {isBackOnline && (
          <div
            style={{
              opacity: syncedOpacity,
              transform: `scale(${syncedScale})`,
              fontFamily: jetbrainsMono,
              fontSize: 16,
              fontWeight: 700,
              color: COLORS.darkBg,
              backgroundColor: COLORS.green,
              borderRadius: 8,
              padding: "6px 16px",
              marginLeft: 8,
            }}
          >
            Synced!
          </div>
        )}
      </div>
    </div>
  );
};

export default TimeTracking;
