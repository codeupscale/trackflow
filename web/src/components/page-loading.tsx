'use client';

import { Loader3D } from '@/components/ui/loader-3d';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Shown while auth resolves on a role-gated page — the caller either renders
 * the content or redirects, so there is no layout worth previewing here. A
 * skeleton would mock up content the viewer may never be allowed to see; the
 * loader just says "deciding".
 *
 * This previously drew a fake page skeleton in hardcoded `slate-800`, which
 * ignored the theme entirely and rendered dark grey blocks on the light ground.
 */
export function PageLoading() {
  return (
    <div className="animate-in fade-in duration-300">
      <Loader3D fullHeight />
    </div>
  );
}

/**
 * Row placeholder for tables and lists. Deliberately still a SKELETON, not the
 * 3D loader: it mirrors the real row layout, so the page does not reflow when
 * data lands and the wait reads as shorter.
 */
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-lg border border-border bg-card">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-4 border-b border-border/50 last:border-0">
          <Skeleton className="h-4 w-4 rounded" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-6 w-16" />
        </div>
      ))}
    </div>
  );
}
