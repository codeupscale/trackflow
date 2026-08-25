'use client';

/**
 * TEMPORARY preview page for the 3D gyroscope loader.
 *
 * The loader is transient by design — it only appears during route transitions
 * and auth gates, which resolve in ~100ms — so there is no normal screen where
 * you can simply look at it. This page exists purely so it can be inspected.
 *
 * DELETE THIS FILE before merging. It is not linked from the sidebar.
 */

import { useState } from 'react';
import { Loader3D } from '@/components/ui/loader-3d';
import { PageLoading } from '@/components/page-loading';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function LoaderPreviewPage() {
  const [overlay, setOverlay] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Loader preview</h1>
        <p className="text-xs text-muted-foreground">
          Temporary page — delete before merging. Toggle your theme to check both palettes.
        </p>
      </div>

      {/* Sizes */}
      <Card>
        <CardContent className="p-6">
          <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground mb-5">
            Sizes
          </p>
          <div className="flex flex-wrap items-end gap-10">
            {[32, 48, 64, 96, 128].map((s) => (
              <div key={s} className="flex flex-col items-center gap-3">
                <Loader3D size={s} />
                <span className="text-[0.65rem] font-mono text-muted-foreground tabular-nums">
                  {s}px
                </span>
              </div>
            ))}
          </div>
          <p className="text-[0.7rem] text-muted-foreground mt-6">
            64px is the default. Below ~32px the depth stops reading — use{' '}
            <code className="text-[0.65rem]">Loader2</code> for button spinners instead.
          </p>
        </CardContent>
      </Card>

      {/* With label */}
      <Card>
        <CardContent className="p-6">
          <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground mb-5">
            With status line — for blocking jobs
          </p>
          <Loader3D size={72} label="Running payroll for August…" />
        </CardContent>
      </Card>

      {/* Real components */}
      <Card>
        <CardContent className="p-6">
          <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground mb-2">
            &lt;PageLoading /&gt; — the actual auth-gate component
          </p>
          <p className="text-[0.7rem] text-muted-foreground mb-4">
            This is exactly what renders on a role-gated page while auth resolves.
          </p>
          <div className="rounded-lg border border-border bg-muted/30">
            <PageLoading />
          </div>
        </CardContent>
      </Card>

      {/* Full-screen overlay */}
      <Card>
        <CardContent className="p-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Full-screen overlay</p>
            <p className="text-[0.7rem] text-muted-foreground">
              Closest to what a slow route transition looks like. Click anywhere to dismiss.
            </p>
          </div>
          <Button size="sm" onClick={() => setOverlay(true)}>
            Show overlay
          </Button>
        </CardContent>
      </Card>

      {overlay && (
        <div
          onClick={() => setOverlay(false)}
          className="fixed inset-0 z-[9999] grid place-items-center bg-background/85 backdrop-blur-sm cursor-pointer"
        >
          <Loader3D size={120} label="Loading…" />
        </div>
      )}
    </div>
  );
}
