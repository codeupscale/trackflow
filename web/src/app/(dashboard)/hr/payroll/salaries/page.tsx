'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { PageLoading } from '@/components/page-loading';

/**
 * The salary roster now lives as a tab on /hr/payroll — assigning a salary is
 * part of the payroll run, not a separate errand.
 *
 * The route is kept rather than deleted because it was in the nav for months
 * and is certainly bookmarked. `replace` rather than `push` so Back returns to
 * wherever the user came from instead of bouncing through this redirect again.
 */
export default function SalaryRosterRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/hr/payroll');
  }, [router]);

  return <PageLoading />;
}
