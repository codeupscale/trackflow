'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FileText } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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
import { formatDate } from '@/lib/utils';

export default function MyPayslipsPage() {
  const { user } = useAuthStore();
  const [currentPage, setCurrentPage] = useState(1);

  const { data, isLoading, isError } = usePayslips({
    user_id: user?.id,
    page: currentPage,
  });

  const payslips = data?.data ?? [];
  const totalPages = data?.meta?.last_page ?? 1;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">My Payslips</h1>
        <p className="text-sm text-muted-foreground mt-1">
          View your salary payslips and payment history
        </p>
      </div>

      {isError ? (
        <Card>
          <CardContent className="py-8">
            <p className="text-center text-muted-foreground">Failed to load payslips</p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : payslips.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <FileText className="mx-auto mb-2 text-muted-foreground" />
              <p className="text-muted-foreground font-medium">No payslips yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Your payslips will appear here once payroll has been processed.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="hidden md:grid md:grid-cols-5 gap-4 px-4 py-2.5 text-xs font-medium text-muted-foreground border-b border-border">
              <span>Period</span>
              <span className="text-right">Gross</span>
              <span className="text-right">Deductions</span>
              <span className="text-right">Net</span>
              <span>Status</span>
            </div>
            {payslips.map((payslip, idx) => (
              <div key={payslip.id}>
                {idx > 0 && <Separator />}
                <Link href={`/hr/payroll/periods/${payslip.payroll_period_id}`}>
                  <div className="grid grid-cols-2 gap-2 px-4 py-3 md:grid-cols-5 md:gap-4 md:items-center hover:bg-muted/50 transition-colors">
                    <div className="font-medium text-sm text-foreground">
                      {payslip.payroll_period?.name ?? 'N/A'}
                      <div className="text-xs text-muted-foreground md:hidden">
                        {formatDate(payslip.payroll_period?.start_date)} &mdash; {formatDate(payslip.payroll_period?.end_date)}
                      </div>
                    </div>
                    <div className="text-sm tabular-nums text-right">
                      ${Number(payslip.gross_salary).toLocaleString('en-AU', { minimumFractionDigits: 2 })}
                    </div>
                    <div className="text-sm tabular-nums text-right text-destructive">
                      -${Number(payslip.total_deductions).toLocaleString('en-AU', { minimumFractionDigits: 2 })}
                    </div>
                    <div className="text-sm tabular-nums text-right font-medium">
                      ${Number(payslip.net_salary).toLocaleString('en-AU', { minimumFractionDigits: 2 })}
                    </div>
                    <div>
                      <Badge variant={payslip.status === 'paid' ? 'default' : 'secondary'}>
                        {payslip.status}
                      </Badge>
                    </div>
                  </div>
                </Link>
              </div>
            ))}
          </CardContent>

          {totalPages > 1 && (
            <div className="flex items-center justify-center border-t border-border p-4">
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
                        <PaginationItem key={`ellipsis-${idx}`}>
                          <PaginationEllipsis />
                        </PaginationItem>
                      ) : (
                        <PaginationItem key={p}>
                          <PaginationLink
                            isActive={p === currentPage}
                            onClick={() => setCurrentPage(p)}
                            className="cursor-pointer"
                          >
                            {p}
                          </PaginationLink>
                        </PaginationItem>
                      )
                    )}
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      aria-disabled={currentPage === totalPages}
                      className={currentPage === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
