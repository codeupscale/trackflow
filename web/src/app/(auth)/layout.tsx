'use client';

import { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-white">
            TrackFlow
          </h1>
          <p className="text-slate-400 mt-2 text-sm">
            Workforce monitoring made simple
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
