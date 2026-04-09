import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Raleway";
import { COLORS, WIDTH, HEIGHT } from "../lib/constants";
import { Logo } from "../components/Logo";

const { fontFamily: raleway } = loadFont();

/**
 * Intro scene — 4 seconds (120 frames at 30fps)
 * Logo spring-scales in, wordmark fades in, tagline follows.
 * Subtle floating particle dots in background.
 */
export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Logo spring animation: scale 0 -> 1
  const logoScale = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 80, mass: 0.8 },
  });

  // Wordmark fades in after logo settles (starts at frame 25)
  const wordmarkOpacity = interpolate(frame, [25, 45], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const wordmarkY = interpolate(frame, [25, 45], [20, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Tagline fades in later (starts at frame 50)
  const taglineOpacity = interpolate(frame, [50, 70], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const taglineY = interpolate(frame, [50, 70], [15, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Background radial gradient pulse
  const gradientSize = interpolate(frame, [0, 120], [30, 45], {
    extrapolateRight: "clamp",
  });

  // Particle dots — 6 floating circles
  const particles = [
    { x: 15, y: 20, size: 4, speed: 0.3, delay: 0 },
    { x: 80, y: 15, size: 3, speed: 0.25, delay: 10 },
    { x: 25, y: 75, size: 5, speed: 0.2, delay: 20 },
    { x: 85, y: 70, size: 3, speed: 0.35, delay: 5 },
    { x: 50, y: 10, size: 4, speed: 0.15, delay: 15 },
    { x: 70, y: 85, size: 3, speed: 0.28, delay: 8 },
  ];

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
      {/* Radial gradient background */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(circle at 50% 50%, ${COLORS.darkSurface} 0%, ${COLORS.darkBg} ${gradientSize}%)`,
        }}
      />

      {/* Floating particle dots */}
      {particles.map((p, i) => {
        const particleOpacity = interpolate(
          frame,
          [p.delay, p.delay + 30],
          [0, 0.3],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );
        const driftY =
          Math.sin(((frame + p.delay * 10) * p.speed * Math.PI) / 60) * 15;
        const driftX =
          Math.cos(((frame + p.delay * 10) * p.speed * Math.PI) / 80) * 10;

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: p.size,
              height: p.size,
              borderRadius: "50%",
              backgroundColor: COLORS.primary,
              opacity: particleOpacity,
              transform: `translate(${driftX}px, ${driftY}px)`,
            }}
          />
        );
      })}

      {/* Logo */}
      <div
        style={{
          transform: `scale(${logoScale})`,
          marginBottom: 30,
          zIndex: 1,
        }}
      >
        <Logo size={160} />
      </div>

      {/* Wordmark */}
      <div
        style={{
          opacity: wordmarkOpacity,
          transform: `translateY(${wordmarkY}px)`,
          fontFamily: raleway,
          fontSize: 72,
          fontWeight: 700,
          letterSpacing: -1,
          zIndex: 1,
        }}
      >
        <span style={{ color: COLORS.white }}>Track</span>
        <span style={{ color: COLORS.primary }}>Flow</span>
      </div>

      {/* Tagline */}
      <div
        style={{
          opacity: taglineOpacity,
          transform: `translateY(${taglineY}px)`,
          fontFamily: raleway,
          fontSize: 28,
          fontWeight: 400,
          color: COLORS.textMuted,
          marginTop: 16,
          letterSpacing: 2,
          zIndex: 1,
        }}
      >
        Time. Activity. HR. One Platform.
      </div>
    </div>
  );
};

export default Intro;
