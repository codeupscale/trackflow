'use client';

import { useEffect, useRef, useState } from 'react';
import {
  DollarSign,
  Download,
  Eye,
  FileText,
  Loader2,
  Receipt,
  TrendingDown,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
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
import { MONTHS, PayrollPeriodFilter } from '@/components/hr/PayrollPeriodFilter';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useDownloadPayslip, usePayslipPreviewUrl } from '@/hooks/hr/use-payslip-template';
import { useAuthStore } from '@/stores/auth-store';
import { formatDate } from '@/lib/utils';
import { useMoney } from '@/lib/money';

const statusDot: Record<string, { dot: string; text: string; label: string }> = {
  draft: { dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', label: 'Draft' },
  verified: { dot: 'bg-blue-500', text: 'text-blue-600 dark:text-blue-400', label: 'Verified' },
  approved: { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', label: 'Approved' },
  paid: { dot: 'bg-violet-500', text: 'text-violet-600 dark:text-violet-400', label: 'Paid' },
};

/**
 * The status as it means something to the person being PAID.
 *
 * `payslips.status` tracks the payroll run — draft while the operator is still
 * working, then approved, then paid. An employee never sees a payslip until
 * someone has verified and sent it, so "Draft" was both alarming and untrue:
 * from where they stand the document is finished and checked. Verification is
 * the fact that matters to them, so it is the one shown.
 *
 * Approved and paid still win, because they say something further: the run has
 * been signed off, and the money has gone out.
 */
function employeeStatus(payslip: { status: string; verified_at: string | null }): string {
  if (payslip.status === 'paid' || payslip.status === 'approved') return payslip.status;
  return payslip.verified_at ? 'verified' : 'draft';
}


export default function MyPayslipsPage() {
  const { user } = useAuthStore();
  const money = useMoney();
  const [currentPage, setCurrentPage] = useState(1);
  const downloadPayslip = useDownloadPayslip();
  // Tracked per row so only the payslip being fetched shows a spinner — the
  // mutation's own isPending is shared by every button in the table.
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Reading your own payslip happens HERE rather than on the operator's review
  // screen. Same PDF, same endpoint — the API only ever returns a payslip the
  // caller is allowed to read.
  const previewPayslip = usePayslipPreviewUrl();
  const [viewing, setViewing] = useState<{ id: string; period: string } | null>(null);
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  /** Held so the blob can be revoked; a URL left behind is leaked memory. */
  const viewUrlRef = useRef<string | null>(null);

  // `undefined` means every year. The picker starts on the current one, which
  // is what someone checking their earnings almost always wants.
  const [year, setYear] = useState<number | undefined>(new Date().getFullYear());
  /** 1-12, or undefined for the whole year. */
  const [month, setMonth] = useState<number | undefined>(undefined);

  const { data, isLoading, isError } = usePayslips({
    user_id: user?.id,
    page: currentPage,
    year,
    month,
  });

  const payslips = data?.data ?? [];
  const totalPages = data?.meta?.last_page ?? 1;
  const totals = data?.totals;
  const years = data?.years ?? [];

  /**
   * What the tiles are totalling, said in the tile's own label — "September
   * 2026 Gross", "2026 Gross", "All-time Gross". A figure whose scope is only
   * legible from a dropdown elsewhere on the page invites being read as
   * something it is not.
   */
  const periodLabel = month
    ? `${MONTHS[month - 1]}${year ? ` ${year}` : ''}`
    : year
      ? String(year)
      : 'All-time';

  const releaseViewUrl = () => {
    if (viewUrlRef.current) URL.revokeObjectURL(viewUrlRef.current);
    viewUrlRef.current = null;
    setViewUrl(null);
  };

  const openPreview = async (payslip: (typeof payslips)[number]) => {
    releaseViewUrl();
    setViewing({ id: payslip.id, period: payslip.payroll_period?.name ?? 'Payslip' });
    setViewLoading(true);
    try {
      const url = await previewPayslip.mutateAsync(payslip.id);
      viewUrlRef.current = url;
      setViewUrl(url);
    } catch {
      // The hook surfaced the reason; the dialog shows its empty state.
    } finally {
      setViewLoading(false);
    }
  };

  // Revoke on unmount too — closing the dialog is not the only way to leave.
  useEffect(() => releaseViewUrl, []);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">My Payslips</h1>
          <p className="text-xs text-muted-foreground">
            View your salary payslips and payment history
          </p>
        </div>

        {/* Shared with the payroll periods tab, so an employee's filter and an
            operator's cannot drift apart — the API scopes the rows by role, so
            identical code answers both questions. */}
        <PayrollPeriodFilter
          years={years}
          year={year}
          month={month}
          onYearChange={(y) => {
            setCurrentPage(1);
            setYear(y);
          }}
          onMonthChange={(m) => {
            setCurrentPage(1);
            setMonth(m);
          }}
        />
      </div>

      {/* What you were actually paid over the selected period.
          These used to read "Latest Gross / Latest Deductions / Latest Net" —
          one month, which is the wrong shape for checking a year. Every figure
          below is summed by the SERVER across the whole filtered set, so it
          stays right past the first page of payslips. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: `${periodLabel} Gross`,
            value: isLoading || !totals ? '--' : money(totals.gross),
            icon: DollarSign, color: 'text-emerald-500', bg: 'bg-emerald-500/10',
          },
          {
            // Tax on its own, not folded into deductions — it is the figure
            // people need when filing.
            label: `${periodLabel} Tax`,
            value: isLoading || !totals ? '--' : money(totals.tax),
            icon: Receipt, color: 'text-amber-500', bg: 'bg-amber-500/10',
          },
          {
            label: `${periodLabel} Deductions`,
            value: isLoading || !totals ? '--' : money(totals.deductions),
            icon: TrendingDown, color: 'text-red-500', bg: 'bg-red-500/10',
          },
          {
            label: `${periodLabel} Net Paid`,
            value: isLoading || !totals ? '--' : money(totals.net),
            icon: FileText, color: 'text-violet-500', bg: 'bg-violet-500/10',
          },
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

      {/* Says what the totals are made of. A payslip that is verified but whose
          run is not yet approved is a real figure the employee can see, and
          counting it is right — but "3 of 4 finalised" is the difference
          between a total someone can rely on for a tax return and one they
          should wait on. */}
      {!isLoading && totals && totals.slips > 0 && (
        <p className="-mt-1 text-[0.65rem] text-muted-foreground">
          {totals.slips} {totals.slips === 1 ? 'payslip' : 'payslips'}
          {year ? ` in ${year}` : ''}
          {totals.finalised < totals.slips
            ? ` — ${totals.finalised} of ${totals.slips} finalised, the rest are still part of an open payroll run.`
            : ' — all finalised.'}
        </p>
      )}

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
              {/* Names the filter, because "no payslips" over a period you
                  chose reads as an empty account rather than an empty
                  selection. */}
              <p className="text-sm text-muted-foreground font-medium">
                {year || month ? `No payslips in ${periodLabel}` : 'No payslips yet'}
              </p>
              <p className="text-xs text-muted-foreground">
                {year || month
                  ? 'Try another period, or choose All years.'
                  : 'Your payslips will appear here once payroll has been processed.'}
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
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">Payslip</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payslips.map((payslip) => {
                      const sd = statusDot[employeeStatus(payslip)] ?? statusDot.draft;
                      return (
                        <tr key={payslip.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                          {/* Opens THIS payslip, not the period.
                              It used to link to /hr/payroll/periods/{id} — the
                              payroll operator's review screen, with its run
                              totals, verification column and approval controls.
                              The API scopes the rows, so no colleague's figures
                              were ever exposed, but an employee clicking their
                              own September payslip landed in a management tool
                              built for a different job. */}
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <button
                              type="button"
                              className="group text-left"
                              onClick={() => openPreview(payslip)}
                            >
                              <p className="text-[0.75rem] font-medium text-foreground group-hover:text-primary transition-colors">
                                {payslip.payroll_period?.name ?? 'N/A'}
                              </p>
                              {payslip.payroll_period?.start_date && (
                                <p className="text-[0.6rem] text-muted-foreground tabular-nums">
                                  {formatDate(payslip.payroll_period.start_date)} &ndash; {formatDate(payslip.payroll_period.end_date)}
                                </p>
                              )}
                            </button>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-right">
                            <span className="text-[0.75rem] font-medium text-foreground tabular-nums">
                              {money(payslip.gross_salary)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-right">
                            <span className="text-[0.75rem] font-medium text-red-600 dark:text-red-400 tabular-nums">
                              -{money(payslip.total_deductions)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-right">
                            <span className="text-[0.75rem] font-bold text-foreground tabular-nums">
                              {money(payslip.net_salary)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1.5 text-[0.7rem] font-medium ${sd.text}`}>
                              <span className={`inline-block w-1.5 h-1.5 rounded-full ${sd.dot}`} />
                              {sd.label}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 mr-1.5 text-[0.7rem]"
                              onClick={() => openPreview(payslip)}
                            >
                              <Eye className="mr-1.5 h-3.5 w-3.5" />
                              View
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-[0.7rem]"
                              disabled={downloadingId === payslip.id}
                              onClick={async () => {
                                setDownloadingId(payslip.id);
                                try {
                                  await downloadPayslip.mutateAsync({ id: payslip.id });
                                } catch {
                                  // The hook's onError already surfaced the real
                                  // reason; swallowed so mutateAsync's rethrow
                                  // does not become an unhandled rejection.
                                } finally {
                                  setDownloadingId(null);
                                }
                              }}
                            >
                              {downloadingId === payslip.id ? (
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Download className="mr-1.5 h-3.5 w-3.5" />
                              )}
                              PDF
                            </Button>
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

      {/* Your own payslip, at the size it prints. Wide enough for A4 at 794px
          so the viewer is not shrinking the page — and `sm:max-w-` is
          load-bearing, since DialogContent's own `sm:max-w-sm` beats a plain
          `max-w-*` at every width above 640px. */}
      <Dialog
        open={Boolean(viewing)}
        onOpenChange={(open) => {
          if (!open) {
            releaseViewUrl();
            setViewing(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="text-sm">{viewing?.period}</DialogTitle>
            <DialogDescription className="text-xs">
              Your payslip for this period.
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            {viewUrl ? (
              <iframe
                src={viewUrl}
                title="Payslip"
                className="h-[74vh] w-full rounded-md border border-border bg-white"
              />
            ) : (
              <Skeleton className="h-[74vh] w-full rounded-md" />
            )}
            {viewLoading && (
              <div className="absolute inset-0 flex items-center justify-center rounded-md bg-background/60">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={!viewing || downloadingId === viewing.id}
              onClick={async () => {
                if (!viewing) return;
                setDownloadingId(viewing.id);
                try {
                  await downloadPayslip.mutateAsync({ id: viewing.id });
                } catch {
                  // onError surfaced the reason.
                } finally {
                  setDownloadingId(null);
                }
              }}
            >
              {viewing && downloadingId === viewing.id ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="mr-1.5 h-3.5 w-3.5" />
              )}
              Download PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
