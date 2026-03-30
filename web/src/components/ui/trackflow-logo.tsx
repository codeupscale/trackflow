import type { SVGProps } from 'react';

interface TrackFlowLogoProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

/**
 * TrackFlow inline SVG logo — clock arc with arrow motif.
 * Uses currentColor so it adapts to light/dark mode automatically.
 * Based on the brand asset at /assets/logo/trackflow-icon.svg.
 */
export function TrackFlowLogo({ size = 28, className, ...props }: TrackFlowLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      fill="none"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      {...props}
    >
      <defs>
        <linearGradient id="tf-g1" x1="60" y1="452" x2="452" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4338CA" />
          <stop offset="45%" stopColor="#6366F1" />
          <stop offset="100%" stopColor="#06B6D4" />
        </linearGradient>
        <linearGradient id="tf-g2" x1="256" y1="268" x2="345" y2="148" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6366F1" />
          <stop offset="100%" stopColor="#22D3EE" />
        </linearGradient>
      </defs>

      {/* Clock arc ~255 degrees */}
      <path
        d="M 108 362 A 180 180 0 1 1 348 108"
        stroke="url(#tf-g1)"
        strokeWidth={48}
        strokeLinecap="round"
        fill="none"
      />

      {/* Arrowhead */}
      <path d="M 324 140 L 396 62 L 368 152 Z" fill="#06B6D4" />
      <path d="M 324 140 L 396 62 L 368 152 Z" fill="url(#tf-g1)" opacity={0.25} />

      {/* Clock hand */}
      <line
        x1={256}
        y1={256}
        x2={330}
        y2={160}
        stroke="url(#tf-g2)"
        strokeWidth={28}
        strokeLinecap="round"
      />

      {/* Center pivot */}
      <circle cx={256} cy={256} r={24} fill="#6366F1" />
      <circle cx={256} cy={256} r={11} fill="currentColor" className="text-background" />
    </svg>
  );
}
