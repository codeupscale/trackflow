import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Raleway";
import { COLORS, HR_MODULES } from "../lib/constants";

const { fontFamily } = loadFont();

/** Simple SVG icons for each HR module */
const ModuleIcon: React.FC<{ index: number; color: string }> = ({
  index,
  color,
}) => {
  const size = 32;
  const icons = [
    // Calendar (Leave Management)
    <svg key={0} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="18" rx="2" stroke={color} strokeWidth="2" />
      <line x1="3" y1="10" x2="21" y2="10" stroke={color} strokeWidth="2" />
      <line x1="8" y1="2" x2="8" y2="6" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="16" y1="2" x2="16" y2="6" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>,
    // Dollar (Payroll Engine)
    <svg key={1} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="2" />
      <path d="M12 6v12M9 9.5c0-1.1 1.3-2 3-2s3 .9 3 2-1.3 2-3 2-3 .9-3 2 1.3 2 3 2 3-.9 3-2" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>,
    // Clipboard (Attendance)
    <svg key={2} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="5" y="3" width="14" height="18" rx="2" stroke={color} strokeWidth="2" />
      <path d="M9 3h6v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V3z" stroke={color} strokeWidth="2" />
      <line x1="9" y1="10" x2="15" y2="10" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="9" y1="14" x2="13" y2="14" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>,
    // Arrows (Shift Management)
    <svg key={3} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 12h16M16 8l4 4-4 4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 18H4M8 22l-4-4 4-4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>,
  ];
  return icons[index] ?? null;
};

export const HRSuite: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Heading
  const headingOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });
  const headingY = interpolate(frame, [0, 20], [-30, 0], {
    extrapolateRight: "clamp",
  });

  // Bottom text
  const bottomOpacity = interpolate(frame, [260, 290], [0, 1], {
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
          fontSize: 60,
          fontWeight: 700,
          color: COLORS.white,
          opacity: headingOpacity,
          transform: `translateY(${headingY}px)`,
          marginBottom: 50,
          textAlign: "center",
        }}
      >
        Complete HR Management —{" "}
        <span style={{ color: COLORS.primary }}>Built In</span>
      </h1>

      {/* HR Module Cards */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 20,
          width: 900,
        }}
      >
        {HR_MODULES.map((mod, i) => {
          const cardDelay = 30 + i * 60;
          const slideProgress = spring({
            frame: frame - cardDelay,
            fps,
            config: { damping: 20, stiffness: 80, mass: 0.8 },
          });
          const cardX = interpolate(slideProgress, [0, 1], [400, 0]);
          const cardOpacity = interpolate(slideProgress, [0, 0.3], [0, 1], {
            extrapolateRight: "clamp",
          });

          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                backgroundColor: COLORS.darkSurface,
                borderRadius: 16,
                padding: 28,
                gap: 24,
                border: `1px solid ${COLORS.darkBorder}`,
                transform: `translateX(${cardX}px)`,
                opacity: cardOpacity,
                overflow: "hidden",
                position: "relative",
              }}
            >
              {/* Left color bar */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 5,
                  backgroundColor: mod.color,
                  borderRadius: "16px 0 0 16px",
                }}
              />

              {/* Icon */}
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 12,
                  backgroundColor: `${mod.color}15`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  marginLeft: 8,
                }}
              >
                <ModuleIcon index={i} color={mod.color} />
              </div>

              {/* Text */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <span
                  style={{
                    fontSize: 26,
                    fontWeight: 700,
                    color: COLORS.white,
                  }}
                >
                  {mod.name}
                </span>
                <span
                  style={{
                    fontSize: 18,
                    color: COLORS.textMuted,
                    fontWeight: 400,
                  }}
                >
                  {mod.desc}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom text */}
      <p
        style={{
          fontSize: 26,
          color: COLORS.textMuted,
          marginTop: 44,
          opacity: bottomOpacity,
          textAlign: "center",
          fontStyle: "italic",
        }}
      >
        No more Gusto, BambooHR, or spreadsheet juggling
      </p>
    </div>
  );
};

export default HRSuite;
