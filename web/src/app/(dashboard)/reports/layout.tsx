'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';

import { useAuthStore } from '@/stores/auth-store';
import { usePermissionStore } from '@/stores/permission-store';

/**
 * One gate for every /reports route (overview, project time, app usage).
 *
 * The sidebar hides the section from anyone without reports.view, but a menu
 * that filters on key presence gates a menu and nothing else — a bookmark or a
 * typed URL walked straight in. The API refuses these callers anyway (the whole
 * prefix is behind permission:reports.view), so without this they landed on a
 * page of failed requests instead of somewhere useful.
 *
 * Placed on the layout rather than on each page so a new report screen inherits
 * the gate instead of having to remember it.
 */
export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user } = useAuthStore();
  const { hasPermission } = usePermissionStore();

  const canViewReports = hasPermission('reports.view');

  useEffect(() => {
    if (user && !canViewReports) {
      router.replace('/dashboard');
    }
  }, [user, canViewReports, router]);

  // Hold the spinner until the permission map has loaded, so an authorised user
  // never sees a flash of the redirect.
  if (!user || !canViewReports) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <>{children}</>;
}
