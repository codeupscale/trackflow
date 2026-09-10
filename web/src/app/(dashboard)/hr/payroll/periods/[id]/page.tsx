"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
    AlertTriangle,
    ArrowLeft,
    Check,
    ChevronLeft,
    ChevronRight,
    DollarSign,
    Download,
    Eye,
    FileText,
    Loader2,
    Send,
    ShieldCheck,
    TrendingDown,
    TrendingUp,
    Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { usePayrollPeriod } from "@/hooks/hr/use-payroll";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import { PayslipLinesDialog } from "@/components/hr/PayslipLinesDialog";
import { usePermissionStore } from "@/stores/permission-store";
import { useAuthStore } from "@/stores/auth-store";
import { usePayslips } from "@/hooks/hr/use-payslips";
import {
    useDownloadPayslip,
    usePayslipPreviewUrl,
    useUnverifyPayslip,
    useVerifyPayslip,
} from "@/hooks/hr/use-payslip-template";
import { cn, formatDate } from "@/lib/utils";
import { formatMoney, useCurrency } from "@/lib/money";
import { isReleased, type Payslip } from "@/lib/validations/payroll";


/** Shown where a figure is genuinely zero, so the eye skips it. */
const dash = <span className="text-muted-foreground/50">—</span>;

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
    const { hasPermission } = usePermissionStore();
    const { user } = useAuthStore();
    // Editing figures is payroll work — the same right the API gates it on.
    const canRun = hasPermission("payroll.run");
    // This is the payroll OPERATOR's screen: the whole run, its totals and its
    // approval controls. An employee holds only payroll.view_own, and the API
    // narrows the rows to their own — but landing here from My Payslips put
    // them in a management tool built for a different job. Sent back to the
    // page that is theirs.
    const canViewRun = hasPermission("payroll.view_all") || hasPermission("payroll.view_team");
    const router = useRouter();
    useEffect(() => {
        if (!canViewRun) router.replace("/hr/payroll/my-payslips");
    }, [canViewRun, router]);
    const downloadPayslip = useDownloadPayslip();
    const previewPayslip = usePayslipPreviewUrl();
    const verifyPayslip = useVerifyPayslip();
    const unverifyPayslip = useUnverifyPayslip();

    // Per-row, so only the payslip being opened spins.
    const [openingId, setOpeningId] = useState<string | null>(null);
    // Per row, so sending one employee does not spin every button in the table.
    const [sendingId, setSendingId] = useState<string | null>(null);
    // The review is a walkthrough of the whole period, so it tracks a POSITION
    // in the list rather than one payslip — that is what lets back/next move
    // between employees without closing and reopening.
    const [reviewIndex, setReviewIndex] = useState<number | null>(null);
    const [reviewUrl, setReviewUrl] = useState<string | null>(null);
    const [reviewLoading, setReviewLoading] = useState(false);
    const reviewUrlRef = useRef<string | null>(null);
    /** The payslip whose earnings and deductions are being edited. */
    const [editing, setEditing] = useState<Payslip | null>(null);

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

    const reviewing = reviewIndex !== null ? payslips[reviewIndex] : undefined;
    const currency = useCurrency();
    /**
     * One money format for the whole table, so columns line up digit for
     * digit. No currency symbol per cell — it repeats eighty times on a full
     * run and adds nothing; the summary tiles above carry it.
     */
    const money = useCallback(
        (value: number | string | null | undefined) =>
            formatMoney(value, currency, { symbol: false }),
        [currency],
    );

    /**
     * A payslip this operator may not act on — their own.
     *
     * The server refuses verify, withdraw and edit on your own payslip so that
     * nobody can raise their own pay and release it unaided. The owner is
     * exempt there, and must be exempt here too, or the screen would forbid
     * something the API allows.
     *
     * Mirrored in the UI rather than left to the API's 422 because a refusal
     * arriving as a red toast reads as a fault in the system; a control that
     * explains itself before you press it reads as a rule.
     */
    const isOwnPayslip = useCallback(
        (payslip: Pick<Payslip, "user_id">) =>
            payslip.user_id === user?.id && user?.role !== "owner",
        [user?.id, user?.role],
    );

    /** On the last payslip of the walkthrough — there is nothing after it. */
    const isLastReviewed = reviewIndex !== null && reviewIndex >= payslips.length - 1;

    const verifiedCount = payslips.filter(isReleased).length;
    const allVerified = payslips.length > 0 && verifiedCount === payslips.length;

    /**
     * What this run costs, summed from the rows ON SCREEN rather than fetched
     * separately — a footer that disagrees with the column above it is worse
     * than no footer, and this is the figure someone signs off.
     */
    const totals = payslips.reduce(
        (acc, p) => {
            const tax = Number(p.tax_total ?? 0);
            const deductions = Number(p.total_deductions ?? 0);
            return {
                base: acc.base + Number(p.basic_total ?? 0),
                allowances: acc.allowances + Number(p.total_allowances ?? 0),
                bonus: acc.bonus + Number(p.bonus_total ?? 0),
                gross: acc.gross + Number(p.gross_salary ?? 0),
                tax: acc.tax + tax,
                other: acc.other + Math.max(0, deductions - tax),
                net: acc.net + Number(p.net_salary ?? 0),
            };
        },
        { base: 0, allowances: 0, bonus: 0, gross: 0, tax: 0, other: 0, net: 0 },
    );

    /**
     * Fetch the reviewed employee's payslip whenever the DOCUMENT changes.
     *
     * Not the id alone. Verifying a payslip changes what the PDF says — the
     * stamp goes from DRAFT to VERIFIED — without changing which payslip it
     * is, so keying on the id left the iframe showing the document as it was
     * BEFORE the send: the header read "Verified", the row read "Sent by
     * Fiona", and the page beneath them still said DRAFT.
     *
     * Scalars only. The mutation object is a new reference on every render, so
     * depending on it would refetch the same PDF forever.
     */
    const reviewDocKey = reviewing
        ? `${reviewing.id}:${reviewing.verified_at ?? ""}:${reviewing.withdrawn_at ?? ""}:${reviewing.updated_at}`
        : null;

    useEffect(() => {
        const payslipId = reviewing?.id;
        if (!payslipId) return;

        let cancelled = false;
        setReviewLoading(true);

        previewPayslip
            .mutateAsync(payslipId)
            .then((url) => {
                // A URL that arrives after the user moved on is leaked memory
                // unless it is revoked here.
                if (cancelled) {
                    URL.revokeObjectURL(url);
                    return;
                }
                if (reviewUrlRef.current) URL.revokeObjectURL(reviewUrlRef.current);
                reviewUrlRef.current = url;
                setReviewUrl(url);
            })
            .catch(() => {
                if (!cancelled) setReviewUrl(null);
            })
            .finally(() => {
                if (!cancelled) setReviewLoading(false);
            });

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reviewDocKey]);

    useEffect(
        () => () => {
            if (reviewUrlRef.current) URL.revokeObjectURL(reviewUrlRef.current);
        },
        [],
    );

    const openReview = (index: number) => {
        setOpeningId(payslips[index]?.id ?? null);
        setReviewIndex(index);
    };

    const closeReview = () => {
        if (reviewUrlRef.current) URL.revokeObjectURL(reviewUrlRef.current);
        reviewUrlRef.current = null;
        setReviewUrl(null);
        setReviewIndex(null);
        setOpeningId(null);
    };

    const step = (delta: number) => {
        setReviewIndex((i) => {
            if (i === null) return i;
            return Math.min(payslips.length - 1, Math.max(0, i + delta));
        });
    };

    /**
     * Release ONE payslip to its employee.
     *
     * Send only — the reverse belongs in the review dialog. Verifying is what
     * makes a payslip visible to the person it belongs to, and doing that for
     * one employee after fixing their figures is routine; undoing it is not,
     * and should not be a same-sized button beside it.
     *
     * Tracked per row so only the button pressed spins.
     */
    const sendOne = async (payslip: Payslip) => {
        setSendingId(payslip.id);
        try {
            await verifyPayslip.mutateAsync(payslip.id);
        } catch {
            // onError surfaced the reason.
        } finally {
            setSendingId(null);
        }
    };

    /**
     * Verify the current payslip and move on.
     *
     * Advancing automatically is the whole point of the walkthrough: the task
     * is "check all eight", and making someone click next after every verify
     * doubles the clicks for no decision.
     */
    const verifyAndAdvance = async () => {
        if (!reviewing) return;
        try {
            await verifyPayslip.mutateAsync(reviewing.id);
        } catch {
            return; // onError surfaced the reason; stay put so it can be read.
        }
        if (reviewIndex !== null && reviewIndex < payslips.length - 1) {
            setReviewIndex(reviewIndex + 1);
            return;
        }

        // The LAST one stays open. Closing the moment it is sent snatches the
        // screen away at the instant of the final confirmation, so the run ends
        // with a disappearance rather than an acknowledgement — the footer now
        // shows the payslip as sent and offers Done.
    };

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
            value: formatMoney(totalGross, currency),
            icon: DollarSign,
            color: "text-emerald-500",
            bg: "bg-emerald-500/10",
        },
        {
            label: "Deductions",
            value: formatMoney(totalDeductions, currency),
            icon: TrendingDown,
            color: "text-red-500",
            bg: "bg-red-500/10",
        },
        {
            label: "Total Net",
            value: formatMoney(totalNet, currency),
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
                        {/* Who did what, on the run itself. Owner and finance
                            manager can both run payroll, so "processed at
                            14:02" with no name against it leaves nobody
                            accountable for the figures below. */}
                        {(period.processor || period.approver) && (
                            <p className="mt-0.5 text-[0.65rem] text-muted-foreground">
                                {period.processor && (
                                    <>
                                        Run by{" "}
                                        <span className="font-medium text-foreground">
                                            {period.processor.name}
                                        </span>
                                        {period.processed_at && ` on ${formatDate(period.processed_at)}`}
                                    </>
                                )}
                                {period.processor && period.approver && " · "}
                                {period.approver && (
                                    <>
                                        Approved by{" "}
                                        <span className="font-medium text-foreground">
                                            {period.approver.name}
                                        </span>
                                    </>
                                )}
                            </p>
                        )}
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

            {/* A raise made after the run does not reach payslips already
                generated — they are a snapshot. Saying so beats letting
                someone be paid last month's salary. */}
            {period?.salaries_changed_since_run && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/[0.07] px-3 py-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <div className="text-xs">
                        <p className="font-medium text-amber-700 dark:text-amber-400">
                            A salary has changed since this payroll was run
                        </p>
                        <p className="text-muted-foreground">
                            These payslips still show the amounts from the last run. Run payroll
                            again to apply the change.
                        </p>
                    </div>
                </div>
            )}

            {/* Payslips Table */}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                    {payslips.length > 0 && (
                        <>
                            <Button
                                size="sm"
                                variant={allVerified ? "outline" : "default"}
                                className="h-8 text-xs"
                                onClick={() =>
                                    // Start at the first unverified payslip: resuming a
                                    // half-finished review at employee 1 means paging past
                                    // everyone already checked.
                                    openReview(
                                        Math.max(
                                            0,
                                            payslips.findIndex((p) => !isReleased(p)),
                                        ),
                                    )
                                }
                            >
                                <Eye className="mr-1.5 h-3.5 w-3.5" />
                                {allVerified ? "Review payslips" : "Review & send"}
                            </Button>
                            <span
                                className={cn(
                                    "text-[0.7rem] font-medium",
                                    allVerified
                                        ? "text-emerald-600 dark:text-emerald-400"
                                        : "text-muted-foreground",
                                )}
                            >
                                {verifiedCount} of {payslips.length} verified
                                {!allVerified && " — all must be verified before approval"}
                            </span>
                        </>
                    )}
                </div>

            </div>

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
                            <table className="w-full border-collapse text-left">
                                {/* Two header rows: the group band says which side of
                                    the payslip a column belongs to, so the arithmetic
                                    reads left to right — earnings, then what comes off
                                    them, then what is left. */}
                                <thead>
                                    <tr className="border-b border-border/40">
                                        <th className="px-4 pt-2.5 pb-1" />
                                        <th
                                            colSpan={4}
                                            className="border-l border-border/40 bg-emerald-500/[0.05] px-4 pt-2 pb-1 text-center text-[0.55rem] font-semibold uppercase tracking-[0.08em] text-emerald-700 dark:text-emerald-400"
                                        >
                                            Earnings
                                        </th>
                                        <th
                                            colSpan={2}
                                            className="border-l border-border/40 bg-red-500/[0.04] px-4 pt-2 pb-1 text-center text-[0.55rem] font-semibold uppercase tracking-[0.08em] text-red-700 dark:text-red-400"
                                        >
                                            Deductions
                                        </th>
                                        <th className="border-l border-border/40 px-4 pt-2 pb-1 text-center text-[0.55rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                                            Net
                                        </th>
                                        <th colSpan={2} className="border-l border-border/40 px-4 pt-2.5 pb-1" />
                                    </tr>
                                    <tr className="border-b border-border/50">
                                        {[
                                            { label: 'Employee', align: 'left' as const },
                                            { label: 'Base', align: 'right' as const, group: true },
                                            { label: 'Allowances', align: 'right' as const },
                                            { label: 'Bonus', align: 'right' as const },
                                            { label: 'Gross', align: 'right' as const },
                                            { label: 'Tax', align: 'right' as const, group: true },
                                            { label: 'Other', align: 'right' as const },
                                            { label: 'Net Pay', align: 'right' as const, group: true },
                                            { label: 'Verification', align: 'left' as const, group: true },
                                            { label: '', align: 'right' as const },
                                        ].map((h, i) => (
                                            <th
                                                key={h.label || i}
                                                className={cn(
                                                    'whitespace-nowrap px-4 py-2 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground',
                                                    h.align === 'right' ? 'text-right' : 'text-left',
                                                    h.group && 'border-l border-border/40',
                                                )}
                                            >
                                                {h.label}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>

                                <tbody>
                                    {payslips.map((payslip, rowIndex) => {
                                        const base = Number(payslip.basic_total ?? 0);
                                        const allowances = Number(payslip.total_allowances ?? 0);
                                        const bonus = Number(payslip.bonus_total ?? 0);
                                        const gross = Number(payslip.gross_salary ?? 0);
                                        const tax = Number(payslip.tax_total ?? 0);
                                        const deductions = Number(payslip.total_deductions ?? 0);
                                        // Everything withheld that is not tax — loans,
                                        // leave, anything else. Derived rather than
                                        // stored, so it can never disagree with the
                                        // total it is part of.
                                        const other = Math.max(0, deductions - tax);
                                        const net = Number(payslip.net_salary ?? 0);

                                        return (
                                            <tr
                                                key={payslip.id}
                                                // The row opens the editor; the buttons in the
                                                // last cell stop propagation so Review still
                                                // reviews rather than opening an edit dialog.
                                                onClick={() => canRun && !isOwnPayslip(payslip) && setEditing(payslip)}
                                                className={cn(
                                                    'border-b border-border/30 transition-colors last:border-0 hover:bg-muted/40',
                                                    canRun && !isOwnPayslip(payslip) && 'cursor-pointer',
                                                )}
                                            >
                                                <td className="whitespace-nowrap px-4 py-2.5">
                                                    <span className="text-[0.75rem] font-medium text-foreground">
                                                        {payslip.user?.name ?? 'Unknown'}
                                                    </span>
                                                    <p className="text-[0.65rem] text-muted-foreground">
                                                        {payslip.user?.email}
                                                    </p>
                                                </td>

                                                <td className="whitespace-nowrap border-l border-border/40 px-4 py-2.5 text-right text-[0.75rem] tabular-nums">
                                                    {money(base)}
                                                </td>
                                                <td className="whitespace-nowrap px-4 py-2.5 text-right text-[0.75rem] tabular-nums text-emerald-600 dark:text-emerald-400">
                                                    {allowances > 0 ? `+${money(allowances)}` : dash}
                                                </td>
                                                <td className="whitespace-nowrap px-4 py-2.5 text-right text-[0.75rem] tabular-nums text-emerald-600 dark:text-emerald-400">
                                                    {bonus > 0 ? `+${money(bonus)}` : dash}
                                                </td>
                                                <td className="whitespace-nowrap px-4 py-2.5 text-right text-[0.75rem] font-medium tabular-nums">
                                                    {money(gross)}
                                                </td>

                                                <td className="whitespace-nowrap border-l border-border/40 px-4 py-2.5 text-right text-[0.75rem] tabular-nums text-red-600 dark:text-red-400">
                                                    {tax > 0 ? `−${money(tax)}` : dash}
                                                </td>
                                                <td className="whitespace-nowrap px-4 py-2.5 text-right text-[0.75rem] tabular-nums text-red-600 dark:text-red-400">
                                                    {other > 0 ? `−${money(other)}` : dash}
                                                </td>

                                                <td className="whitespace-nowrap border-l border-border/40 px-4 py-2.5 text-right text-[0.8rem] font-semibold tabular-nums">
                                                    {money(net)}
                                                </td>

                                                <td className="whitespace-nowrap border-l border-border/40 px-4 py-2.5">
                                                    {/* Three states, not two. A payslip that was
                                                        verified and then taken back is not the
                                                        same as one nobody has looked at — that
                                                        distinction is the reason the withdrawal is
                                                        now recorded rather than erasing the
                                                        verification. */}
                                                    {isReleased(payslip) ? (
                                                        <span
                                                            className="inline-flex items-center gap-1.5 text-[0.7rem] font-medium text-emerald-600 dark:text-emerald-400"
                                                            title={
                                                                payslip.verifier
                                                                    ? `Sent by ${payslip.verifier.name}${payslip.verified_at ? ` on ${formatDate(payslip.verified_at)}` : ""}`
                                                                    : undefined
                                                            }
                                                        >
                                                            <ShieldCheck className="h-3.5 w-3.5" />
                                                            {/* The NAME, not just the fact. Two people
                                                                can release payslips, so "Sent" alone
                                                                leaves the question of by whom. */}
                                                            {payslip.verifier
                                                                ? `Sent by ${payslip.verifier.name.split(" ")[0]}`
                                                                : "Sent"}
                                                        </span>
                                                    ) : payslip.withdrawn_at ? (
                                                        <span
                                                            className="inline-flex items-center gap-1.5 text-[0.7rem] font-medium text-orange-600 dark:text-orange-400"
                                                            title={`Verified, then withdrawn on ${formatDate(payslip.withdrawn_at)}`}
                                                        >
                                                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-orange-500" />
                                                            Withdrawn
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1.5 text-[0.7rem] text-muted-foreground">
                                                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
                                                            Awaiting review
                                                        </span>
                                                    )}
                                                </td>

                                                <td className="whitespace-nowrap px-4 py-2.5 text-right">
                                                    <div className="inline-flex items-center gap-1.5">
                                                        <Button
                                                            variant={isReleased(payslip) ? 'ghost' : 'outline'}
                                                            size="sm"
                                                            className="h-7 text-[0.7rem]"
                                                            disabled={openingId === payslip.id}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                openReview(rowIndex);
                                                            }}
                                                        >
                                                            {openingId === payslip.id ? (
                                                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                                            ) : (
                                                                <Eye className="mr-1.5 h-3.5 w-3.5" />
                                                            )}
                                                            Review
                                                        </Button>

                                                        {/* Send only — never Withdraw.
                                                            Releasing one payslip after fixing it is
                                                            routine and safe. Taking one BACK is
                                                            neither: it cannot recall a document the
                                                            employee may already have opened, and as
                                                            a live button beside Send one misclick
                                                            un-publishes someone's pay. So the button
                                                            becomes a spent "Sent" rather than
                                                            flipping to Withdraw; the reverse lives
                                                            in the review dialog, where you are
                                                            looking at the payslip itself rather than
                                                            at a name in a row. */}
                                                        {canRun && (
                                                            <Button
                                                                variant={isReleased(payslip) ? 'ghost' : 'default'}
                                                                size="sm"
                                                                className="h-7 text-[0.7rem]"
                                                                // Stays PUT once sent, spent rather
                                                                // than gone. Removing it left half
                                                                // the rows with one button and half
                                                                // with two, so the column jumped
                                                                // about as payslips were released —
                                                                // and a missing control says nothing
                                                                // about why it is missing.
                                                                disabled={isReleased(payslip) || isOwnPayslip(payslip) || sendingId === payslip.id}
                                                                title={
                                                                    isOwnPayslip(payslip)
                                                                        ? 'This is your own payslip — someone else has to check it. Ask the owner to verify it.'
                                                                        : isReleased(payslip)
                                                                        ? 'Already sent to the employee. To take it back, open Review and withdraw it there.'
                                                                        : 'Verify and release this payslip to the employee'
                                                                }
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    sendOne(payslip);
                                                                }}
                                                            >
                                                                {sendingId === payslip.id ? (
                                                                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                                                ) : isReleased(payslip) ? (
                                                                    <Check className="mr-1.5 h-3.5 w-3.5" />
                                                                ) : (
                                                                    <Send className="mr-1.5 h-3.5 w-3.5" />
                                                                )}
                                                                {isReleased(payslip) ? 'Sent' : 'Send'}
                                                            </Button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>

                                {/* What the run actually costs. Summed from the rows on
                                    screen, so it always matches what is being read —
                                    and it is the number someone has to sign off. */}
                                <tfoot>
                                    <tr className="border-t-2 border-border bg-muted/40">
                                        <td className="whitespace-nowrap px-4 py-2.5 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                                            {payslips.length} {payslips.length === 1 ? 'employee' : 'employees'}
                                        </td>
                                        <td className="whitespace-nowrap border-l border-border/40 px-4 py-2.5 text-right text-[0.75rem] font-semibold tabular-nums">
                                            {money(totals.base)}
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-2.5 text-right text-[0.75rem] font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                                            {totals.allowances > 0 ? `+${money(totals.allowances)}` : dash}
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-2.5 text-right text-[0.75rem] font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                                            {totals.bonus > 0 ? `+${money(totals.bonus)}` : dash}
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-2.5 text-right text-[0.75rem] font-semibold tabular-nums">
                                            {money(totals.gross)}
                                        </td>
                                        <td className="whitespace-nowrap border-l border-border/40 px-4 py-2.5 text-right text-[0.75rem] font-semibold tabular-nums text-red-600 dark:text-red-400">
                                            {totals.tax > 0 ? `−${money(totals.tax)}` : dash}
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-2.5 text-right text-[0.75rem] font-semibold tabular-nums text-red-600 dark:text-red-400">
                                            {totals.other > 0 ? `−${money(totals.other)}` : dash}
                                        </td>
                                        <td className="whitespace-nowrap border-l border-border/40 px-4 py-2.5 text-right text-sm font-bold tabular-nums">
                                            {money(totals.net)}
                                        </td>
                                        <td className="border-l border-border/40 px-4 py-2.5 text-[0.68rem] text-muted-foreground">
                                            {verifiedCount} of {payslips.length} verified
                                        </td>
                                        <td className="px-4 py-2.5" />
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Edit one payslip's earnings and deductions. Kept in sync with
                the list: `editing` is re-read from `payslips` so a save shows
                its new totals without reopening. */}
            <PayslipLinesDialog
                payslip={
                    editing ? (payslips.find((p) => p.id === editing.id) ?? editing) : null
                }
                open={Boolean(editing)}
                onOpenChange={(open) => !open && setEditing(null)}
            />

            {/* Walk the whole period, one employee at a time */}
            <Dialog open={Boolean(reviewing)} onOpenChange={(open) => !open && closeReview()}>
                {/* Wide enough for A4 at its own size — the page is 794px at
                    96dpi, and anything narrower makes the viewer shrink it
                    until the figures are hard to check.

                    The `sm:` prefix is load-bearing: DialogContent's own base
                    class is `sm:max-w-sm`, and tailwind-merge only drops a
                    class that conflicts at the SAME breakpoint. A plain
                    `max-w-3xl` leaves `sm:max-w-sm` standing and loses to it
                    on every screen above 640px — which capped this dialog at
                    384px, less than half the width of the document inside it. */}
                <DialogContent className="sm:max-w-5xl">
                    <DialogHeader>
                        <div className="flex items-center justify-between gap-3 pr-6">
                            <div className="min-w-0">
                                <DialogTitle className="truncate text-sm">
                                    {reviewing?.user?.name ?? "Payslip"}
                                </DialogTitle>
                                <DialogDescription className="text-xs">
                                    {reviewing && isReleased(reviewing)
                                        ? "Verified — visible to the employee in My Payslips."
                                        : "Check the figures, then verify to send it to the employee."}
                                </DialogDescription>
                            </div>

                            <div className="flex shrink-0 items-center gap-1">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label="Previous employee"
                                    className="h-7 w-7 p-0"
                                    disabled={reviewIndex === null || reviewIndex === 0}
                                    onClick={() => step(-1)}
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <span className="min-w-[64px] text-center text-[0.68rem] tabular-nums text-muted-foreground">
                                    {(reviewIndex ?? 0) + 1} of {payslips.length}
                                </span>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label="Next employee"
                                    className="h-7 w-7 p-0"
                                    disabled={
                                        reviewIndex === null || reviewIndex >= payslips.length - 1
                                    }
                                    onClick={() => step(1)}
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    </DialogHeader>

                    <div className="relative">
                        {reviewUrl ? (
                            <iframe
                                src={reviewUrl}
                                title="Payslip review"
                                className="h-[74vh] w-full rounded-md border border-border bg-white"
                            />
                        ) : (
                            <Skeleton className="h-[74vh] w-full rounded-md" />
                        )}
                        {reviewLoading && (
                            <div className="absolute inset-0 flex items-center justify-center rounded-md bg-background/60">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                        )}
                    </div>

                    <DialogFooter className="items-center gap-2 sm:justify-between">
                        <div className="flex items-center gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 text-xs"
                                onClick={() =>
                                    reviewing && downloadPayslip.mutate({ id: reviewing.id })
                                }
                            >
                                <Download className="mr-1.5 h-3.5 w-3.5" />
                                Download
                            </Button>
                            <span className="text-[0.65rem] text-muted-foreground">
                                {verifiedCount} of {payslips.length} verified
                            </span>
                        </div>

                        {reviewing && isReleased(reviewing) ? (
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 text-xs"
                                    disabled={unverifyPayslip.isPending}
                                    onClick={() =>
                                        reviewing &&
                                        unverifyPayslip.mutateAsync(reviewing.id).catch(() => {})
                                    }
                                >
                                    {unverifyPayslip.isPending && (
                                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                    )}
                                    Withdraw
                                </Button>
                                {/* The last payslip has no next. Leaving a dead
                                    Next button there ends the walkthrough with a
                                    control that cannot be pressed and an X in the
                                    corner as the only way out. */}
                                <Button
                                    size="sm"
                                    className="h-8 text-xs"
                                    onClick={() => (isLastReviewed ? closeReview() : step(1))}
                                >
                                    {isLastReviewed ? (
                                        <>
                                            <Check className="mr-1.5 h-3.5 w-3.5" />
                                            Done
                                        </>
                                    ) : (
                                        <>
                                            Next
                                            <ChevronRight className="ml-1.5 h-3.5 w-3.5" />
                                        </>
                                    )}
                                </Button>
                            </div>
                        ) : reviewing && isOwnPayslip(reviewing) ? (
                            /* Your OWN payslip, reached mid-walkthrough. The
                               server refuses to let you verify it, so offering
                               "Verify & next" here only produces an error the
                               operator can do nothing about. Skipping is the
                               correct action, and the reason is stated rather
                               than left to be inferred from a failure. */
                            <div className="flex items-center gap-3">
                                <span className="max-w-xs text-right text-[0.65rem] text-muted-foreground">
                                    This is your own payslip. Someone else has to check it —
                                    ask the owner to verify it.
                                </span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 text-xs"
                                    onClick={() => (isLastReviewed ? closeReview() : step(1))}
                                >
                                    {isLastReviewed ? (
                                        <>
                                            <Check className="mr-1.5 h-3.5 w-3.5" />
                                            Done
                                        </>
                                    ) : (
                                        <>
                                            Skip
                                            <ChevronRight className="ml-1.5 h-3.5 w-3.5" />
                                        </>
                                    )}
                                </Button>
                            </div>
                        ) : (
                            <Button
                                size="sm"
                                className="h-8 text-xs"
                                disabled={verifyPayslip.isPending}
                                onClick={verifyAndAdvance}
                            >
                                {verifyPayslip.isPending ? (
                                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                                )}
                                Verify &amp; next
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
