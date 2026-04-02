'use client';

import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

import { usePayrollPeriod } from '@/hooks/hr/use-payroll';
import { usePayslips } from '@/hooks/hr/use-payslips';
import { formatDate } from '@/lib/utils';

export default function PayrollPeriodDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: periodData, isLoading: periodLoading, isError: periodError } = usePayrollPeriod(id);
  const { data: payslipsData, isLoading: payslipsLoading } = usePayslips({ payroll_period_id: id });

  const period = periodData?.data;
  const payslips = payslipsData?.data ?? [];

  if (periodLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (periodError || !period) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-center text-muted-foreground">Failed to load payroll period</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" render={<Link href="/hr/payroll" />}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{period.name}</h1>
          <p className="text-sm text-muted-foreground">
            {formatDate(period.start_date)} &mdash; {formatDate(period.end_date)} | {period.period_type}
          </p>
        </div>
        <Badge className="ml-auto" variant={period.status === 'approved' || period.status === 'paid' ? 'default' : 'secondary'}>
          {period.status}
        </Badge>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Payslips</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{period.payslips_count ?? payslips.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Gross</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">
              ${payslips.reduce((sum, p) => sum + Number(p.gross_salary), 0).toLocaleString('en-AU', { minimumFractionDigits: 2 })}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Net</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">
              ${payslips.reduce((sum, p) => sum + Number(p.net_salary), 0).toLocaleString('en-AU', { minimumFractionDigits: 2 })}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Payslips Table */}
      <Card>
        <CardHeader>
          <CardTitle>Payslips</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {payslipsLoading ? (
            <div className="p-4 flex flex-col gap-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : payslips.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No payslips generated yet. Run payroll to generate payslips.
            </div>
          ) : (
            <>
              <div className="hidden md:grid md:grid-cols-6 gap-4 px-4 py-2.5 text-xs font-medium text-muted-foreground border-b border-border">
                <span>Employee</span>
                <span className="text-right">Gross</span>
                <span className="text-right">Allowances</span>
                <span className="text-right">Deductions</span>
                <span className="text-right">Net</span>
                <span>Status</span>
              </div>
              {payslips.map((payslip, idx) => (
                <div key={payslip.id}>
                  {idx > 0 && <Separator />}
                  <div className="grid grid-cols-2 gap-2 px-4 py-3 md:grid-cols-6 md:gap-4 md:items-center">
                    <div className="font-medium text-sm text-foreground">
                      {payslip.user?.name ?? 'Unknown'}
                      <div className="text-xs text-muted-foreground">{payslip.user?.email}</div>
                    </div>
                    <div className="text-sm tabular-nums text-right">
                      ${Number(payslip.gross_salary).toLocaleString('en-AU', { minimumFractionDigits: 2 })}
                    </div>
                    <div className="text-sm tabular-nums text-right text-green-600">
                      +${Number(payslip.total_allowances).toLocaleString('en-AU', { minimumFractionDigits: 2 })}
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
                </div>
              ))}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
