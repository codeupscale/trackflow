import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Raleway";
import { COLORS, PRICING_TIERS } from "../lib/constants";

const { fontFamily } = loadFont();

export const Pricing: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Heading
  const headingOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });
  const headingY = interpolate(frame, [0, 15], [-30, 0], {
    extrapolateRight: "clamp",
  });

  // Trial badge pulse
  const trialOpacity = interpolate(
    frame,
    [80, 90, 100, 110, 120],
    [0, 1, 0.7, 1, 0.7],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

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
          marginBottom: 60,
          textAlign: "center",
        }}
      >
        Simple, Transparent{" "}
        <span style={{ color: COLORS.primary }}>Pricing</span>
      </h1>

      {/* Pricing Cards */}
      <div
        style={{
          display: "flex",
          gap: 32,
          alignItems: "flex-end",
        }}
      >
        {PRICING_TIERS.map((tier, i) => {
          const cardDelay = 10 + i * 10;
          const slideProgress = spring({
            frame: frame - cardDelay,
            fps,
            config: { damping: 18, stiffness: 80, mass: 0.8 },
          });
          const cardY = interpolate(slideProgress, [0, 1], [120, 0]);
          const cardOpacity = interpolate(slideProgress, [0, 0.2], [0, 1], {
            extrapolateRight: "clamp",
          });

          const isHighlighted = tier.highlight;

          return (
            <div
              key={i}
              style={{
                width: isHighlighted ? 340 : 300,
                padding: isHighlighted ? 4 : 0,
                borderRadius: 24,
                background: isHighlighted
                  ? `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`
                  : "transparent",
                transform: `translateY(${cardY}px)`,
                opacity: cardOpacity,
              }}
            >
              <div
                style={{
                  backgroundColor: COLORS.darkSurface,
                  borderRadius: isHighlighted ? 20 : 24,
                  border: isHighlighted
                    ? "none"
                    : `1px solid ${COLORS.darkBorder}`,
                  padding: "44px 36px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 16,
                }}
              >
                {/* Tier label */}
                {isHighlighted && (
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: COLORS.primary,
                      textTransform: "uppercase",
                      letterSpacing: 2,
                      marginBottom: -8,
                    }}
                  >
                    Most Popular
                  </span>
                )}

                <span
                  style={{
                    fontSize: 24,
                    fontWeight: 600,
                    color: COLORS.textMuted,
                    textTransform: "uppercase",
                    letterSpacing: 1.5,
                  }}
                >
                  {tier.name}
                </span>

                {/* Price */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 4,
                  }}
                >
                  <span
                    style={{
                      fontSize: isHighlighted ? 64 : 56,
                      fontWeight: 800,
                      color: COLORS.white,
                      lineHeight: 1,
                    }}
                  >
                    {tier.price}
                  </span>
                  {tier.period && (
                    <span
                      style={{
                        fontSize: 18,
                        color: COLORS.textMuted,
                        fontWeight: 400,
                      }}
                    >
                      {tier.period}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Free trial badge */}
      <div
        style={{
          marginTop: 50,
          opacity: trialOpacity,
          backgroundColor: `${COLORS.primary}20`,
          border: `1px solid ${COLORS.primary}50`,
          borderRadius: 50,
          padding: "14px 36px",
        }}
      >
        <span
          style={{
            fontSize: 22,
            color: COLORS.primary,
            fontWeight: 700,
          }}
        >
          14-day free trial — no credit card required
        </span>
      </div>
    </div>
  );
};

export default Pricing;
