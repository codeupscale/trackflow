'use client';

import { useState, useMemo } from 'react';
import { format, subDays } from 'date-fns';
import {
  Monitor,
  Loader2,
  AlertCircle,
  AppWindow,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Cell } from 'recharts';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { useAuthStore } from '@/stores/auth-store';
import { usePermissionStore } from '@/stores/permission-store';
import {
  useMyAppUsage,
  useTeamAppUsage,
  useTopApps,
  type AppUsageEntry,
  type TeamAppUsageEntry,
  type TopAppEntry,
} from '@/hooks/reports/use-app-usage';

// ─── Helpers ──────────────────────────────────────────────────────

function formatAppDuration(seconds: number | string | null | undefined): string {
  const s = Math.round(Number(seconds) || 0);
  if (s <= 0) return '0s';
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
  if (isProductive === true) return 'hsl(var(--chart-2))';
  if (isProductive === false) return 'hsl(var(--destructive))';
  return 'hsl(var(--muted-foreground))';
}

function getPercentOfTotal(seconds: number | string | null | undefined, totalSeconds: number): string {
  const s = Number(seconds) || 0;
  if (!totalSeconds || isNaN(totalSeconds) || totalSeconds === 0) return '0%';
  const pct = Math.round((s / totalSeconds) * 100);
  return `${isNaN(pct) ? 0 : pct}%`;
}

// ─── Chart Config ─────────────────────────────────────────────────

const chartConfig = {
  duration: { label: 'Duration', color: 'hsl(var(--chart-1))' },
} satisfies ChartConfig;

// ─── Sub-Components ───────────────────────────────────────────────

function ProductivityBadge({ isProductive }: { isProductive: boolean | null }) {
  if (isProductive === true) {
    return <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50">Productive</Badge>;
  }
  if (isProductive === false) {
    return <Badge variant="destructive">Unproductive</Badge>;
  }
  return <Badge variant="secondary">Uncategorized</Badge>;
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
      <CardContent className="pt-6">
        <div className="flex items-center gap-3 text-destructive">
          <AlertCircle className="size-5" />
          <p>{message}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
          <AppWindow className="size-10" />
          <p className="font-medium">{title}</p>
          <p className="text-sm">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function AppUsageTable({ entries, totalSeconds }: { entries: AppUsageEntry[]; totalSeconds: number }) {
  if (entries.length === 0) {
    return <EmptyState title="No app usage data" description="No application usage was recorded for this period." />;
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>App Name</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>% of Total</TableHead>
              <TableHead>Productive</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry, idx) => (
              <TableRow key={`${entry.app_name}-${idx}`}>
                <TableCell className="font-medium">{entry.app_name}</TableCell>
                <TableCell>{formatAppDuration(entry.duration_seconds)}</TableCell>
                <TableCell>{getPercentOfTotal(entry.duration_seconds, totalSeconds)}</TableCell>
                <TableCell><ProductivityBadge isProductive={entry.is_productive} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function TeamUsageTable({ entries }: { entries: TeamAppUsageEntry[] }) {
  if (entries.length === 0) {
    return <EmptyState title="No team usage data" description="No team application usage was recorded for this period." />;
  }

  const totalSeconds = entries.reduce((sum, e) => sum + (Number(e.duration_seconds) || 0), 0);

  return (
    <Card>
      <CardContent className="pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Team Member</TableHead>
              <TableHead>App Name</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>% of Total</TableHead>
              <TableHead>Productive</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry, idx) => (
              <TableRow key={`${entry.user_id}-${entry.app_name}-${idx}`}>
                <TableCell className="font-medium">{entry.user_name}</TableCell>
                <TableCell>{entry.app_name}</TableCell>
                <TableCell>{formatAppDuration(entry.duration_seconds)}</TableCell>
                <TableCell>{getPercentOfTotal(entry.duration_seconds, totalSeconds)}</TableCell>
                <TableCell><ProductivityBadge isProductive={entry.is_productive} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function TopAppsChart({ entries }: { entries: TopAppEntry[] }) {
  if (entries.length === 0) {
    return <EmptyState title="No top apps data" description="No application usage was recorded for this period." />;
  }

  const chartData = entries.map((entry) => ({
    app_name: entry.app_name,
    duration_seconds: entry.duration_seconds,
    is_productive: entry.is_productive,
    fill: productivityColor(entry.is_productive),
  }));

  const totalSeconds = entries.reduce((sum, e) => sum + (Number(e.duration_seconds) || 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Top Applications</CardTitle>
          <CardDescription>Most used applications by total duration</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="min-h-[300px] w-full">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ left: 120, right: 20, top: 10, bottom: 10 }}
            >
              <XAxis
                type="number"
                tickFormatter={(value: number) => formatTickDuration(value)}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="app_name"
                width={110}
                tickLine={false}
                axisLine={false}
                className="text-xs"
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) => formatAppDuration(Number(value))}
                  />
                }
              />
              <Bar dataKey="duration_seconds" radius={[0, 4, 4, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
          <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="size-3 rounded-sm" style={{ backgroundColor: 'hsl(var(--chart-2))' }} />
              <span>Productive</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="size-3 rounded-sm" style={{ backgroundColor: 'hsl(var(--destructive))' }} />
              <span>Unproductive</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="size-3 rounded-sm" style={{ backgroundColor: 'hsl(var(--muted-foreground))' }} />
              <span>Uncategorized</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>App Name</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>% of Total</TableHead>
                <TableHead>Productive</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry, idx) => (
                <TableRow key={`${entry.app_name}-${idx}`}>
                  <TableCell className="font-medium">{entry.app_name}</TableCell>
                  <TableCell>{formatAppDuration(entry.duration_seconds)}</TableCell>
                  <TableCell>{getPercentOfTotal(entry.duration_seconds, totalSeconds)}</TableCell>
                  <TableCell><ProductivityBadge isProductive={entry.is_productive} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────

export default function AppUsagePage() {
  const { user } = useAuthStore();
  const { hasPermission, hasPermissionWithScope } = usePermissionStore();

  const today = format(new Date(), 'yyyy-MM-dd');
  const sevenDaysAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd');

  const [myDate, setMyDate] = useState(today);
  const [startDate, setStartDate] = useState(sevenDaysAgo);
  const [endDate, setEndDate] = useState(today);

  const isManagerOrAdmin =
    hasPermissionWithScope('reports.view', 'team') ||
    hasPermission('reports.view_all');

  const myUsage = useMyAppUsage(myDate);
  const teamUsage = useTeamAppUsage(startDate, endDate);
  const topApps = useTopApps(startDate, endDate);

  const myTotalSeconds = useMemo(
    () => (myUsage.data?.data ?? []).reduce((sum, e) => sum + (Number(e.duration_seconds) || 0), 0),
    [myUsage.data]
  );

  const defaultTab = 'my-usage';

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Monitor className="size-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">App Usage</h1>
        </div>
        <p className="text-muted-foreground">
          Track application usage across your team
        </p>
      </div>

      {/* Date Range Controls */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Start Date</Label>
              <DatePicker
                value={startDate}
                onChange={setStartDate}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>End Date</Label>
              <DatePicker
                value={endDate}
                onChange={setEndDate}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue={defaultTab}>
        <TabsList className="bg-muted/50">
          <TabsTrigger value="my-usage">My Usage</TabsTrigger>
          {isManagerOrAdmin && <TabsTrigger value="team">Team</TabsTrigger>}
          {isManagerOrAdmin && <TabsTrigger value="top-apps">Top Apps</TabsTrigger>}
        </TabsList>

        {/* My Usage Tab */}
        <TabsContent value="my-usage" className="mt-6">
          <div className="flex flex-col gap-4">
            <div className="flex items-end gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Date</Label>
                <DatePicker
                  value={myDate}
                  onChange={setMyDate}
                />
              </div>
            </div>

            {myUsage.isLoading && <AppUsageTableSkeleton />}
            {myUsage.isError && <ErrorCard message="Failed to load your app usage data." />}
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
          <TabsContent value="team" className="mt-6">
            <div className="flex flex-col gap-4">
              {teamUsage.isLoading && <AppUsageTableSkeleton />}
              {teamUsage.isError && <ErrorCard message="Failed to load team app usage data." />}
              {teamUsage.data && (
                <TeamUsageTable entries={teamUsage.data.data} />
              )}
            </div>
          </TabsContent>
        )}

        {/* Top Apps Tab */}
        {isManagerOrAdmin && (
          <TabsContent value="top-apps" className="mt-6">
            <div className="flex flex-col gap-4">
              {topApps.isLoading && <AppUsageTableSkeleton />}
              {topApps.isError && <ErrorCard message="Failed to load top apps data." />}
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
