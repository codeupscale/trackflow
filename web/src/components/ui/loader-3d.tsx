'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface Loader3DProps {
  /**
   * Diameter in px. Keep it divisible by 8 so the ring insets (size/8, size/4)
   * land on whole pixels — 32, 48, 64, 96, 120 all do.
   */
  size?: number;
  /** Optional status line beneath the loader, e.g. "Running payroll…". */
  label?: string;
  /** Fill the parent and centre within it. */
  fullHeight?: boolean;
  /**
   * Wait this long before appearing. Use ~120ms anywhere the data may already
   * be cached — tab switches especially. TanStack Query returns a warm cache in
   * a few ms, and a loader that flashes for one frame reads as a glitch, not as
   * polish. Below the threshold the switch simply looks instant, which is the
   * honest result. Defaults to 0 for genuinely cold loads.
   */
  delayMs?: number;
  className?: string;
}

/**
 * Gyroscope loader — three rings rotating on independent axes in real 3D.
 *
 * For loading states with NO layout to preview: app boot, auth/role gates,
 * route transitions, and blocking jobs (payroll run, export generating).
 *
 * Do NOT use it to replace skeletons in content areas. A skeleton reads as
 * faster than any spinner because it shows the shape of what is arriving, and
 * at button size (~14px) the 3D depth just turns to mud — keep `Loader2` there.
 *
 * Styles live in globals.css (`.tf-scene` / `.tf-gyro`); the rings inherit
 * `--primary`, so the loader follows the theme in light and dark.
 */
export function Loader3D({
  size = 64,
  label,
  fullHeight = false,
  delayMs = 0,
  className,
}: Loader3DProps) {
  // Snap to a multiple of 8 so the ring insets (size/8, size/4) always land on
  // whole pixels. At 140px they would be 17.5px, and a half-pixel ring edge
  // renders soft — the one thing a "crisp" loader must not do. Clamped to 24px
  // minimum, below which the three rings collide into a blur.
  const px = Math.max(24, Math.round(size / 8) * 8);

  const [visible, setVisible] = useState(delayMs === 0);

  useEffect(() => {
    if (delayMs === 0) return;
    const t = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);

  // Hold the layout box while waiting out the delay, so content does not jump
  // when the loader does appear.
  if (!visible) {
    return (
      <div
        aria-hidden
        className={cn(fullHeight && 'min-h-[60vh] w-full', className)}
      />
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label ?? 'Loading'}
      className={cn(
        'flex flex-col items-center justify-center gap-4',
        fullHeight && 'min-h-[60vh] w-full',
        className
      )}
    >
      <div
        className="tf-scene"
        style={{ '--tf-loader-size': `${px}px` } as React.CSSProperties}
      >
        <div className="tf-gyro">
          <i />
          <i />
          <i />
        </div>
      </div>
      {label && (
        <p className="text-xs text-muted-foreground">{label}</p>
      )}
    </div>
  );
}

/**
 * Loading state for a tab panel — the 3D loader centred in a card-height area.
 *
 * Carries the 120ms delay by default: switching back to an already-fetched tab
 * resolves from the TanStack Query cache almost immediately, and without the
 * guard the loader would appear and vanish inside a single frame on every
 * switch. With it, a warm tab just looks instant and a cold one gets the loader.
 */
export function TabLoading({ label }: { label?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="py-20">
        <Loader3D size={64} label={label} delayMs={120} />
      </div>
    </div>
  );
}
