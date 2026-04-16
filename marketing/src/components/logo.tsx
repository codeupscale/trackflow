export function TrackFlowLogo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <svg
        width="36"
        height="36"
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* Clock circle */}
        <circle
          cx="18"
          cy="18"
          r="15"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          opacity="0.2"
        />
        {/* Arc — primary color sweep */}
        <path
          d="M18 3 A15 15 0 1 1 5.04 26.5"
          stroke="oklch(0.555 0.163 48.998)"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />
        {/* Clock hand — hour */}
        <line
          x1="18"
          y1="18"
          x2="18"
          y2="9"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        {/* Clock hand — minute */}
        <line
          x1="18"
          y1="18"
          x2="25"
          y2="15"
          stroke="oklch(0.555 0.163 48.998)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        {/* Arrow tip on arc end */}
        <path
          d="M3.5 24 L5.04 26.5 L8 25.5"
          stroke="#06B6D4"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {/* Center dot */}
        <circle cx="18" cy="18" r="2" fill="oklch(0.555 0.163 48.998)" />
      </svg>
      <span className="text-xl font-bold tracking-tight">
        <span className="text-current">Track</span>
        <span style={{ color: "oklch(0.555 0.163 48.998)" }}>Flow</span>
      </span>
    </div>
  );
}

export function TrackFlowLogoMark() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="18" cy="18" r="15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.2" />
      <path d="M18 3 A15 15 0 1 1 5.04 26.5" stroke="oklch(0.555 0.163 48.998)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <line x1="18" y1="18" x2="18" y2="9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="18" y1="18" x2="25" y2="15" stroke="oklch(0.555 0.163 48.998)" strokeWidth="2" strokeLinecap="round" />
      <path d="M3.5 24 L5.04 26.5 L8 25.5" stroke="#06B6D4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="18" cy="18" r="2" fill="oklch(0.555 0.163 48.998)" />
    </svg>
  );
}
