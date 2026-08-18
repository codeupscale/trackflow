'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  DollarSign,
  FileText,
  Receipt,
  TrendingDown,
} from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';

import { usePayslips } from '@/hooks/hr/use-payslips';
import { useAuthStore } from '@/stores/auth-store';
import { cn, formatDate } from '@/lib/utils';

const statusDot: Record<string, { dot: string; text: string; label: string }> = {
  draft: { dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', label: 'Draft' },
  approved: { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', label: 'Approved' },
  paid: { dot: 'bg-violet-500', text: 'text-violet-600 dark:text-violet-400', label: 'Paid' },
};

function formatCurrency(value: string | number) {
  return Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function MyPayslipsPage() {
  const { user } = useAuthStore();
  const [currentPage, setCurrentPage] = useState(1);

  const { data, isLoading, isError } = usePayslips({
    user_id: user?.id,
    page: currentPage,
  });

  const payslips = data?.data ?? [];
  const totalPages = data?.meta?.last_page ?? 1;
  const totalCount = data?.meta?.total ?? payslips.length;

  const latestPayslip = payslips[0];

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold tracking-tight">My Payslips</h1>
        <p className="text-xs text-muted-foreground">
          View your salary payslips and payment history
        </p>
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Slips', value: isLoading ? '--' : totalCount, icon: FileText, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Latest Gross', value: isLoading || !latestPayslip ? '--' : `$${formatCurrency(latestPayslip.gross_salary)}`, icon: DollarSign, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          { label: 'Latest Deductions', value: isLoading || !latestPayslip ? '--' : `$${formatCurrency(latestPayslip.total_deductions)}`, icon: TrendingDown, color: 'text-red-500', bg: 'bg-red-500/10' },
          { label: 'Latest Net', value: isLoading || !latestPayslip ? '--' : `$${formatCurrency(latestPayslip.net_salary)}`, icon: Receipt, color: 'text-violet-500', bg: 'bg-violet-500/10' },
        ].map((s) => (
          <Card key={s.label} className="border-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-2.5">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${s.bg} shrink-0`}>
                  <s.icon className={`h-4 w-4 ${s.color}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">{s.label}</p>
                  <p className="text-base font-bold text-foreground tabular-nums leading-tight truncate">
                    {s.value}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table */}
      {isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-12">
            <div className="flex flex-col items-center gap-2">
              <Receipt className="h-8 w-8 text-destructive/60" />
              <p className="text-sm text-muted-foreground font-medium">Failed to load payslips</p>
              <p className="text-xs text-muted-foreground">Please try again later.</p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center gap-4 px-4 py-2.5 border-b border-border/50">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-3 w-20" />
              ))}
            </div>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-3.5 w-14" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : payslips.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center gap-2">
              <Receipt className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">No payslips yet</p>
              <p className="text-xs text-muted-foreground">
                Your payslips will appear here once payroll has been processed.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Period</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">Gross</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">Deductions</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">Net</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payslips.map((payslip) => {
                      const sd = statusDot[payslip.status] ?? statusDot.draft;
                      return (
                        <tr key={payslip.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <Link
                              href={`/hr/payroll/periods/${payslip.payroll_period_id}`}
                              className="group"
                            >
                              <p className="text-[0.75rem] font-medium text-foreground group-hover:text-primary transition-colors">
                                {payslip.payroll_period?.name ?? 'N/A'}
                              </p>
                              {payslip.payroll_period?.start_date && (
                                <p className="text-[0.6rem] text-muted-foreground tabular-nums">
                                  {formatDate(payslip.payroll_period.start_date)} &ndash; {formatDate(payslip.payroll_period.end_date)}
                                </p>
                              )}
                            </Link>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-right">
                            <span className="text-[0.75rem] font-medium text-foreground tabular-nums">
                              ${formatCurrency(payslip.gross_salary)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-right">
                            <span className="text-[0.75rem] font-medium text-red-600 dark:text-red-400 tabular-nums">
                              -${formatCurrency(payslip.total_deductions)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-right">
                            <span className="text-[0.75rem] font-bold text-foreground tabular-nums">
                              ${formatCurrency(payslip.net_salary)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1.5 text-[0.7rem] font-medium ${sd.text}`}>
                              <span className={`inline-block w-1.5 h-1.5 rounded-full ${sd.dot}`} />
                              {sd.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-1">
              <p className="text-[0.65rem] text-muted-foreground">Page {currentPage} of {totalPages}</p>
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      aria-disabled={currentPage === 1}
                      className={currentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                    .reduce((acc, p, idx, arr) => {
                      if (idx > 0 && p - arr[idx - 1] > 1) acc.push(-1);
                      acc.push(p);
                      return acc;
                    }, [] as number[])
                    .map((p, idx) =>
                      p === -1 ? (
                        <PaginationItem key={`e-${idx}`}><PaginationEllipsis /></PaginationItem>
                      ) : (
                        <PaginationItem key={p}>
                          <PaginationLink isActive={p === currentPage} onClick={() => setCurrentPage(p)} className="cursor-pointer">
                            {p}
                          </PaginationLink>
                        </PaginationItem>
                      ),
                    )}
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      aria-disabled={currentPage === totalPages}
                      className={currentPage >= totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </>
      )}
    </div>
  );
}
