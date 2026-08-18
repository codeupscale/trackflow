'use client';

import { ReactNode } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen bg-white dark:bg-slate-950">
      <div className="absolute right-6 top-6 z-50">
        <ThemeToggle />
      </div>
      {children}
    </div>
  );
}
