import { useId, type HTMLAttributes } from 'react';

interface TrackFlowLogoProps extends HTMLAttributes<HTMLDivElement> {
  /** Icon width and height in px (default 28) */
  size?: number;
  /** Show the "TrackFlow" wordmark next to the icon (default true) */
  showText?: boolean;
}

/**
 * TrackFlow brand logo — clock-arc-with-arrow icon + optional wordmark.
 *
 * Uses unique gradient IDs per instance so multiple logos on the same page
 * don't collide.  All colors derive from CSS custom properties so the logo
 * adapts to light / dark mode automatically.
 */
export function TrackFlowLogo({
  size = 28,
  showText = true,
  className,
  ...props
}: TrackFlowLogoProps) {
  const uid = useId().replace(/:/g, '');

  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`} {...props}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 512 512"
        fill="none"
        width={size}
        height={size}
        className="shrink-0"
        aria-hidden="true"
      >
        <defs>
          <linearGradient
            id={`tf-g1-${uid}`}
            x1="60"
            y1="452"
            x2="452"
            y2="60"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" className="[stop-color:hsl(var(--primary))]" />
            <stop offset="50%" className="[stop-color:hsl(var(--primary))]" />
            <stop offset="100%" stopColor="#06B6D4" />
          </linearGradient>
          <linearGradient
            id={`tf-g2-${uid}`}
            x1="256"
            y1="268"
            x2="345"
            y2="148"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" className="[stop-color:hsl(var(--primary))]" />
            <stop offset="100%" stopColor="#22D3EE" />
          </linearGradient>
        </defs>

        {/* Clock arc ~255 degrees */}
        <path
          d="M 108 362 A 180 180 0 1 1 348 108"
          stroke={`url(#tf-g1-${uid})`}
          strokeWidth={48}
          strokeLinecap="round"
          fill="none"
        />

        {/* Arrowhead */}
        <path
          d="M 324 140 L 396 62 L 368 152 Z"
          fill="#06B6D4"
        />
        <path
          d="M 324 140 L 396 62 L 368 152 Z"
          fill={`url(#tf-g1-${uid})`}
          opacity={0.25}
        />

        {/* Clock hand */}
        <line
          x1={256}
          y1={256}
          x2={330}
          y2={160}
          stroke={`url(#tf-g2-${uid})`}
          strokeWidth={28}
          strokeLinecap="round"
        />

        {/* Center pivot */}
        <circle cx={256} cy={256} r={24} className="fill-primary" />
        <circle cx={256} cy={256} r={11} className="fill-background" />
      </svg>

      {showText && (
        <span
          className="font-semibold tracking-tight text-foreground"
          style={{ fontSize: size * 0.64 }}
        >
          Track
          <span className="text-primary">Flow</span>
        </span>
      )}
    </div>
  );
}
