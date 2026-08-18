"use client";

import { format, startOfMonth } from "date-fns";
import {
    BarChart3,
    Clock,
    DollarSign,
    Download,
    FileText,
    Layers,
    ListChecks,
    Loader2,
    Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/EmptyState";
import { PageLoading } from "@/components/page-loading";
import { ProjectTimeFilterBar } from "@/components/reports/ProjectTimeFilterBar";
import { ReportsSectionNav } from "@/components/reports/ReportsSectionNav";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    Pagination,
    PaginationContent,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import {
    buildProjectTimeParams,
    useProjectTimeReport,
    type ProjectTimeFilters,
} from "@/hooks/reports/use-project-time-report";
import api from "@/lib/api";
import { formatDuration } from "@/lib/check-in-time";
import { readBlobError, triggerDownload } from "@/lib/download";
import { useAuthStore } from "@/stores/auth-store";
import { usePermissionStore } from "@/stores/permission-store";

const typeDot: Record<string, { dot: string; text: string }> = {
    Tracked: { dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
    Manual: { dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
};

function defaultFilters(): ProjectTimeFilters {
    const today = new Date();
    return {
        project_ids: [],
        user_ids: [],
        period: "month",
        week_of: format(today, "yyyy-MM-dd"),
        month: format(today, "yyyy-MM"),
        start_date: format(startOfMonth(today), "yyyy-MM-dd"),
        end_date: format(today, "yyyy-MM-dd"),
        group_by_day: false,
        page: 1,
        per_page: 25,
    };
}

const PERIOD_LABEL: Record<
    ProjectTimeFilters["period"],
    (f: ProjectTimeFilters) => string
> = {
    week: (f) => `week-${f.week_of}`,
    month: (f) => f.month,
    custom: (f) => `${f.start_date}_${f.end_date}`,
};

export default function ProjectTimeReportPage() {
    const router = useRouter();
    const { user } = useAuthStore();
    const { hasPermission } = usePermissionStore();
    const canView = hasPermission("reports.view");
    const canExport = hasPermission("reports.export");

    const [filters, setFilters] = useState<ProjectTimeFilters>(defaultFilters);
    const [exporting, setExporting] = useState<"csv" | "pdf" | null>(null);

    // Gate date-seeded rendering until mount to avoid SSR/client hydration mismatch.
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    // Redirect unauthorized roles once auth resolves.
    useEffect(() => {
        if (user && !canView) {
            router.replace("/dashboard");
        }
    }, [user, canView, router]);

    const { data, isLoading, isError } = useProjectTimeReport(
        filters,
        mounted && canView,
    );

    // Role gate: skeleton until auth resolves / redirect fires — no content flash.
    if (!user || !canView || !mounted) {
        return <PageLoading />;
    }

    const patch = (p: Partial<ProjectTimeFilters>) =>
        setFilters((prev) => ({
            ...prev,
            ...p,
            page: "page" in p ? (p.page ?? 1) : 1,
        }));

    const rows = data?.data ?? [];
    const meta = data?.meta;
    const summary = meta?.summary;
    const groupByDay = meta?.group_by_day ?? filters.group_by_day;
    const totalPages = meta?.last_page ?? 1;

    const handleExport = async (fmt: "csv" | "pdf") => {
        setExporting(fmt);
        try {
            // Export the full filtered set — omit pagination params.
            const { page: _p, per_page: _pp, ...rest } = filters;
            void _p;
            void _pp;
            const params = { ...buildProjectTimeParams(rest), format: fmt };
            const res = await api.get("/reports/project-time/export", {
                params,
                responseType: "blob",
            });
            const label = PERIOD_LABEL[filters.period](filters);
            triggerDownload(
                res.data,
                `project-time-${label}.${fmt}`,
                fmt === "pdf" ? "application/pdf" : "text/csv",
            );
            toast.success(`Report exported as ${fmt.toUpperCase()}`);
        } catch (err) {
            toast.error((await readBlobError(err)) ?? "Export failed");
        } finally {
            setExporting(null);
        }
    };

    const summaryTiles = summary
        ? [
              {
                  icon: Clock,
                  color: "blue",
                  label: "Total Hours",
                  value: (summary.total_seconds / 3600).toLocaleString(
                      undefined,
                      {
                          maximumFractionDigits: 1,
                      },
                  ),
              },
              {
                  icon: DollarSign,
                  color: "emerald",
                  label: "Billable Amount",
                  value: `$${summary.billable_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
              },
              {
                  icon: ListChecks,
                  color: "violet",
                  label: "Entries",
                  value: summary.entry_count.toLocaleString(),
              },
              {
                  icon: Users,
                  color: "amber",
                  label: "Resources",
                  value: summary.resource_count.toLocaleString(),
              },
              {
                  icon: Layers,
                  color: "rose",
                  label: "Projects",
                  value: summary.project_count.toLocaleString(),
              },
          ]
        : [];

    const tileIconBg: Record<string, string> = {
        blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
        emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
        amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
        rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
    };

    return (
        <div className="flex flex-col gap-6">
            <ReportsSectionNav />

            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-lg font-semibold tracking-tight">Project Time Report</h1>
                    <p className="text-xs text-muted-foreground">Per-entry breakdown by employee and project. Includes approved tracked and manual time.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={() => handleExport("csv")}
                        disabled={
                            !canExport || exporting !== null || !rows.length
                        }
                    >
                        {exporting === "csv" ? (
                            <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                            <Download className="size-3.5" />
                        )}
                        CSV
                    </Button>
                    <Button
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={() => handleExport("pdf")}
                        disabled={
                            !canExport || exporting !== null || !rows.length
                        }
                    >
                        {exporting === "pdf" ? (
                            <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                            <FileText className="size-3.5" />
                        )}
                        PDF
                    </Button>
                </div>
            </div>

            <ProjectTimeFilterBar filters={filters} onChange={patch} />

            {/* Summary tiles */}
            {isLoading ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-[76px] w-full rounded-lg" />
                    ))}
                </div>
            ) : summary ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    {summaryTiles.map((tile) => (
                        <Card key={tile.label}>
                            <CardContent className="p-3">
                                <div className="flex items-center gap-2.5">
                                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tileIconBg[tile.color]}`}>
                                        <tile.icon className="size-4" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">{tile.label}</p>
                                        <p className="text-base font-bold tabular-nums leading-tight">{tile.value}</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            ) : null}

            {/* Rows */}
            {isError ? (
                <Card>
                    <CardContent className="py-10">
                        <div className="text-center">
                            <BarChart3 className="mx-auto mb-2 size-7 text-destructive/60" />
                            <p className="text-sm font-medium text-muted-foreground">
                                Failed to load report
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                                Please try again.
                            </p>
                        </div>
                    </CardContent>
                </Card>
            ) : isLoading ? (
                <div className="flex flex-col gap-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-10 w-full rounded-lg" />
                    ))}
                </div>
            ) : rows.length === 0 ? (
                <EmptyState
                    icon={BarChart3}
                    title="No time entries found"
                    description="Try a wider period (Month or Custom), approve pending manual entries, or pick specific projects/employees."
                />
            ) : (
                <Card>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="border-b border-border/50">
                                        <th className="px-4 py-2.5 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Resource</th>
                                        <th className="px-4 py-2.5 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Project</th>
                                        <th className="px-4 py-2.5 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Task</th>
                                        <th className="px-4 py-2.5 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Type</th>
                                        <th className="px-4 py-2.5 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Date</th>
                                        <th className="px-4 py-2.5 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Time</th>
                                        {groupByDay ? (
                                            <th className="px-4 py-2.5 text-right text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Entries</th>
                                        ) : null}
                                        <th className="px-4 py-2.5 text-right text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Duration</th>
                                        <th className="px-4 py-2.5 text-right text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Activity</th>
                                        <th className="px-4 py-2.5 text-right text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Billable</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((row) => {
                                        const td = typeDot[row.type] ?? { dot: "bg-muted-foreground/40", text: "text-muted-foreground" };
                                        return (
                                        <tr key={row.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                                            <td className="px-4 py-2.5 text-[0.75rem] font-medium text-foreground whitespace-nowrap">
                                                {row.user_name}
                                            </td>
                                            <td className="px-4 py-2.5 text-[0.75rem] text-foreground whitespace-nowrap">
                                                {row.project_name}
                                            </td>
                                            <td className="max-w-[220px] px-4 py-2.5">
                                                <span
                                                    className="block truncate text-[0.75rem] text-foreground"
                                                    title={row.task_name ?? ""}
                                                >
                                                    {row.task_name || (
                                                        <span className="text-muted-foreground">
                                                            —
                                                        </span>
                                                    )}
                                                </span>
                                            </td>
                                            <td className="px-4 py-2.5">
                                                <span className={`inline-flex items-center gap-1.5 text-[0.7rem] font-medium ${td.text}`}>
                                                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${td.dot}`} />
                                                    {row.type}
                                                </span>
                                            </td>
                                            <td className="px-4 py-2.5 text-[0.75rem] text-foreground whitespace-nowrap">
                                                {format(
                                                    new Date(row.date),
                                                    "MMM d, yyyy",
                                                )}
                                            </td>
                                            <td className="px-4 py-2.5 font-mono text-[0.75rem] tabular-nums text-foreground whitespace-nowrap">
                                                {groupByDay &&
                                                (row.entry_count ?? 1) > 1 ? (
                                                    <span
                                                        className="text-muted-foreground"
                                                        title={
                                                            row.time_span ??
                                                            undefined
                                                        }
                                                    >
                                                        {row.entry_count}{" "}
                                                        entries
                                                    </span>
                                                ) : (
                                                    <>
                                                        {row.start_time}
                                                        {row.end_time &&
                                                        row.end_time !== "—"
                                                            ? ` – ${row.end_time}`
                                                            : ""}
                                                    </>
                                                )}
                                            </td>
                                            {groupByDay ? (
                                                <td className="px-4 py-2.5 text-right text-[0.75rem] tabular-nums text-muted-foreground">
                                                    {row.entry_count ?? 1}
                                                </td>
                                            ) : null}
                                            <td className="px-4 py-2.5 text-right font-mono text-[0.75rem] tabular-nums">
                                                {formatDuration(
                                                    row.duration_seconds,
                                                )}
                                            </td>
                                            <td className="px-4 py-2.5 text-right text-[0.75rem] tabular-nums">
                                                {row.activity_score}%
                                            </td>
                                            <td className="px-4 py-2.5 text-right whitespace-nowrap">
                                                {row.billable ? (
                                                    <span className="text-[0.75rem] font-medium text-foreground">
                                                        $
                                                        {row.billable_amount.toFixed(
                                                            2,
                                                        )}
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1.5 text-[0.7rem] font-medium text-muted-foreground">
                                                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                                                        Non-billable
                                                    </span>
                                                )}
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

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                        Page {meta?.current_page ?? filters.page} of{" "}
                        {totalPages}
                    </span>
                    <Pagination className="mx-0 w-auto justify-end">
                        <PaginationContent>
                            <PaginationItem>
                                <PaginationPrevious
                                    onClick={() =>
                                        patch({
                                            page: Math.max(1, filters.page - 1),
                                        })
                                    }
                                    aria-disabled={filters.page === 1}
                                    className={
                                        filters.page === 1
                                            ? "pointer-events-none opacity-50"
                                            : "cursor-pointer"
                                    }
                                />
                            </PaginationItem>
                            <PaginationItem>
                                <PaginationLink
                                    isActive
                                    className="cursor-default"
                                >
                                    {filters.page}
                                </PaginationLink>
                            </PaginationItem>
                            <PaginationItem>
                                <PaginationNext
                                    onClick={() =>
                                        patch({
                                            page: Math.min(
                                                totalPages,
                                                filters.page + 1,
                                            ),
                                        })
                                    }
                                    aria-disabled={filters.page >= totalPages}
                                    className={
                                        filters.page >= totalPages
                                            ? "pointer-events-none opacity-50"
                                            : "cursor-pointer"
                                    }
                                />
                            </PaginationItem>
                        </PaginationContent>
                    </Pagination>
                </div>
            )}
        </div>
    );
}
