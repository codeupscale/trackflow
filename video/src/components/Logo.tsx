import React from "react";
import { COLORS } from "../lib/constants";

interface LogoProps {
  size?: number;
}

/**
 * TrackFlow logo — a 255-degree partial clock arc with arrowhead,
 * clock hand, and center pivot dot.
 */
export const Logo: React.FC<LogoProps> = ({ size = 120 }) => {
  const cx = 50;
  const cy = 50;
  const r = 38;
  const strokeWidth = 7;

  // 255-degree arc: starts at -90deg (12 o'clock), sweeps 255 degrees clockwise
  // Start angle: -90deg => top center
  // End angle: -90 + 255 = 165deg
  const startAngleRad = (-90 * Math.PI) / 180;
  const endAngleRad = (165 * Math.PI) / 180;

  const x1 = cx + r * Math.cos(startAngleRad);
  const y1 = cy + r * Math.sin(startAngleRad);
  const x2 = cx + r * Math.cos(endAngleRad);
  const y2 = cy + r * Math.sin(endAngleRad);

  // Large arc flag: 255 > 180, so largeArcFlag = 1
  const arcPath = `M ${x1} ${y1} A ${r} ${r} 0 1 1 ${x2} ${y2}`;

  // Arrowhead at the arc's start (12 o'clock position)
  // Arrow points in the direction of the arc's start tangent (clockwise from top = rightward)
  const arrowSize = 8;
  const arrowTipX = x1 + arrowSize * 1.2;
  const arrowTipY = y1;
  const arrowP1X = x1 - arrowSize * 0.3;
  const arrowP1Y = y1 - arrowSize * 0.8;
  const arrowP2X = x1 - arrowSize * 0.3;
  const arrowP2Y = y1 + arrowSize * 0.8;

  // Clock hand: from center toward upper-right (~1:30 position, about -45deg)
  const handAngleRad = (-45 * Math.PI) / 180;
  const handLength = r * 0.55;
  const handEndX = cx + handLength * Math.cos(handAngleRad);
  const handEndY = cy + handLength * Math.sin(handAngleRad);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Partial circle arc */}
      <path
        d={arcPath}
        stroke={COLORS.primary}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        fill="none"
      />

      {/* Arrowhead at arc open end (top / 12 o'clock) */}
      <polygon
        points={`${arrowTipX},${arrowTipY} ${arrowP1X},${arrowP1Y} ${arrowP2X},${arrowP2Y}`}
        fill={COLORS.accent}
      />

      {/* Clock hand from center to upper-right */}
      <line
        x1={cx}
        y1={cy}
        x2={handEndX}
        y2={handEndY}
        stroke={COLORS.white}
        strokeWidth={4}
        strokeLinecap="round"
      />

      {/* Center pivot dot */}
      <circle cx={cx} cy={cy} r={4} fill={COLORS.primary} />
    </svg>
  );
};

export default Logo;
