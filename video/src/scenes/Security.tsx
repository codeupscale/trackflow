import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Raleway";
import { COLORS, SECURITY_FEATURES } from "../lib/constants";

const { fontFamily } = loadFont();

export const Security: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Heading
  const headingOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });
  const headingY = interpolate(frame, [0, 20], [-30, 0], {
    extrapolateRight: "clamp",
  });

  // Shield entrance
  const shieldScale = spring({
    frame: frame - 10,
    fps,
    config: { damping: 14, stiffness: 80, mass: 1 },
  });

  // Glow pulse
  const glowOpacity = interpolate(
    frame,
    [30, 75, 120],
    [0.3, 0.6, 0.3],
    { extrapolateRight: "clamp" }
  );

  // Feature badges arranged in a circle
  const RADIUS = 260;
  const CENTER_X = 960;
  const CENTER_Y = 560;

  return (
    <div
      style={{
        width: 1920,
        height: 1080,
        backgroundColor: COLORS.darkBg,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        fontFamily,
        position: "relative",
        overflow: "hidden",
        paddingTop: 80,
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
          zIndex: 2,
        }}
      >
        Enterprise-Grade{" "}
        <span style={{ color: COLORS.primary }}>Security</span>
      </h1>

      {/* Glow effect behind shield */}
      <div
        style={{
          position: "absolute",
          left: CENTER_X - 200,
          top: CENTER_Y - 200,
          width: 400,
          height: 400,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${COLORS.primary}${Math.round(glowOpacity * 255).toString(16).padStart(2, "0")} 0%, transparent 70%)`,
          zIndex: 0,
        }}
      />

      {/* Shield SVG */}
      <div
        style={{
          position: "absolute",
          left: CENTER_X - 60,
          top: CENTER_Y - 70,
          transform: `scale(${shieldScale})`,
          zIndex: 1,
        }}
      >
        <svg width={120} height={140} viewBox="0 0 24 28" fill="none">
          <path
            d="M12 1L2 5.5V12.5C2 19.35 6.28 25.73 12 27.5C17.72 25.73 22 19.35 22 12.5V5.5L12 1Z"
            fill={`${COLORS.primary}20`}
            stroke={COLORS.primary}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          {/* Checkmark inside shield */}
          <path
            d="M8 14L11 17L17 11"
            stroke={COLORS.primary}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {/* Security feature badges in a circle */}
      {SECURITY_FEATURES.map((feat, i) => {
        const angle = (i / SECURITY_FEATURES.length) * Math.PI * 2 - Math.PI / 2;
        const x = CENTER_X + RADIUS * Math.cos(angle);
        const y = CENTER_Y + RADIUS * Math.sin(angle);

        const badgeDelay = 30 + i * 15;
        const badgeOpacity = interpolate(
          frame,
          [badgeDelay, badgeDelay + 12],
          [0, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );
        const badgeScale = spring({
          frame: frame - badgeDelay,
          fps,
          config: { damping: 200 },
        });

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              transform: `translate(-50%, -50%) scale(${badgeScale})`,
              opacity: badgeOpacity,
              backgroundColor: COLORS.darkSurface,
              border: `1px solid ${COLORS.primary}40`,
              borderRadius: 50,
              padding: "12px 24px",
              zIndex: 2,
            }}
          >
            <span
              style={{
                fontSize: 18,
                color: COLORS.white,
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              {feat}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default Security;
