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
import { PageHeader } from "@/components/common/PageHeader";
import { PageLoading } from "@/components/page-loading";
import { ProjectTimeFilterBar } from "@/components/reports/ProjectTimeFilterBar";
import { ReportsSectionNav } from "@/components/reports/ReportsSectionNav";
import { Badge } from "@/components/ui/badge";
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
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    buildProjectTimeParams,
    useProjectTimeReport,
    type ProjectTimeFilters,
} from "@/hooks/reports/use-project-time-report";
import api from "@/lib/api";
import { readBlobError, triggerDownload } from "@/lib/download";
import { formatDuration } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { usePermissionStore } from "@/stores/permission-store";

function defaultFilters(): ProjectTimeFilters {
    const today = new Date();
    return {
        project_ids: [],
        user_id: null,
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
                  label: "Billable Amount",
                  value: `$${summary.billable_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
              },
              {
                  icon: ListChecks,
                  label: "Entries",
                  value: summary.entry_count.toLocaleString(),
              },
              {
                  icon: Users,
                  label: "Resources",
                  value: summary.resource_count.toLocaleString(),
              },
              {
                  icon: Layers,
                  label: "Projects",
                  value: summary.project_count.toLocaleString(),
              },
          ]
        : [];

    return (
        <div className="flex flex-col gap-6">
            <ReportsSectionNav />

            <PageHeader
                title="Project Time Report"
                description="Per-entry breakdown by employee and project. Includes approved tracked and manual time."
                action={
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleExport("csv")}
                            disabled={
                                !canExport || exporting !== null || !rows.length
                            }
                        >
                            {exporting === "csv" ? (
                                <Loader2
                                    className="animate-spin"
                                    data-icon="inline-start"
                                />
                            ) : (
                                <Download data-icon="inline-start" />
                            )}
                            CSV
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleExport("pdf")}
                            disabled={
                                !canExport || exporting !== null || !rows.length
                            }
                        >
                            {exporting === "pdf" ? (
                                <Loader2
                                    className="animate-spin"
                                    data-icon="inline-start"
                                />
                            ) : (
                                <FileText data-icon="inline-start" />
                            )}
                            PDF
                        </Button>
                    </div>
                }
            />

            <ProjectTimeFilterBar filters={filters} onChange={patch} />

            {/* Summary tiles */}
            {isLoading ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-24 w-full rounded-lg" />
                    ))}
                </div>
            ) : summary ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                    {summaryTiles.map((tile) => (
                        <Card key={tile.label}>
                            <CardContent className="flex flex-col gap-1 pt-6">
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <tile.icon className="size-4" />
                                    <span className="text-xs font-semibold uppercase tracking-wider">
                                        {tile.label}
                                    </span>
                                </div>
                                <span className="text-2xl font-bold text-foreground">
                                    {tile.value}
                                </span>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            ) : null}

            {/* Rows */}
            {isError ? (
                <Card>
                    <CardContent className="py-12">
                        <div className="text-center">
                            <BarChart3 className="mx-auto mb-2 size-8 text-destructive/60" />
                            <p className="font-medium text-muted-foreground">
                                Failed to load report
                            </p>
                            <p className="mt-1 text-sm text-muted-foreground">
                                Please try again.
                            </p>
                        </div>
                    </CardContent>
                </Card>
            ) : isLoading ? (
                <div className="flex flex-col gap-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-12 w-full rounded-lg" />
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
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Resource</TableHead>
                                        <TableHead>Project</TableHead>
                                        <TableHead>Task</TableHead>
                                        <TableHead>Type</TableHead>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Time</TableHead>
                                        {groupByDay ? (
                                            <TableHead className="text-right">
                                                Entries
                                            </TableHead>
                                        ) : null}
                                        <TableHead className="text-right">
                                            Duration
                                        </TableHead>
                                        <TableHead className="text-right">
                                            Activity
                                        </TableHead>
                                        <TableHead className="text-right">
                                            Billable
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {rows.map((row) => (
                                        <TableRow key={row.id}>
                                            <TableCell className="text-sm font-medium text-foreground">
                                                {row.user_name}
                                            </TableCell>
                                            <TableCell className="text-sm">
                                                {row.project_name}
                                            </TableCell>
                                            <TableCell className="max-w-[220px]">
                                                <span
                                                    className="block truncate text-sm text-foreground"
                                                    title={row.task_name ?? ""}
                                                >
                                                    {row.task_name || (
                                                        <span className="text-muted-foreground">
                                                            —
                                                        </span>
                                                    )}
                                                </span>
                                            </TableCell>
                                            <TableCell>
                                                <Badge
                                                    variant={
                                                        row.type === "Manual"
                                                            ? "outline"
                                                            : "secondary"
                                                    }
                                                >
                                                    {row.type}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-sm text-foreground">
                                                {format(
                                                    new Date(row.date),
                                                    "MMM d, yyyy",
                                                )}
                                            </TableCell>
                                            <TableCell className="font-mono text-sm tabular-nums text-foreground">
                                                {groupByDay ? (
                                                    <span
                                                        title={`${row.start_time} – ${row.end_time}`}
                                                    >
                                                        {row.start_time}
                                                        {row.end_time &&
                                                        row.end_time !== "—"
                                                            ? ` – ${row.end_time}`
                                                            : ""}
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
                                            </TableCell>
                                            {groupByDay ? (
                                                <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                                                    {row.entry_count ?? 1}
                                                </TableCell>
                                            ) : null}
                                            <TableCell className="text-right font-mono text-sm tabular-nums">
                                                {formatDuration(
                                                    row.duration_seconds,
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right text-sm tabular-nums">
                                                {row.activity_score}%
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {row.billable ? (
                                                    <span className="text-sm font-medium text-foreground">
                                                        $
                                                        {row.billable_amount.toFixed(
                                                            2,
                                                        )}
                                                    </span>
                                                ) : (
                                                    <Badge variant="secondary">
                                                        Non-billable
                                                    </Badge>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
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
