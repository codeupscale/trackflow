'use client';

import { ReactNode } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background dark:bg-gradient-to-br dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 relative">
          <div className="absolute right-0 top-0">
            <ThemeToggle />
          </div>
          <div className="text-center">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">TrackFlow</h1>
            <p className="text-muted-foreground mt-2 text-sm">Workforce monitoring made simple</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
