import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Raleway";
import { COLORS, COMPARISON_ROWS } from "../lib/constants";

const { fontFamily } = loadFont();

const HEADERS = ["Feature", "TrackFlow", "Hubstaff", "Time Doctor"];

/** Green checkmark in a circle */
const CheckIcon: React.FC = () => (
  <svg width={28} height={28} viewBox="0 0 28 28" fill="none">
    <circle cx="14" cy="14" r="14" fill={COLORS.green} />
    <path
      d="M8 14.5L12 18.5L20 10.5"
      stroke={COLORS.white}
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Red X in a circle */
const XIcon: React.FC = () => (
  <svg width={28} height={28} viewBox="0 0 28 28" fill="none">
    <circle cx="14" cy="14" r="14" fill={COLORS.red} />
    <path
      d="M10 10L18 18M18 10L10 18"
      stroke={COLORS.white}
      strokeWidth="2.5"
      strokeLinecap="round"
    />
  </svg>
);

export const Comparison: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Heading
  const headingOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });
  const headingY = interpolate(frame, [0, 20], [-30, 0], {
    extrapolateRight: "clamp",
  });

  // Table card entrance
  const tableScale = spring({
    frame: frame - 10,
    fps,
    config: { damping: 200 },
  });

  const COL_WIDTHS = ["40%", "20%", "20%", "20%"];

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
          marginBottom: 48,
          textAlign: "center",
        }}
      >
        Why Teams Switch to{" "}
        <span style={{ color: COLORS.primary }}>TrackFlow</span>
      </h1>

      {/* Table */}
      <div
        style={{
          width: 1100,
          backgroundColor: COLORS.darkSurface,
          borderRadius: 20,
          border: `1px solid ${COLORS.darkBorder}`,
          overflow: "hidden",
          transform: `scale(${tableScale})`,
        }}
      >
        {/* Header Row */}
        <div
          style={{
            display: "flex",
            borderBottom: `2px solid ${COLORS.darkBorder}`,
          }}
        >
          {HEADERS.map((header, i) => (
            <div
              key={i}
              style={{
                width: COL_WIDTHS[i],
                padding: "20px 24px",
                fontSize: 18,
                fontWeight: 700,
                color: i === 1 ? COLORS.primary : COLORS.textMuted,
                textTransform: "uppercase",
                letterSpacing: 1.2,
                textAlign: i === 0 ? "left" : "center",
                backgroundColor:
                  i === 1 ? `${COLORS.primary}10` : "transparent",
              }}
            >
              {header}
            </div>
          ))}
        </div>

        {/* Data Rows */}
        {COMPARISON_ROWS.map((row, i) => {
          const rowDelay = 25 + i * 20;
          const rowOpacity = interpolate(
            frame,
            [rowDelay, rowDelay + 12],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );
          const rowY = interpolate(
            frame,
            [rowDelay, rowDelay + 12],
            [15, 0],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );

          const isLast = i === COMPARISON_ROWS.length - 1;

          return (
            <div
              key={i}
              style={{
                display: "flex",
                borderBottom: isLast
                  ? "none"
                  : `1px solid ${COLORS.darkBorder}`,
                opacity: rowOpacity,
                transform: `translateY(${rowY}px)`,
              }}
            >
              {/* Feature name */}
              <div
                style={{
                  width: COL_WIDTHS[0],
                  padding: "18px 24px",
                  fontSize: 20,
                  color: COLORS.white,
                  fontWeight: 500,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                {row.feature}
              </div>

              {/* TrackFlow */}
              <div
                style={{
                  width: COL_WIDTHS[1],
                  padding: "18px 24px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: `${COLORS.primary}10`,
                }}
              >
                {row.trackflow ? <CheckIcon /> : <XIcon />}
              </div>

              {/* Hubstaff */}
              <div
                style={{
                  width: COL_WIDTHS[2],
                  padding: "18px 24px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {row.hubstaff ? <CheckIcon /> : <XIcon />}
              </div>

              {/* Time Doctor */}
              <div
                style={{
                  width: COL_WIDTHS[3],
                  padding: "18px 24px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {row.timedoctor ? <CheckIcon /> : <XIcon />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Comparison;
