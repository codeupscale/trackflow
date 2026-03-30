'use client';

import { ReactNode } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { TrackFlowLogo } from '@/components/ui/trackflow-logo';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background dark:bg-gradient-to-br dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 relative">
          <div className="absolute right-0 top-0">
            <ThemeToggle />
          </div>
          <div className="flex flex-col items-center gap-2">
            <TrackFlowLogo size={40} showText={true} />
            <p className="text-muted-foreground mt-1 text-sm">Workforce monitoring made simple</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
