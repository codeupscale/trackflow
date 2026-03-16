'use client';

import { WifiOff } from 'lucide-react';
import { useNetworkStatus } from '@/hooks/use-network-status';

export function OfflineBanner() {
  const isOnline = useNetworkStatus();

  if (isOnline) return null;

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-center">
      <div className="flex items-center justify-center gap-2 text-amber-400 text-sm">
        <WifiOff className="h-4 w-4" />
        <span>You are offline. Some features may be unavailable.</span>
      </div>
    </div>
  );
}
