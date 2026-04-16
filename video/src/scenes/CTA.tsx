import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Raleway";
import { COLORS } from "../lib/constants";
import { Logo } from "../components/Logo";

const { fontFamily } = loadFont();

/** Deterministic pseudo-random for particle positions */
const PARTICLES = Array.from({ length: 10 }).map((_, i) => {
  const angle = (i / 10) * Math.PI * 2 + 0.3 * i;
  const baseRadius = 180 + (i % 3) * 60;
  return {
    angle,
    baseRadius,
    size: 3 + (i % 4),
    phaseOffset: i * 0.7,
  };
});

export const CTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Logo scale-in
  const logoScale = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 60, mass: 1.2 },
  });

  // Text fade-ins
  const titleOpacity = interpolate(frame, [25, 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const titleY = interpolate(frame, [25, 50], [20, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const urlOpacity = interpolate(frame, [45, 70], [0, 1], {
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
      {/* Particles */}
      {PARTICLES.map((p, i) => {
        // Slowly drift outward and pulse opacity
        const drift = interpolate(frame, [0, 120], [0, 30]);
        const radius = p.baseRadius + drift;
        const x = 960 + radius * Math.cos(p.angle + frame * 0.003);
        const y = 540 + radius * Math.sin(p.angle + frame * 0.003);
        const particleOpacity =
          0.3 +
          0.3 * Math.sin(frame * 0.08 + p.phaseOffset);

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x - p.size / 2,
              top: y - p.size / 2,
              width: p.size,
              height: p.size,
              borderRadius: "50%",
              backgroundColor: COLORS.primary,
              opacity: particleOpacity,
            }}
          />
        );
      })}

      {/* Logo */}
      <div
        style={{
          transform: `scale(${logoScale * 1.8})`,
          marginBottom: 40,
        }}
      >
        <Logo size={120} />
      </div>

      {/* TrackFlow wordmark */}
      <div
        style={{
          transform: `scale(${logoScale})`,
          marginBottom: 30,
        }}
      >
        <span
          style={{
            fontSize: 72,
            fontWeight: 800,
            color: COLORS.white,
            letterSpacing: -1,
          }}
        >
          Track
        </span>
        <span
          style={{
            fontSize: 72,
            fontWeight: 800,
            color: COLORS.primary,
            letterSpacing: -1,
          }}
        >
          Flow
        </span>
      </div>

      {/* CTA text */}
      <h2
        style={{
          fontSize: 42,
          fontWeight: 600,
          color: COLORS.white,
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          marginBottom: 20,
          textAlign: "center",
        }}
      >
        Start Your Free Trial Today
      </h2>

      {/* URL */}
      <span
        style={{
          fontSize: 28,
          color: COLORS.primary,
          fontWeight: 500,
          opacity: urlOpacity,
          letterSpacing: 1,
        }}
      >
        trackflow.app
      </span>
    </div>
  );
};

export default CTA;
