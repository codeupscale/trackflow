'use client';

export function PageLoading() {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header skeleton */}
      <div className="space-y-2">
        <div className="h-7 w-48 bg-slate-800/50 rounded animate-pulse" />
        <div className="h-4 w-72 bg-slate-800/30 rounded animate-pulse" />
      </div>

      {/* Card skeleton */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-6">
        <div className="flex gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex-1 space-y-2">
              <div className="h-4 w-20 bg-slate-800/50 rounded animate-pulse" />
              <div className="h-8 w-full bg-slate-800/30 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>

      {/* Table skeleton */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/50">
        <div className="p-4 border-b border-slate-800">
          <div className="h-5 w-32 bg-slate-800/50 rounded animate-pulse" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-4 border-b border-slate-800/50 last:border-0">
            <div className="h-8 w-8 bg-slate-800/50 rounded-full animate-pulse" />
            <div className="flex-1 space-y-1.5">
              <div className="h-4 w-40 bg-slate-800/50 rounded animate-pulse" />
              <div className="h-3 w-24 bg-slate-800/30 rounded animate-pulse" />
            </div>
            <div className="h-6 w-16 bg-slate-800/50 rounded animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-4 border-b border-slate-800/50 last:border-0">
          <div className="h-4 w-4 bg-slate-800/50 rounded animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <div className="h-4 w-40 bg-slate-800/50 rounded animate-pulse" />
            <div className="h-3 w-24 bg-slate-800/30 rounded animate-pulse" />
          </div>
          <div className="h-6 w-20 bg-slate-800/50 rounded animate-pulse" />
          <div className="h-6 w-16 bg-slate-800/50 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}
