"use client";

import {
    ArrowLeft,
    DollarSign,
    FileText,
    TrendingDown,
    TrendingUp,
    Users,
} from "lucide-react";
import Link from "next/link";
import { use } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { usePayrollPeriod } from "@/hooks/hr/use-payroll";
import { usePayslips } from "@/hooks/hr/use-payslips";
import { formatDate } from "@/lib/utils";

const statusDot: Record<string, { dot: string; text: string; label: string }> = {
    draft: { dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400", label: "Draft" },
    processing: { dot: "bg-blue-500", text: "text-blue-600 dark:text-blue-400", label: "Processing" },
    approved: { dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", label: "Approved" },
    paid: { dot: "bg-violet-500", text: "text-violet-600 dark:text-violet-400", label: "Paid" },
};

export default function PayrollPeriodDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = use(params);
    const {
        data: periodData,
        isLoading: periodLoading,
        isError: periodError,
    } = usePayrollPeriod(id);
    const { data: payslipsData, isLoading: payslipsLoading } = usePayslips({
        payroll_period_id: id,
    });

    const period = periodData?.data;
    const payslips = payslipsData?.data ?? [];

    if (periodLoading) {
        return (
            <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                    <Skeleton className="h-8 w-16" />
                    <div className="flex flex-col gap-1.5">
                        <Skeleton className="h-5 w-40" />
                        <Skeleton className="h-3 w-56" />
                    </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Card key={i}>
                            <CardContent className="p-3">
                                <div className="flex items-center gap-2.5">
                                    <Skeleton className="h-8 w-8 rounded-lg" />
                                    <div className="flex flex-col gap-1">
                                        <Skeleton className="h-2.5 w-16" />
                                        <Skeleton className="h-4 w-20" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
                <Card>
                    <CardContent className="p-0">
                        <div className="flex items-center gap-4 px-4 py-2.5 border-b border-border/50">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <Skeleton key={i} className="h-3 w-20" />
                            ))}
                        </div>
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0">
                                <Skeleton className="h-3.5 w-28" />
                                <Skeleton className="h-3.5 w-20" />
                                <Skeleton className="h-3.5 w-20" />
                                <Skeleton className="h-3.5 w-20" />
                                <Skeleton className="h-3.5 w-20" />
                                <Skeleton className="h-3.5 w-14" />
                            </div>
                        ))}
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (periodError || !period) {
        return (
            <div className="flex flex-col gap-4">
                <div>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs"
                        nativeButton={false}
                        render={<Link href="/hr/payroll" />}
                    >
                        <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                        Back
                    </Button>
                </div>
                <Card className="border-destructive/50">
                    <CardContent className="py-12">
                        <div className="flex flex-col items-center gap-2">
                            <DollarSign className="h-8 w-8 text-destructive/60" />
                            <p className="text-sm text-muted-foreground font-medium">
                                Failed to load payroll period
                            </p>
                            <p className="text-xs text-muted-foreground">
                                Please try again later.
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    const sd = statusDot[period.status] ?? statusDot.draft;

    const totalGross = payslips.reduce(
        (sum, p) => sum + Number(p.gross_salary),
        0,
    );
    const totalDeductions = payslips.reduce(
        (sum, p) => sum + Number(p.total_deductions),
        0,
    );
    const totalNet = payslips.reduce(
        (sum, p) => sum + Number(p.net_salary),
        0,
    );

    const stats = [
        {
            label: "Payslips",
            value: String(period.payslips_count ?? payslips.length),
            icon: Users,
            color: "text-blue-500",
            bg: "bg-blue-500/10",
        },
        {
            label: "Total Gross",
            value: `$${totalGross.toLocaleString("en-AU", { minimumFractionDigits: 2 })}`,
            icon: DollarSign,
            color: "text-emerald-500",
            bg: "bg-emerald-500/10",
        },
        {
            label: "Deductions",
            value: `$${totalDeductions.toLocaleString("en-AU", { minimumFractionDigits: 2 })}`,
            icon: TrendingDown,
            color: "text-red-500",
            bg: "bg-red-500/10",
        },
        {
            label: "Total Net",
            value: `$${totalNet.toLocaleString("en-AU", { minimumFractionDigits: 2 })}`,
            icon: TrendingUp,
            color: "text-violet-500",
            bg: "bg-violet-500/10",
        },
    ];

    return (
        <div className="flex flex-col gap-4">
            {/* Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs"
                        nativeButton={false}
                        render={<Link href="/hr/payroll" />}
                    >
                        <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                        Back
                    </Button>
                    <div>
                        <h1 className="text-lg font-semibold tracking-tight">
                            {period.name}
                        </h1>
                        <p className="text-xs text-muted-foreground">
                            {formatDate(period.start_date)} &ndash;{" "}
                            {formatDate(period.end_date)} &middot;{" "}
                            <span className="capitalize">{period.period_type.replace("-", " ")}</span>
                        </p>
                    </div>
                </div>
                <span className={`inline-flex items-center gap-1.5 text-[0.7rem] font-medium ${sd.text}`}>
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${sd.dot}`} />
                    {sd.label}
                </span>
            </div>

            {/* Stats Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {stats.map((s) => (
                    <Card key={s.label} className="border-border">
                        <CardContent className="p-3">
                            <div className="flex items-center gap-2.5">
                                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${s.bg} shrink-0`}>
                                    <s.icon className={`h-4 w-4 ${s.color}`} />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">
                                        {s.label}
                                    </p>
                                    <p className="text-base font-bold text-foreground tabular-nums leading-tight truncate">
                                        {s.value}
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Payslips Table */}
            {payslipsLoading ? (
                <Card>
                    <CardContent className="p-0">
                        <div className="flex items-center gap-4 px-4 py-2.5 border-b border-border/50">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <Skeleton key={i} className="h-3 w-20" />
                            ))}
                        </div>
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0">
                                <Skeleton className="h-3.5 w-28" />
                                <Skeleton className="h-3.5 w-20" />
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
                            <FileText className="h-8 w-8 text-muted-foreground/40" />
                            <p className="text-sm text-muted-foreground font-medium">
                                No payslips generated yet
                            </p>
                            <p className="text-xs text-muted-foreground">
                                Run payroll to generate payslips for this period.
                            </p>
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <Card>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-border/50">
                                        <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">
                                            Employee
                                        </th>
                                        <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">
                                            Gross
                                        </th>
                                        <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">
                                            Allowances
                                        </th>
                                        <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">
                                            Deductions
                                        </th>
                                        <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">
                                            Net
                                        </th>
                                        <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">
                                            Status
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {payslips.map((payslip) => {
                                        const psd = statusDot[payslip.status] ?? statusDot.draft;
                                        return (
                                            <tr
                                                key={payslip.id}
                                                className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors"
                                            >
                                                <td className="px-4 py-2.5 whitespace-nowrap">
                                                    <div>
                                                        <span className="text-[0.75rem] font-medium text-foreground">
                                                            {payslip.user?.name ?? "Unknown"}
                                                        </span>
                                                        <p className="text-[0.65rem] text-muted-foreground">
                                                            {payslip.user?.email}
                                                        </p>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-2.5 whitespace-nowrap text-right">
                                                    <span className="text-[0.75rem] text-foreground tabular-nums">
                                                        $
                                                        {Number(
                                                            payslip.gross_salary,
                                                        ).toLocaleString("en-AU", {
                                                            minimumFractionDigits: 2,
                                                        })}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2.5 whitespace-nowrap text-right">
                                                    <span className="text-[0.75rem] text-emerald-600 dark:text-emerald-400 tabular-nums">
                                                        +$
                                                        {Number(
                                                            payslip.total_allowances,
                                                        ).toLocaleString("en-AU", {
                                                            minimumFractionDigits: 2,
                                                        })}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2.5 whitespace-nowrap text-right">
                                                    <span className="text-[0.75rem] text-red-600 dark:text-red-400 tabular-nums">
                                                        -$
                                                        {Number(
                                                            payslip.total_deductions,
                                                        ).toLocaleString("en-AU", {
                                                            minimumFractionDigits: 2,
                                                        })}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2.5 whitespace-nowrap text-right">
                                                    <span className="text-[0.75rem] font-medium text-foreground tabular-nums">
                                                        $
                                                        {Number(
                                                            payslip.net_salary,
                                                        ).toLocaleString("en-AU", {
                                                            minimumFractionDigits: 2,
                                                        })}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2.5 whitespace-nowrap">
                                                    <span className={`inline-flex items-center gap-1.5 text-[0.7rem] font-medium ${psd.text}`}>
                                                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${psd.dot}`} />
                                                        {psd.label}
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
            )}
        </div>
    );
}
