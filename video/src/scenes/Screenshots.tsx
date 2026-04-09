import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Raleway";
import { COLORS } from "../lib/constants";

const { fontFamily } = loadFont();

const FEATURES = [
  "Multi-monitor: each display captured separately",
  "Configurable interval: 5, 10, or 15 min",
  "Privacy blur for sensitive content",
];

/** Renders faux "text lines" inside a screenshot mockup */
const FakeTextLines: React.FC<{
  count: number;
  lineHeight: number;
  opacity: number;
  color: string;
}> = ({ count, lineHeight, opacity, color }) => (
  <>
    {Array.from({ length: count }).map((_, i) => {
      const widths = [0.9, 0.7, 0.85, 0.6, 0.75, 0.95, 0.5, 0.8];
      return (
        <div
          key={i}
          style={{
            width: `${widths[i % widths.length] * 100}%`,
            height: lineHeight,
            backgroundColor: color,
            opacity,
            borderRadius: 2,
            marginBottom: 4,
          }}
        />
      );
    })}
  </>
);

export const Screenshots: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Heading
  const headingOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });
  const headingY = interpolate(frame, [0, 20], [-30, 0], {
    extrapolateRight: "clamp",
  });

  // Comparison panels
  const leftPanelScale = spring({
    frame: frame - 15,
    fps,
    config: { damping: 200 },
  });
  const rightPanelScale = spring({
    frame: frame - 25,
    fps,
    config: { damping: 200 },
  });

  // Divider
  const dividerHeight = interpolate(frame, [20, 50], [0, 340], {
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
          marginBottom: 50,
          textAlign: "center",
        }}
      >
        Visual Proof of <span style={{ color: COLORS.primary }}>Work</span>
      </h1>

      {/* Split Comparison */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 0,
          marginBottom: 50,
        }}
      >
        {/* Left — "Others" */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
            transform: `scale(${leftPanelScale})`,
          }}
        >
          <span
            style={{
              fontSize: 22,
              color: COLORS.textMuted,
              fontWeight: 600,
              letterSpacing: 1,
            }}
          >
            Others
          </span>
          {/* Single composited screenshot — blurry, hard to read */}
          <div
            style={{
              width: 480,
              height: 300,
              backgroundColor: "#1a1a1a",
              borderRadius: 12,
              border: `1px solid ${COLORS.darkBorder}`,
              padding: 20,
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-start",
              gap: 3,
              filter: "blur(1.5px)",
              overflow: "hidden",
            }}
          >
            <FakeTextLines count={8} lineHeight={4} opacity={0.15} color={COLORS.textMuted} />
            <div style={{ height: 16 }} />
            <FakeTextLines count={6} lineHeight={3} opacity={0.1} color={COLORS.textMuted} />
            <div style={{ height: 12 }} />
            <FakeTextLines count={5} lineHeight={3} opacity={0.08} color={COLORS.textMuted} />
          </div>
          <span
            style={{ fontSize: 14, color: COLORS.red, fontWeight: 500 }}
          >
            Composited &mdash; hard to read
          </span>
        </div>

        {/* Divider */}
        <div
          style={{
            width: 2,
            height: dividerHeight,
            backgroundColor: COLORS.darkBorder,
            marginLeft: 40,
            marginRight: 40,
            borderRadius: 1,
          }}
        />

        {/* Right — "TrackFlow" */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
            transform: `scale(${rightPanelScale})`,
          }}
        >
          <span
            style={{
              fontSize: 22,
              color: COLORS.primary,
              fontWeight: 700,
              letterSpacing: 1,
            }}
          >
            TrackFlow
          </span>
          {/* Two separate screenshots side by side */}
          <div style={{ display: "flex", gap: 12 }}>
            {[0, 1].map((idx) => (
              <div
                key={idx}
                style={{
                  width: 230,
                  height: 300,
                  backgroundColor: "#1a1a1a",
                  borderRadius: 12,
                  border: `1px solid ${COLORS.primary}40`,
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  overflow: "hidden",
                }}
              >
                {/* Title bar mockup */}
                <div
                  style={{
                    display: "flex",
                    gap: 4,
                    marginBottom: 8,
                  }}
                >
                  <div style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: COLORS.red }} />
                  <div style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: COLORS.amber }} />
                  <div style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: COLORS.green }} />
                </div>
                <FakeTextLines count={6} lineHeight={6} opacity={0.4} color={COLORS.white} />
                <div style={{ height: 8 }} />
                <FakeTextLines count={4} lineHeight={5} opacity={0.3} color={COLORS.primary} />
              </div>
            ))}
          </div>
          <span
            style={{ fontSize: 14, color: COLORS.green, fontWeight: 500 }}
          >
            Per-display &mdash; clear &amp; readable
          </span>
        </div>
      </div>

      {/* Features List */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
        }}
      >
        {FEATURES.map((feat, i) => {
          const featDelay = 100 + i * 20;
          const featOpacity = interpolate(
            frame,
            [featDelay, featDelay + 15],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );
          const featX = interpolate(
            frame,
            [featDelay, featDelay + 15],
            [30, 0],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );

          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                opacity: featOpacity,
                transform: `translateX(${featX}px)`,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: COLORS.primary,
                }}
              />
              <span
                style={{
                  fontSize: 22,
                  color: COLORS.white,
                  fontWeight: 500,
                }}
              >
                {feat}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Screenshots;
