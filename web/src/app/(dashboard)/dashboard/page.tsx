'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays, subWeeks, subMonths, isToday, isSameDay, addDays } from 'date-fns';
import {
  Clock,
  Users,
  FolderOpen,
  Monitor,
  TrendingUp,
  TrendingDown,
  Timer,
  ArrowRight,
  BarChart3,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
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
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import Link from 'next/link';
import api from '@/lib/api';
import { formatDuration } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { DateFilter } from '@/components/date-filter';

// ─── Types ────────────────────────────────────────────────────────

interface DashboardStats {
  total_online: number;
  today_hours: number;
  active_projects: number;
  total_members: number;
}

interface TeamMember {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  is_online: boolean;
  today_seconds: number;
  current_project: string | null;
  activity_score: number;
}

interface DailyBreakdown {
  date: string;
  day: string; // Mon, Tue, etc.
  seconds: number;
  hours: number;
}

interface DashboardData {
  stats: DashboardStats;
  team: TeamMember[];
  // Employee-specific fields
  isEmployeeView: boolean;
  timer: { elapsed_seconds: number } | null;
  weekSeconds: number;
  weeklyHoursTarget: number; // 0 = disabled
  dailyBreakdown: DailyBreakdown[];
  activityPercentage: number | null; // null = no activity_logs data yet
}

type FilterPreset = 'today' | 'yesterday' | 'week' | 'last-week' | 'this-month' | 'last-month' | 'custom';

// ─── Chart configs ───────────────────────────────────────────────

const adminChartConfig = {
  hours: {
    label: "Hours Tracked",
    color: "hsl(var(--chart-1))",
  },
  activity: {
    label: "Activity %",
    color: "hsl(var(--chart-2))",
  },
} satisfies ChartConfig;

const employeeChartConfig = {
  hours: {
    label: "Hours",
    color: "hsl(var(--chart-1))",
  },
} satisfies ChartConfig;

// ─── Date range helpers ───────────────────────────────────────────

function getTodayRange(): { dateFrom: string; dateTo: string } {
  const d = new Date();
  const s = format(d, 'yyyy-MM-dd');
  return { dateFrom: s, dateTo: s };
}

function getYesterdayRange(): { dateFrom: string; dateTo: string } {
  const d = subDays(new Date(), 1);
  const s = format(d, 'yyyy-MM-dd');
  return { dateFrom: s, dateTo: s };
}

function getWeekRange(): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const start = startOfWeek(now, { weekStartsOn: 1 });
  const end = endOfWeek(now, { weekStartsOn: 1 });
  const endUse = end > now ? now : end;
  return {
    dateFrom: format(start, 'yyyy-MM-dd'),
    dateTo: format(endUse, 'yyyy-MM-dd'),
  };
}

function getLastWeekRange(): { dateFrom: string; dateTo: string } {
  const lastWeek = subWeeks(new Date(), 1);
  return {
    dateFrom: format(startOfWeek(lastWeek, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
    dateTo: format(endOfWeek(lastWeek, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
  };
}

function getThisMonthRange(): { dateFrom: string; dateTo: string } {
  const now = new Date();
  return {
    dateFrom: format(startOfMonth(now), 'yyyy-MM-dd'),
    dateTo: format(now, 'yyyy-MM-dd'),
  };
}

function getLastMonthRange(): { dateFrom: string; dateTo: string } {
  const lastMonth = subMonths(new Date(), 1);
  return {
    dateFrom: format(startOfMonth(lastMonth), 'yyyy-MM-dd'),
    dateTo: format(endOfMonth(lastMonth), 'yyyy-MM-dd'),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

function formatHoursMinutes(totalHours: number): string {
  const h = Math.floor(totalHours);
  const m = Math.round((totalHours % 1) * 60);
  return `${h}h ${m}m`;
}

function formatSecondsToHM(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

// ─── Main Dashboard ───────────────────────────────────────────────

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const isEmployee = user?.role === 'employee';

  const [filterPreset, setFilterPreset] = useState<FilterPreset>('today');
  const [dateFrom, setDateFrom] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [chartPeriod, setChartPeriod] = useState<string>('7d');

  const rangeLabel = useMemo(() => {
    if (filterPreset === 'today') {
      const d = new Date(dateFrom + 'T00:00:00');
      return isToday(d) ? 'Today' : format(d, 'EEE, MMM d, yyyy');
    }
    if (filterPreset === 'yesterday') return 'Yesterday';
    if (filterPreset === 'last-week') return 'Last Week';
    if (filterPreset === 'this-month') {
      const d = new Date(dateFrom + 'T00:00:00');
      return format(d, 'MMMM yyyy');
    }
    if (filterPreset === 'last-month') {
      const d = new Date(dateFrom + 'T00:00:00');
      return format(d, 'MMMM yyyy');
    }
    return `${format(new Date(dateFrom + 'T00:00:00'), 'MMM d')} – ${format(new Date(dateTo + 'T00:00:00'), 'MMM d, yyyy')}`;
  }, [filterPreset, dateFrom, dateTo]);

  const applyPreset = (preset: FilterPreset) => {
    setFilterPreset(preset);
    const ranges: Record<string, () => { dateFrom: string; dateTo: string }> = {
      today: getTodayRange,
      yesterday: getYesterdayRange,
      week: getWeekRange,
      'last-week': getLastWeekRange,
      'this-month': getThisMonthRange,
      'last-month': getLastMonthRange,
    };
    const range = ranges[preset]?.();
    if (range) {
      setDateFrom(range.dateFrom);
      setDateTo(range.dateTo);
    }
  };

  const applyCustom = (from: string, to: string) => {
    setFilterPreset('custom');
    setDateFrom(from);
    setDateTo(to);
  };

  // ── Fetch dashboard data (handles both admin and employee responses) ──

  const { data, isLoading, error } = useQuery<DashboardData>({
    queryKey: ['dashboard', dateFrom, dateTo],
    queryFn: async () => {
      const res = await api.get('/dashboard', {
        params: { date_from: dateFrom, date_to: dateTo },
      });
      const raw = res.data;

      // Detect employee response (has today_seconds at root, no team_summary)
      if ('today_seconds' in raw && !('team_summary' in raw)) {
        const seconds = raw.today_seconds || 0;
        return {
          isEmployeeView: true,
          stats: {
            total_online: raw.timer ? 1 : 0,
            today_hours: seconds / 3600,
            active_projects: 0,
            total_members: 1,
          },
          team: [],
          timer: raw.timer,
          weekSeconds: raw.week_seconds || 0,
          weeklyHoursTarget: raw.weekly_hours_target || 0,
          dailyBreakdown: raw.daily_breakdown || [],
          activityPercentage: raw.activity_percentage ?? null,
        };
      }

      // Admin/manager/owner response
      const onlineUserIds = new Set(
        (raw.online_users || []).map((u: { user: { id: string } }) => u.user.id)
      );
      const teamSummary = raw.team_summary || [];

      const team: TeamMember[] = teamSummary.map(
        (entry: {
          user: { id: string; name: string; email: string; avatar_url: string | null };
          today_seconds: number;
          activity_score: number;
        }) => ({
          id: entry.user.id,
          name: entry.user.name,
          email: entry.user.email,
          avatar_url: entry.user.avatar_url,
          is_online: onlineUserIds.has(entry.user.id),
          today_seconds: entry.today_seconds || 0,
          current_project: null,
          activity_score: entry.activity_score || 0,
        })
      );

      const totalSeconds = team.reduce((sum: number, m: TeamMember) => sum + m.today_seconds, 0);

      return {
        isEmployeeView: false,
        stats: {
          total_online: onlineUserIds.size,
          today_hours: totalSeconds / 3600,
          active_projects: typeof raw.active_projects === 'number' ? raw.active_projects : 0,
          total_members: team.length,
        },
        team,
        timer: null,
        weekSeconds: 0,
        weeklyHoursTarget: 0,
        dailyBreakdown: [],
        activityPercentage: null,
      };
    },
    refetchInterval: 30000,
  });

  const stats = data?.stats;
  const team = data?.team || [];
  const isEmployeeView = data?.isEmployeeView ?? isEmployee;

  // ── Timesheet (both roles see their own entries) ──

  const { data: timesheetData, isLoading: timesheetLoading } = useQuery({
    queryKey: ['time-entries-dashboard', dateFrom, dateTo],
    queryFn: async () => {
      const res = await api.get('/time-entries', {
        params: {
          date_from: dateFrom,
          date_to: dateTo,
          per_page: 50,
        },
      });
      const d = res.data;
      return d?.data ?? (Array.isArray(d) ? d : []);
    },
  });
  const timeEntries = (timesheetData ?? []) as Array<{
    id: string;
    started_at: string;
    ended_at: string | null;
    duration_seconds: number;
    project?: { name: string; color?: string };
    task?: { title: string };
  }>;

  // ── Live tick for running entries (so duration counts up in real time) ──
  const [, setTick] = useState(0);
  const hasRunningEntry = timeEntries.some((e) => !e.ended_at);
  useEffect(() => {
    if (!hasRunningEntry) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [hasRunningEntry]);

  /** Display duration: for running entries, compute elapsed from started_at */
  function getDisplayDuration(entry: { started_at: string; ended_at: string | null; duration_seconds: number }): number {
    if (entry.ended_at) return entry.duration_seconds;
    // Running entry — compute elapsed from started_at
    return Math.max(0, Math.floor((new Date().getTime() - new Date(entry.started_at).getTime()) / 1000));
  }

  // ── Build chart data ──

  const adminChartData = useMemo(() => {
    if (isEmployeeView || team.length === 0) return [];
    const now = new Date();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const todayStr = format(now, 'yyyy-MM-dd');
    const totalHours = team.reduce((sum, m) => sum + m.today_seconds / 3600, 0);
    const avgActivity = team.length > 0
      ? Math.round(team.reduce((s, m) => s + m.activity_score, 0) / team.length)
      : 0;

    return Array.from({ length: 7 }, (_, i) => {
      const day = addDays(weekStart, i);
      const dayStr = format(day, 'yyyy-MM-dd');
      const isCurrentDay = dayStr === todayStr;
      return {
        day: format(day, 'EEE'),
        hours: isCurrentDay ? Math.round(totalHours * 10) / 10 : 0,
        activity: isCurrentDay ? avgActivity : 0,
      };
    });
  }, [isEmployeeView, team]);

  const employeeChartData = useMemo(() => {
    if (!isEmployeeView || !data?.dailyBreakdown?.length) return [];
    return data.dailyBreakdown.map((entry) => ({
      day: entry.day,
      hours: Math.round(entry.hours * 10) / 10,
    }));
  }, [isEmployeeView, data?.dailyBreakdown]);

  // ── Employee activity score — real value from activity_logs via API ──
  const employeeActivityScore = data?.activityPercentage ?? null;

  const maxEntries = isEmployeeView ? 5 : 10;

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Failed to load dashboard data. Please try again.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page header + date filter */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isEmployeeView
              ? filterPreset === 'today' && isSameDay(new Date(dateFrom + 'T00:00:00'), new Date())
                ? 'Your activity overview for today'
                : `Your activity for ${rangeLabel}`
              : filterPreset === 'today' && isSameDay(new Date(dateFrom + 'T00:00:00'), new Date())
              ? "Overview of your team's activity today"
              : `Overview for ${rangeLabel}`}
          </p>
        </div>

        <DateFilter
          filterPreset={filterPreset}
          dateFrom={dateFrom}
          dateTo={dateTo}
          rangeLabel={rangeLabel}
          onPreset={applyPreset}
          onCustomApply={applyCustom}
        />
      </div>

      {/* Stat Cards — dashboard-01 style */}
      {isEmployeeView ? (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
          {/* Today's Hours */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription>
                {filterPreset === 'today' && isSameDay(new Date(dateFrom + 'T00:00:00'), new Date())
                  ? "Today's Hours"
                  : 'Hours'}
              </CardDescription>
              <Badge variant="outline" className="flex items-center gap-1 text-xs">
                <TrendingUp className="h-3 w-3" />
                +12%
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tabular-nums">
                {isLoading ? (
                  <span className="inline-block h-9 w-20 bg-muted rounded animate-pulse" />
                ) : (
                  stats?.today_hours != null ? formatHoursMinutes(stats.today_hours) : '0h 0m'
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">vs. yesterday</p>
            </CardContent>
          </Card>

          {/* This Week */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription>This Week</CardDescription>
              {(data?.weeklyHoursTarget ?? 0) > 0 && (
                <Badge variant="outline" className="text-xs">
                  {data!.weeklyHoursTarget}h target
                </Badge>
              )}
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tabular-nums">
                {isLoading ? (
                  <span className="inline-block h-9 w-20 bg-muted rounded animate-pulse" />
                ) : (
                  formatSecondsToHM(data?.weekSeconds || 0)
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {(data?.weeklyHoursTarget ?? 0) > 0
                  ? `${Math.round(((data?.weekSeconds || 0) / ((data?.weeklyHoursTarget || 1) * 3600)) * 100)}% of weekly target`
                  : 'Mon - Sun'}
              </p>
            </CardContent>
          </Card>

          {/* Activity Score / Status */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription>Status</CardDescription>
              <Badge
                variant="outline"
                className={`flex items-center gap-1 text-xs ${
                  data?.timer
                    ? 'border-green-500/30 text-green-600 dark:text-green-400'
                    : ''
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    data?.timer ? 'bg-green-500' : 'bg-muted-foreground'
                  }`}
                />
                {data?.timer ? 'Tracking' : 'Idle'}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tabular-nums">
                {isLoading ? (
                  <span className="inline-block h-9 w-16 bg-muted rounded animate-pulse" />
                ) : employeeActivityScore !== null ? (
                  `${employeeActivityScore}%`
                ) : (
                  'N/A'
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {employeeActivityScore !== null
                  ? employeeActivityScore >= 75
                    ? 'Great productivity'
                    : employeeActivityScore >= 50
                    ? 'Good progress'
                    : 'Keep going'
                  : 'No activity data'}
              </p>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {/* Total Hours Today */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription>
                {filterPreset === 'today' && isSameDay(new Date(dateFrom + 'T00:00:00'), new Date())
                  ? 'Total Hours Today'
                  : 'Total Hours'}
              </CardDescription>
              <Badge variant="outline" className="flex items-center gap-1 text-xs">
                <TrendingUp className="h-3 w-3" />
                +12%
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tabular-nums">
                {isLoading ? (
                  <span className="inline-block h-9 w-20 bg-muted rounded animate-pulse" />
                ) : (
                  stats?.today_hours != null ? formatHoursMinutes(stats.today_hours) : '0h 0m'
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">vs. yesterday</p>
            </CardContent>
          </Card>

          {/* Team Online */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription>Team Online</CardDescription>
              <Badge variant="outline" className="flex items-center gap-1 text-xs">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                {isLoading ? '...' : `${stats?.total_online ?? 0} active now`}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tabular-nums">
                {isLoading ? (
                  <span className="inline-block h-9 w-12 bg-muted rounded animate-pulse" />
                ) : (
                  stats?.total_online ?? 0
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">members currently active</p>
            </CardContent>
          </Card>

          {/* Active Projects */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription>Active Projects</CardDescription>
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tabular-nums">
                {isLoading ? (
                  <span className="inline-block h-9 w-12 bg-muted rounded animate-pulse" />
                ) : (
                  stats?.active_projects ?? 0
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">across your organization</p>
            </CardContent>
          </Card>

          {/* Team Members */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription>Team Members</CardDescription>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tabular-nums">
                {isLoading ? (
                  <span className="inline-block h-9 w-12 bg-muted rounded animate-pulse" />
                ) : (
                  stats?.total_members ?? 0
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">in your workspace</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Area Chart — Admin: Team Activity / Employee: Your Hours */}
      {!isEmployeeView && team.length > 0 && (
        <Card>
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Team Activity This Week</CardTitle>
              <CardDescription>Hours tracked and activity scores across your team</CardDescription>
            </div>
            <ToggleGroup
              value={[chartPeriod]}
              onValueChange={(val) => {
                if (val.length > 0) setChartPeriod(val[0]);
              }}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="90d">Last 3 months</ToggleGroupItem>
              <ToggleGroupItem value="30d">Last 30 days</ToggleGroupItem>
              <ToggleGroupItem value="7d">Last 7 days</ToggleGroupItem>
            </ToggleGroup>
          </CardHeader>
          <CardContent>
            <ChartContainer config={adminChartConfig} className="aspect-auto h-[300px] w-full">
              <AreaChart data={adminChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="fillHours" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-hours)" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="var(--color-hours)" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="fillActivity" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-activity)" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="var(--color-activity)" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  width={40}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  dataKey="hours"
                  type="natural"
                  fill="url(#fillHours)"
                  stroke="var(--color-hours)"
                  strokeWidth={2}
                />
                <Area
                  dataKey="activity"
                  type="natural"
                  fill="url(#fillActivity)"
                  stroke="var(--color-activity)"
                  strokeWidth={2}
                />
                <ChartLegend content={<ChartLegendContent />} />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}

      {isEmployeeView && employeeChartData.length > 0 && (
        <Card>
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Your Hours This Week</CardTitle>
              <CardDescription>Daily hours tracked (Mon - Sun)</CardDescription>
            </div>
            <ToggleGroup
              value={[chartPeriod]}
              onValueChange={(val) => {
                if (val.length > 0) setChartPeriod(val[0]);
              }}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="90d">Last 3 months</ToggleGroupItem>
              <ToggleGroupItem value="30d">Last 30 days</ToggleGroupItem>
              <ToggleGroupItem value="7d">Last 7 days</ToggleGroupItem>
            </ToggleGroup>
          </CardHeader>
          <CardContent>
            <ChartContainer config={employeeChartConfig} className="aspect-auto h-[300px] w-full">
              <AreaChart data={employeeChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="fillEmployeeHours" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-hours)" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="var(--color-hours)" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  width={40}
                  tickFormatter={(v: number) => `${v}h`}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                {(data?.weeklyHoursTarget ?? 0) > 0 && (
                  <ReferenceLine
                    y={(data!.weeklyHoursTarget) / 5}
                    stroke="hsl(var(--chart-4))"
                    strokeDasharray="4 4"
                    label={{ value: 'Daily target', position: 'right', fontSize: 11 }}
                  />
                )}
                <Area
                  dataKey="hours"
                  type="natural"
                  fill="url(#fillEmployeeHours)"
                  stroke="var(--color-hours)"
                  strokeWidth={2}
                />
                <ChartLegend content={<ChartLegendContent />} />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}

      {/* Weekly Hours Target — employee view only, shown for current-week filters */}
      {isEmployeeView && (filterPreset === 'today' || filterPreset === 'week') && (data?.weeklyHoursTarget ?? 0) > 0 && (() => {
        const target = data!.weeklyHoursTarget;
        const targetSec = target * 3600;
        const ws = data?.weekSeconds || 0;
        const pct = Math.min(ws / targetSec, 1);
        const completed = ws >= targetSec;
        const remainSec = Math.max(0, targetSec - ws);
        const remainH = Math.floor(remainSec / 3600);
        const remainM = Math.round((remainSec % 3600) / 60);
        const workedH = Math.floor(ws / 3600);
        const workedM = Math.round((ws % 3600) / 60);

        return (
          <Card className={`overflow-hidden ${completed ? 'ring-2 ring-green-500/30' : ''}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div className="flex items-center gap-2">
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${completed ? 'bg-green-500/10' : 'bg-blue-500/10'}`}>
                  {completed ? (
                    <svg className="h-5 w-5 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  ) : (
                    <TrendingUp className="h-5 w-5 text-blue-500" />
                  )}
                </div>
                <div>
                  <CardTitle className="text-sm">Weekly Target</CardTitle>
                  <CardDescription>{target}h required (Mon - Sun)</CardDescription>
                </div>
              </div>
              {completed ? (
                <Badge className="bg-green-500/10 text-green-500 border-green-500/20 gap-1 px-3 py-1">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                  Goal Achieved
                </Badge>
              ) : (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {remainH}h {remainM}m remaining
                </span>
              )}
            </CardHeader>
            <CardContent>
              {/* Progress bar */}
              <div className="relative h-3 rounded-full bg-muted overflow-hidden">
                <div
                  className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out ${
                    completed
                      ? 'bg-gradient-to-r from-green-500 to-emerald-400'
                      : pct >= 0.75
                      ? 'bg-gradient-to-r from-blue-500 to-cyan-400'
                      : 'bg-gradient-to-r from-purple-500 to-blue-500'
                  }`}
                  style={{ width: `${Math.round(pct * 100)}%` }}
                />
              </div>

              <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground tabular-nums">
                <span>{workedH}h {workedM}m worked</span>
                <span className="font-medium">{Math.round(pct * 100)}%</span>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Team activity table — only for admin/manager/owner */}
      {!isEmployeeView && (
        <Card>
          <CardHeader>
            <CardTitle>Team Activity</CardTitle>
            <CardDescription>
              Real-time activity status of your team members
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex flex-col gap-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-12 bg-muted rounded animate-pulse" />
                ))}
              </div>
            ) : team.length === 0 ? (
              <div className="text-center py-12">
                <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground font-medium">No team members yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Invite your team to start tracking time together
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground">Member</TableHead>
                    <TableHead className="text-muted-foreground">Status</TableHead>
                    <TableHead className="text-muted-foreground">
                      {filterPreset === 'today' && isSameDay(new Date(dateFrom + 'T00:00:00'), new Date())
                        ? "Today's Hours"
                        : 'Hours'}
                    </TableHead>
                    <TableHead className="text-muted-foreground">Activity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {team.map((member) => {
                    const initials = member.name
                      .split(' ')
                      .map((n) => n[0])
                      .join('')
                      .toUpperCase()
                      .slice(0, 2);

                    return (
                      <TableRow key={member.id} className="border-border">
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="relative">
                              <Avatar className="h-8 w-8 border border-border">
                                <AvatarImage
                                  src={member.avatar_url || undefined}
                                  alt={member.name}
                                />
                                <AvatarFallback className="bg-muted text-foreground text-xs">
                                  {initials}
                                </AvatarFallback>
                              </Avatar>
                              <span
                                className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-background ${
                                  member.is_online ? 'bg-green-500' : 'bg-muted-foreground'
                                }`}
                              />
                            </div>
                            <div>
                              <p className="text-sm font-medium text-foreground">{member.name}</p>
                              <p className="text-xs text-muted-foreground">{member.email}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="gap-1.5">
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                member.is_online ? 'bg-green-500' : 'bg-muted-foreground'
                              }`}
                            />
                            {member.is_online ? 'Online' : 'Offline'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm font-mono text-foreground tabular-nums">
                            {formatDuration(member.today_seconds)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="flex-1 h-2 bg-muted rounded-full max-w-[120px]">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  member.activity_score >= 70
                                    ? 'bg-green-500'
                                    : member.activity_score >= 40
                                    ? 'bg-amber-500'
                                    : 'bg-red-500'
                                }`}
                                style={{ width: `${Math.min(member.activity_score, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground w-8 text-right tabular-nums">
                              {member.activity_score}%
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Timesheet (both roles see their own entries) */}
      <Card>
        <CardHeader>
          <CardTitle>Timesheet</CardTitle>
          <CardDescription>
            Your time entries for {rangeLabel.toLowerCase()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {timesheetLoading ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 bg-muted rounded animate-pulse" />
              ))}
            </div>
          ) : timeEntries.length === 0 ? (
            <div className="text-center py-12">
              <Clock className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">No time entries in this range</p>
              <p className="text-sm text-muted-foreground mt-1">
                Start the timer or log time on the Time page
              </p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground">Date / Time</TableHead>
                    <TableHead className="text-muted-foreground">Project</TableHead>
                    <TableHead className="text-muted-foreground">Task</TableHead>
                    <TableHead className="text-muted-foreground text-right">Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {timeEntries.slice(0, maxEntries).map((entry) => (
                    <TableRow key={entry.id} className="border-border">
                      <TableCell className="text-foreground font-mono text-sm">
                        {format(new Date(entry.started_at), 'MMM d, yyyy HH:mm')}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-foreground">
                          {entry.project?.name ?? '\u2014'}
                        </span>
                      </TableCell>
                      <TableCell>
                        {entry.task?.title ? (
                          <span className="text-sm text-muted-foreground">{entry.task.title}</span>
                        ) : (
                          <span className="text-muted-foreground text-xs">No task</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm tabular-nums">
                        {entry.ended_at ? (
                          <span className="text-foreground">{formatDuration(entry.duration_seconds)}</span>
                        ) : (
                          <span className="text-green-400">{formatDuration(getDisplayDuration(entry))} ●</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {timeEntries.length > maxEntries && (
                <div className="mt-4 pt-4 border-t border-border text-center">
                  <Link
                    href={`/time?from=${dateFrom}&to=${dateTo}`}
                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
                  >
                    View all {timeEntries.length} entries
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
