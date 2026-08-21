"use client";

import { format, subDays } from "date-fns";
import {
    AlertCircle,
    AppWindow,
    Download,
    FileText,
    Loader2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Bar, BarChart, Cell, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

import { ReportsSectionNav } from "@/components/reports/ReportsSectionNav";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
} from "@/components/ui/chart";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    useMyAppUsage,
    useTeamAppUsage,
    useTopApps,
    type AppUsageEntry,
    type TeamAppUsageEntry,
    type TopAppEntry,
} from "@/hooks/reports/use-app-usage";
import api from "@/lib/api";
import { readBlobError, triggerDownload } from "@/lib/download";
import { useAuthStore } from "@/stores/auth-store";
import { usePermissionStore } from "@/stores/permission-store";

type AppUsageView = "my-usage" | "team" | "top-apps";

// ─── Helpers ──────────────────────────────────────────────────────

function formatAppDuration(
    seconds: number | string | null | undefined,
): string {
    const s = Math.round(Number(seconds) || 0);
    if (s <= 0) return "0s";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    if (m > 0 && sec > 0) return `${m}m ${sec}s`;
    if (m > 0) return `${m}m`;
    return `${sec}s`;
}

function formatTickDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
}

function productivityColor(isProductive: boolean | null): string {
    if (isProductive === true) return "hsl(var(--chart-2))";
    if (isProductive === false) return "hsl(var(--destructive))";
    return "hsl(var(--muted-foreground))";
}

function getPercentOfTotal(
    seconds: number | string | null | undefined,
    totalSeconds: number,
): string {
    const s = Number(seconds) || 0;
    if (!totalSeconds || isNaN(totalSeconds) || totalSeconds === 0) return "0%";
    const pct = Math.round((s / totalSeconds) * 100);
    return `${isNaN(pct) ? 0 : pct}%`;
}

// ─── Chart Config ─────────────────────────────────────────────────

const chartConfig = {
    duration: { label: "Duration", color: "hsl(var(--chart-1))" },
} satisfies ChartConfig;

// ─── Sub-Components ───────────────────────────────────────────────

function ProductivityBadge({ isProductive }: { isProductive: boolean | null }) {
    if (isProductive === true) {
        return (
            <span className="inline-flex items-center gap-1.5 text-[0.7rem] font-medium text-green-600 dark:text-green-400">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />
                Productive
            </span>
        );
    }
    if (isProductive === false) {
        return (
            <span className="inline-flex items-center gap-1.5 text-[0.7rem] font-medium text-red-600 dark:text-red-400">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
                Unproductive
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1.5 text-[0.7rem] font-medium text-muted-foreground">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
            Uncategorized
        </span>
    );
}

function AppUsageTableSkeleton() {
    return (
        <div className="flex flex-col gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
            ))}
        </div>
    );
}

function ErrorCard({ message }: { message: string }) {
    return (
        <Card className="border-destructive/50">
            <CardContent className="p-3">
                <div className="flex items-center gap-2 text-destructive">
                    <AlertCircle className="size-4" />
                    <p className="text-[0.75rem]">{message}</p>
                </div>
            </CardContent>
        </Card>
    );
}

function EmptyState({
    title,
    description,
}: {
    title: string;
    description: string;
}) {
    return (
        <Card>
            <CardContent className="p-3">
                <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-muted-foreground">
                    <AppWindow className="size-8" />
                    <p className="text-[0.75rem] font-medium">{title}</p>
                    <p className="text-[0.65rem]">{description}</p>
                </div>
            </CardContent>
        </Card>
    );
}

function AppUsageTable({
    entries,
    totalSeconds,
}: {
    entries: AppUsageEntry[];
    totalSeconds: number;
}) {
    if (entries.length === 0) {
        return (
            <EmptyState
                title="No app usage data"
                description="No application usage was recorded for this period."
            />
        );
    }

    return (
        <Card>
            <CardContent className="p-0">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-border">
                                <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">App Name</th>
                                <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">Duration</th>
                                <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">% of Total</th>
                                <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">Productive</th>
                            </tr>
                        </thead>
                        <tbody>
                            {entries.map((entry, idx) => (
                                <tr key={`${entry.app_name}-${idx}`} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                                    <td className="px-4 py-2.5 text-[0.75rem] font-medium text-foreground">
                                        {entry.app_name}
                                    </td>
                                    <td className="px-4 py-2.5 text-[0.75rem] text-foreground tabular-nums">
                                        {formatAppDuration(entry.duration_seconds)}
                                    </td>
                                    <td className="px-4 py-2.5 text-[0.75rem] text-foreground tabular-nums">
                                        {totalSeconds > 0
                                            ? getPercentOfTotal(
                                                  entry.duration_seconds,
                                                  totalSeconds,
                                              )
                                            : "—"}
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <ProductivityBadge
                                            isProductive={entry.is_productive}
                                        />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </CardContent>
        </Card>
    );
}

function TeamUsageTable({ entries }: { entries: TeamAppUsageEntry[] }) {
    if (entries.length === 0) {
        return (
            <EmptyState
                title="No team usage data"
                description="No team application usage was recorded for this period."
            />
        );
    }

    // Compute per-user totals so % of Total is meaningful per person
    const userTotals = useMemo(() => {
        const map: Record<string, number> = {};
        for (const e of entries) {
            map[e.user_id] =
                (map[e.user_id] || 0) + (Number(e.duration_seconds) || 0);
        }
        return map;
    }, [entries]);

    const hasAnyDuration = Object.values(userTotals).some((t) => t > 0);

    return (
        <Card>
            <CardContent className="p-0">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-border">
                                <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">Team Member</th>
                                <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">App Name</th>
                                <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">Duration</th>
                                <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">% of Total</th>
                                <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">Productive</th>
                            </tr>
                        </thead>
                        <tbody>
                            {entries.map((entry, idx) => (
                                <tr
                                    key={`${entry.user_id}-${entry.app_name}-${idx}`}
                                    className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors"
                                >
                                    <td className="px-4 py-2.5 text-[0.75rem] font-medium text-foreground">
                                        {entry.user_name}
                                    </td>
                                    <td className="px-4 py-2.5 text-[0.75rem] text-foreground">{entry.app_name}</td>
                                    <td className="px-4 py-2.5 text-[0.75rem] text-foreground tabular-nums">
                                        {formatAppDuration(entry.duration_seconds)}
                                    </td>
                                    <td className="px-4 py-2.5 text-[0.75rem] text-foreground tabular-nums">
                                        {hasAnyDuration &&
                                        userTotals[entry.user_id] > 0
                                            ? getPercentOfTotal(
                                                  entry.duration_seconds,
                                                  userTotals[entry.user_id],
                                              )
                                            : "—"}
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <ProductivityBadge
                                            isProductive={entry.is_productive}
                                        />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </CardContent>
        </Card>
    );
}

function TopAppsChart({ entries }: { entries: TopAppEntry[] }) {
    if (entries.length === 0) {
        return (
            <EmptyState
                title="No top apps data"
                description="No application usage was recorded for this period."
            />
        );
    }

    const totalSeconds = entries.reduce(
        (sum, e) => sum + (Number(e.duration_seconds) || 0),
        0,
    );

    // Only show chart when there is actual duration data
    const hasChartData = totalSeconds > 0;

    const chartData = entries
        .filter((e) => (Number(e.duration_seconds) || 0) > 0)
        .map((entry) => ({
            app_name: entry.app_name,
            duration: Number(entry.duration_seconds),
            fill: productivityColor(entry.is_productive),
        }));

    // Dynamic height: 44px per bar, min 300px
    const chartHeight = Math.max(300, chartData.length * 44);

    return (
        <div className="flex flex-col gap-3">
            <Card>
                <div className="px-4 pt-3 pb-1">
                    <h3 className="text-sm font-semibold">Top Applications</h3>
                    <p className="text-[0.65rem] text-muted-foreground">
                        Most used applications by total duration
                    </p>
                </div>
                <CardContent>
                    {hasChartData ? (
                        <>
                            <ChartContainer
                                config={chartConfig}
                                style={{ height: chartHeight }}
                                className="w-full"
                            >
                                <BarChart
                                    data={chartData}
                                    layout="vertical"
                                    margin={{
                                        left: 8,
                                        right: 24,
                                        top: 8,
                                        bottom: 8,
                                    }}
                                >
                                    <XAxis
                                        type="number"
                                        tickFormatter={(value: number) =>
                                            formatTickDuration(value)
                                        }
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fontSize: 12 }}
                                    />
                                    <YAxis
                                        type="category"
                                        dataKey="app_name"
                                        width={120}
                                        tickLine={false}
                                        axisLine={false}
                                        tick={{ fontSize: 12 }}
                                    />
                                    <ChartTooltip
                                        content={
                                            <ChartTooltipContent
                                                nameKey="app_name"
                                                labelKey="app_name"
                                                formatter={(value) => [
                                                    formatAppDuration(
                                                        Number(value),
                                                    ),
                                                    "Duration",
                                                ]}
                                            />
                                        }
                                    />
                                    <Bar
                                        dataKey="duration"
                                        radius={[0, 4, 4, 0]}
                                        minPointSize={2}
                                    >
                                        {chartData.map((entry, index) => (
                                            <Cell
                                                key={`cell-${index}`}
                                                fill={entry.fill}
                                            />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ChartContainer>
                            <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
                                <div className="flex items-center gap-1.5">
                                    <div
                                        className="size-3 rounded-sm"
                                        style={{
                                            backgroundColor:
                                                "hsl(var(--chart-2))",
                                        }}
                                    />
                                    <span>Productive</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <div
                                        className="size-3 rounded-sm"
                                        style={{
                                            backgroundColor:
                                                "hsl(var(--destructive))",
                                        }}
                                    />
                                    <span>Unproductive</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <div
                                        className="size-3 rounded-sm"
                                        style={{
                                            backgroundColor:
                                                "hsl(var(--muted-foreground))",
                                        }}
                                    />
                                    <span>Uncategorized</span>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-muted-foreground">
                            <AppWindow className="size-8" />
                            <p className="text-[0.75rem] font-medium">
                                No usage data for this period
                            </p>
                            <p className="text-[0.65rem]">
                                Application usage will appear here once the
                                desktop agent records activity.
                            </p>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-border">
                                    <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">App Name</th>
                                    <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">Duration</th>
                                    <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">% of Total</th>
                                    <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">Productive</th>
                                </tr>
                            </thead>
                            <tbody>
                                {entries.map((entry, idx) => (
                                    <tr key={`${entry.app_name}-${idx}`} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                                        <td className="px-4 py-2.5 text-[0.75rem] font-medium text-foreground">
                                            {entry.app_name}
                                        </td>
                                        <td className="px-4 py-2.5 text-[0.75rem] text-foreground tabular-nums">
                                            {formatAppDuration(
                                                entry.duration_seconds,
                                            )}
                                        </td>
                                        <td className="px-4 py-2.5 text-[0.75rem] text-foreground tabular-nums">
                                            {totalSeconds > 0
                                                ? getPercentOfTotal(
                                                      entry.duration_seconds,
                                                      totalSeconds,
                                                  )
                                                : "—"}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <ProductivityBadge
                                                isProductive={entry.is_productive}
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

// ─── Page ─────────────────────────────────────────────────────────

export default function AppUsagePage() {
    const { user } = useAuthStore();
    const { hasPermissionWithScope, hasPermission } = usePermissionStore();

    const today = format(new Date(), "yyyy-MM-dd");
    const sevenDaysAgo = format(subDays(new Date(), 7), "yyyy-MM-dd");

    const [activeView, setActiveView] = useState<AppUsageView>("my-usage");
    const [myDate, setMyDate] = useState(today);
    const [startDate, setStartDate] = useState(sevenDaysAgo);
    const [endDate, setEndDate] = useState(today);
    const [exporting, setExporting] = useState<"csv" | "pdf" | null>(null);

    const isManagerOrAdmin = hasPermissionWithScope("reports.view", "project");
    const isOrgViewer = hasPermissionWithScope("reports.view", "organization");
    const canExport = hasPermission("reports.export");

    const myUsage = useMyAppUsage(myDate);
    const teamUsage = useTeamAppUsage(startDate, endDate);
    const topApps = useTopApps(startDate, endDate);

    const myTotalSeconds = useMemo(
        () =>
            (myUsage.data?.data ?? []).reduce(
                (sum, e) => sum + (Number(e.duration_seconds) || 0),
                0,
            ),
        [myUsage.data],
    );

    const exportView = useMemo(() => {
        if (activeView === "my-usage") return "my" as const;
        if (activeView === "top-apps") return "top" as const;
        return "team" as const;
    }, [activeView]);

    const handleExport = async (fmt: "csv" | "pdf") => {
        setExporting(fmt);
        try {
            const params: Record<string, string> = {
                format: fmt,
                view: exportView,
            };
            if (exportView === "my") {
                params.date = myDate;
                if (user?.id) params.user_id = user.id;
            } else {
                params.start_date = startDate;
                params.end_date = endDate;
            }

            const res = await api.get("/app-usage/export", {
                params,
                responseType: "blob",
            });
            const label =
                exportView === "my"
                    ? `my-${myDate}`
                    : `${exportView}-${startDate}_${endDate}`;
            triggerDownload(
                res.data,
                `app-usage-${label}.${fmt}`,
                fmt === "pdf" ? "application/pdf" : "text/csv",
            );
            toast.success(`Report exported as ${fmt.toUpperCase()}`);
        } catch (err) {
            toast.error((await readBlobError(err)) ?? "Export failed");
        } finally {
            setExporting(null);
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <ReportsSectionNav />

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between -mt-2">
                <p className="text-xs text-muted-foreground">
                    Track application usage across your team.
                </p>
                {canExport && (
                    <div className="flex items-center gap-1.5">
                        <Button
                            variant="outline"
                            className="h-8 text-xs"
                            onClick={() => handleExport("csv")}
                            disabled={exporting !== null}
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
                            className="h-8 text-xs"
                            onClick={() => handleExport("pdf")}
                            disabled={exporting !== null}
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
                )}
            </div>

            {/* Date Range Controls */}
            <Card>
                <CardContent className="p-3">
                    <div className="flex flex-wrap items-end gap-3">
                        <div className="flex flex-col gap-1">
                            <Label className="text-xs">Start Date</Label>
                            <DatePicker
                                value={startDate}
                                onChange={(val) => { setStartDate(val); if (val > endDate) setEndDate(val); }}
                                maxDate={endDate}
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <Label className="text-xs">End Date</Label>
                            <DatePicker value={endDate} onChange={setEndDate} minDate={startDate} />
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Usage views */}
            <Tabs
                value={activeView}
                onValueChange={(value) => {
                    if (
                        value === "my-usage" ||
                        value === "team" ||
                        value === "top-apps"
                    ) {
                        setActiveView(value);
                    }
                }}
            >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Show
                    </span>
                    <TabsList className="bg-muted/50 h-9">
                        <TabsTrigger value="my-usage">My Usage</TabsTrigger>
                        {isManagerOrAdmin && (
                            <TabsTrigger value="team">Team</TabsTrigger>
                        )}
                        {isOrgViewer && (
                            <TabsTrigger value="top-apps">Top Apps</TabsTrigger>
                        )}
                    </TabsList>
                </div>

                {/* My Usage Tab */}
                <TabsContent value="my-usage" className="mt-4">
                    <div className="flex flex-col gap-3">
                        <div className="flex items-end gap-3">
                            <div className="flex flex-col gap-1">
                                <Label className="text-xs">Date</Label>
                                <DatePicker
                                    value={myDate}
                                    onChange={setMyDate}
                                />
                            </div>
                        </div>

                        {myUsage.isLoading && <AppUsageTableSkeleton />}
                        {myUsage.isError && (
                            <ErrorCard message="Failed to load your app usage data." />
                        )}
                        {myUsage.data && (
                            <AppUsageTable
                                entries={myUsage.data.data}
                                totalSeconds={myTotalSeconds}
                            />
                        )}
                    </div>
                </TabsContent>

                {/* Team Tab */}
                {isManagerOrAdmin && (
                    <TabsContent value="team" className="mt-4">
                        <div className="flex flex-col gap-3">
                            {teamUsage.isLoading && <AppUsageTableSkeleton />}
                            {teamUsage.isError && (
                                <ErrorCard message="Failed to load team app usage data." />
                            )}
                            {teamUsage.data && (
                                <TeamUsageTable entries={teamUsage.data.data} />
                            )}
                        </div>
                    </TabsContent>
                )}

                {/* Top Apps Tab */}
                {isManagerOrAdmin && (
                    <TabsContent value="top-apps" className="mt-4">
                        <div className="flex flex-col gap-3">
                            {topApps.isLoading && <AppUsageTableSkeleton />}
                            {topApps.isError && (
                                <ErrorCard message="Failed to load top apps data." />
                            )}
                            {topApps.data && (
                                <TopAppsChart entries={topApps.data.data} />
                            )}
                        </div>
                    </TabsContent>
                )}
            </Tabs>
        </div>
    );
}
