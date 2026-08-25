'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays, subWeeks, subMonths, isToday, isSameDay, addDays } from 'date-fns';
import {
  Clock,
  Users,
  FolderOpen,
  Monitor,
  TrendingUp,
  Timer,
  ArrowRight,
  BarChart3,
  CalendarCheck,
  ClipboardList,
  CalendarDays,
  FileEdit,
  CalendarOff,
  ChevronLeft,
  ChevronRight,
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
  CardHeader,
} from '@/components/ui/card';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Link from 'next/link';
import api from '@/lib/api';
import { formatDuration } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { usePermissionStore } from '@/stores/permission-store';
import { useTimerStore } from '@/stores/timer-store';
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
  weekStart: string;
  weekEnd: string;
}

type FilterPreset = 'today' | 'yesterday' | 'week' | 'last-week' | 'this-month' | 'last-month' | 'custom';

// ─── Chart configs ───────────────────────────────────────────────

const adminChartConfig = {
  activity: {
    label: "Activity %",
    color: "hsl(32 95% 55%)",
  },
  hours: {
    label: "Hours Tracked",
    color: "hsl(217 91% 60%)",
  },
} satisfies ChartConfig;



const ATTENDANCE_STATUS_STYLES: Record<string, { label: string; className: string }> = {
  present: { label: 'Present', className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
  absent: { label: 'Absent', className: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20' },
  half_day: { label: 'Half Day', className: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/20' },
  on_leave: { label: 'On Leave', className: 'bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/20' },
  weekend: { label: 'Weekend', className: 'bg-muted text-muted-foreground border-border' },
  holiday: { label: 'Holiday', className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20' },
};


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

function formatTimeShort(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

// ─── Main Dashboard ───────────────────────────────────────────────

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const { hasPermission } = usePermissionStore();
  const isEmployee = !hasPermission('dashboard.view_team_stats');

  const [filterPreset, setFilterPreset] = useState<FilterPreset>('today');
  const [dateFrom, setDateFrom] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [weekOffset, setWeekOffset] = useState(0);
  const [chartPeriod, setChartPeriod] = useState<string>('7d');
  const [teamPeriod, setTeamPeriod] = useState<string>('7d');
  const [attendanceFilter, setAttendanceFilter] = useState<string>('today');
  const [attCustomFrom, setAttCustomFrom] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [attCustomTo, setAttCustomTo] = useState(() => format(new Date(), 'yyyy-MM-dd'));

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

  const { data, isLoading, isFetching, error } = useQuery<DashboardData>({
    queryKey: ['dashboard', dateFrom, dateTo, weekOffset],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await api.get('/dashboard', {
        params: { date_from: dateFrom, date_to: dateTo, week_offset: weekOffset },
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
          weekStart: raw.week_start || '',
          weekEnd: raw.week_end || '',
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
        weekStart: '',
        weekEnd: '',
      };
    },
    refetchInterval: 30000,
  });

  // Refresh "Today's Hours" + timesheet the instant the timer starts/stops, instead
  // of waiting up to 30s for the next poll. Without this the card lags the live
  // timer chip after a stop (the "card shows 12m while the timer reads 6m" gap).
  const queryClient = useQueryClient();
  const isTimerRunning = useTimerStore((s) => s.isRunning);
  const prevTimerRunningRef = useRef(isTimerRunning);
  useEffect(() => {
    if (prevTimerRunningRef.current === isTimerRunning) return;
    prevTimerRunningRef.current = isTimerRunning;
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['time-entries-dashboard'] });
  }, [isTimerRunning, queryClient]);

  const stats = data?.stats;
  const team = data?.team || [];
  const isEmployeeView = data?.isEmployeeView ?? isEmployee;
  const ownTodayHours = useMemo(() => {
    if (isEmployeeView || !user?.id) return stats?.today_hours ?? 0;
    const me = team.find((m) => m.id === user.id);
    return (me?.today_seconds ?? 0) / 3600;
  }, [isEmployeeView, user?.id, team, stats?.today_hours]);

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
    task?: { name: string };
  }>;

  // ── Attendance overview (admin only) ──

  const attendanceDateRange = useMemo(() => {
    const today = new Date();
    switch (attendanceFilter) {
      case '7d':
        return { start_date: format(subDays(today, 6), 'yyyy-MM-dd'), end_date: format(today, 'yyyy-MM-dd') };
      case '30d':
        return { start_date: format(subDays(today, 29), 'yyyy-MM-dd'), end_date: format(today, 'yyyy-MM-dd') };
      case 'month':
        return { start_date: format(startOfMonth(today), 'yyyy-MM-dd'), end_date: format(today, 'yyyy-MM-dd') };
      case 'custom':
        return { start_date: attCustomFrom, end_date: attCustomTo };
      default:
        return { start_date: format(today, 'yyyy-MM-dd'), end_date: format(today, 'yyyy-MM-dd') };
    }
  }, [attendanceFilter, attCustomFrom, attCustomTo]);

  const { data: attendanceRecords, isLoading: attendanceLoading } = useQuery({
    queryKey: ['dashboard-attendance-list', attendanceDateRange],
    queryFn: async () => {
      try {
        const res = await api.get('/hr/attendance/check-ins', {
          params: { ...attendanceDateRange, per_page: 10 },
        });
        return (res.data?.data ?? []) as Array<{
          id: string;
          date: string;
          status: string;
          check_in_at: string | null;
          check_out_at: string | null;
          check_in_status: string | null;
          is_early_checkout: boolean;
          late_minutes: number;
          user?: { id: string; name: string; email: string; avatar_url: string | null };
        }>;
      } catch {
        return [];
      }
    },
    enabled: !isEmployee,
  });

  // ── On Leave employees (admin only) ──

  const { data: onLeaveData, isLoading: onLeaveLoading } = useQuery({
    queryKey: ['dashboard-on-leave'],
    queryFn: async () => {
      try {
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        const res = await api.get('/hr/leave-requests', {
          params: { status: 'approved', per_page: 50 },
        });
        const requests = (res.data?.data ?? []) as Array<{
          id: string; start_date: string; end_date: string; days_count: number;
          user?: { id: string; name: string; avatar_url: string | null };
          leave_type?: { name: string };
        }>;
        return requests
          .filter((r) => {
            const start = r.start_date?.slice(0, 10) ?? '';
            const end = r.end_date?.slice(0, 10) ?? '';
            return start <= todayStr && end >= todayStr;
          })
          .map((r) => {
            let dateLabel = '';
            if (r.days_count <= 1) {
              try {
                const d = new Date(r.start_date?.slice(0, 10) ?? '');
                if (!isNaN(d.getTime())) dateLabel = format(d, 'MM-dd-yy');
              } catch { /* fallback */ }
              if (!dateLabel) dateLabel = r.start_date?.slice(0, 10) ?? '';
            } else {
              dateLabel = `${Math.ceil(r.days_count)} days`;
            }
            return {
              id: r.id,
              userName: r.user?.name ?? '—',
              avatarUrl: r.user?.avatar_url ?? null,
              leaveType: r.leave_type?.name ?? 'Leave',
              dateLabel,
            };
          });
      } catch {
        return [];
      }
    },
    enabled: !isEmployee,
  });

  // ── Pending approvals counts (admin only) ──

  const { data: pendingCounts } = useQuery({
    queryKey: ['dashboard-pending-counts'],
    queryFn: async () => {
      const counts = { timeEntries: 0, leaveRequests: 0, regularizations: 0 };
      try {
        const [teRes, leaveRes, regRes] = await Promise.allSettled([
          api.get('/time-entries/pending', { params: { per_page: 1 } }),
          api.get('/hr/leave-requests', { params: { status: 'pending', per_page: 1 } }),
          api.get('/hr/attendance/regularizations', { params: { status: 'pending', per_page: 1 } }),
        ]);
        if (teRes.status === 'fulfilled') counts.timeEntries = teRes.value.data?.meta?.total ?? teRes.value.data?.total ?? 0;
        if (leaveRes.status === 'fulfilled') counts.leaveRequests = leaveRes.value.data?.meta?.total ?? leaveRes.value.data?.total ?? 0;
        if (regRes.status === 'fulfilled') counts.regularizations = regRes.value.data?.meta?.total ?? regRes.value.data?.total ?? 0;
      } catch {}
      return counts;
    },
    enabled: !isEmployee,
    refetchInterval: 60000,
  });

  // ── Live tick for running entries (so duration counts up in real time) ──
  // The displayed duration is DERIVED from started_at in getDisplayDuration() on
  // every render — this interval only forces re-renders, it never accumulates a
  // counter. Background tabs throttle/pause setInterval, so on refocus we force an
  // immediate re-render via visibilitychange/focus; because the value is derived,
  // that render snaps straight to the correct time with no visible jump.
  const [, setTick] = useState(0);
  const hasRunningEntry = timeEntries.some((e) => !e.ended_at);
  useEffect(() => {
    if (!hasRunningEntry) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    const onFocusOrVisible = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        setTick((t) => t + 1);
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onFocusOrVisible);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onFocusOrVisible);
    }
    return () => {
      clearInterval(id);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onFocusOrVisible);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onFocusOrVisible);
      }
    };
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

  const totalPendingCount = (pendingCounts?.timeEntries ?? 0) + (pendingCounts?.leaveRequests ?? 0) + (pendingCounts?.regularizations ?? 0);

  const maxEntries = isEmployeeView ? 5 : 10;

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Failed to load dashboard data. Please try again.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Page header + date filter */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
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

      {/* Stat cards */}
      {isEmployeeView ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {/* Today's Hours */}
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-orange-500/10 flex items-center justify-center shrink-0">
                  <Clock className="size-4 text-orange-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">
                    {filterPreset === 'today' && isSameDay(new Date(dateFrom + 'T00:00:00'), new Date())
                      ? "Today's Hours"
                      : 'Hours'}
                  </p>
                  {isLoading ? (
                    <span className="inline-block h-5 w-14 bg-muted rounded animate-pulse mt-0.5" />
                  ) : (
                    <p className="text-base font-bold tabular-nums leading-tight">
                      {stats?.today_hours != null ? formatHoursMinutes(stats.today_hours) : '0h 0m'}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* This Week */}
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                  <BarChart3 className="size-4 text-blue-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">This Week</p>
                  {isLoading ? (
                    <span className="inline-block h-5 w-14 bg-muted rounded animate-pulse mt-0.5" />
                  ) : (
                    <p className="text-base font-bold tabular-nums leading-tight">
                      {formatSecondsToHM(data?.weekSeconds || 0)}
                    </p>
                  )}
                  {(data?.weeklyHoursTarget ?? 0) > 0 && (
                    <p className="text-[0.6rem] text-muted-foreground tabular-nums">
                      {Math.round(((data?.weekSeconds || 0) / ((data?.weeklyHoursTarget || 1) * 3600)) * 100)}% of {data!.weeklyHoursTarget}h target
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Activity / Status */}
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                  <TrendingUp className="size-4 text-emerald-500" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Activity</p>
                    <span className={`h-1.5 w-1.5 rounded-full ${data?.timer ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/40'}`} />
                    <span className={`text-[0.6rem] ${data?.timer ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                      {data?.timer ? 'Tracking' : 'Not tracking'}
                    </span>
                  </div>
                  {isLoading ? (
                    <span className="inline-block h-5 w-10 bg-muted rounded animate-pulse mt-0.5" />
                  ) : (
                    <p className="text-base font-bold tabular-nums leading-tight">
                      {`${employeeActivityScore ?? 0}%`}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* My Hours */}
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-orange-500/10 flex items-center justify-center shrink-0">
                  <Clock className="size-4 text-orange-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">
                    {filterPreset === 'today' && isSameDay(new Date(dateFrom + 'T00:00:00'), new Date())
                      ? 'My Hours Today'
                      : 'My Hours'}
                  </p>
                  {isLoading ? (
                    <span className="inline-block h-5 w-14 bg-muted rounded animate-pulse mt-0.5" />
                  ) : (
                    <p className="text-base font-bold tabular-nums leading-tight">
                      {formatHoursMinutes(ownTodayHours)}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Team Online */}
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                  <Monitor className="size-4 text-emerald-500" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Team Online</p>
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  </div>
                  {isLoading ? (
                    <span className="inline-block h-5 w-8 bg-muted rounded animate-pulse mt-0.5" />
                  ) : (
                    <p className="text-base font-bold tabular-nums leading-tight">
                      {stats?.total_online ?? 0}
                      <span className="text-[0.65rem] font-normal text-muted-foreground ml-1">/ {stats?.total_members ?? 0}</span>
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Active Projects */}
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                  <FolderOpen className="size-4 text-blue-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Projects</p>
                  {isLoading ? (
                    <span className="inline-block h-5 w-8 bg-muted rounded animate-pulse mt-0.5" />
                  ) : (
                    <p className="text-base font-bold tabular-nums leading-tight">{stats?.active_projects ?? 0}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Team Members */}
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                  <Users className="size-4 text-violet-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Members</p>
                  {isLoading ? (
                    <span className="inline-block h-5 w-8 bg-muted rounded animate-pulse mt-0.5" />
                  ) : (
                    <p className="text-base font-bold tabular-nums leading-tight">{stats?.total_members ?? 0}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Chart + Team Activity — side by side on desktop (admin view).
          Gated on the VIEW only: gating the whole section on team.length made
          the "No team members yet" empty state inside it unreachable dead code,
          so an admin with no team silently got nothing at all. */}
      {!isEmployeeView && (
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-5">
          {/* Chart — left column (3/5 width); pointless with no members */}
          {team.length > 0 && (
          <Card className="lg:col-span-3">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                  <BarChart3 className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Team Activity</h3>
                  <p className="text-[0.65rem] text-muted-foreground mt-0.5">Hours tracked and activity scores</p>
                </div>
              </div>
              <ToggleGroup
                value={[chartPeriod]}
                onValueChange={(val) => {
                  if (val.length > 0) setChartPeriod(val[0]);
                }}
                variant="outline"
                size="sm"
                className="bg-muted/50 rounded-lg p-0.5"
              >
                <ToggleGroupItem value="90d" className="text-[0.65rem] rounded-md px-2 data-[state=on]:bg-background data-[state=on]:shadow-sm">3 months</ToggleGroupItem>
                <ToggleGroupItem value="30d" className="text-[0.65rem] rounded-md px-2 data-[state=on]:bg-background data-[state=on]:shadow-sm">30 days</ToggleGroupItem>
                <ToggleGroupItem value="7d" className="text-[0.65rem] rounded-md px-2 data-[state=on]:bg-background data-[state=on]:shadow-sm">7 days</ToggleGroupItem>
              </ToggleGroup>
            </CardHeader>
            <CardContent className="pb-3">
              <ChartContainer config={adminChartConfig} className="aspect-auto h-[220px] w-full">
                <AreaChart data={adminChartData} margin={{ top: 5, right: 5, left: -5, bottom: 0 }}>
                  <defs>
                    <linearGradient id="fillActivity" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-activity)" stopOpacity={0.5} />
                      <stop offset="95%" stopColor="var(--color-activity)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" className="opacity-30" />
                  <XAxis
                    dataKey="day"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    fontSize={11}
                  />
                  <YAxis
                    yAxisId="left"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={4}
                    width={35}
                    fontSize={10}
                    tickFormatter={(v: number) => `${v}%`}
                    domain={[0, 100]}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={4}
                    width={30}
                    fontSize={10}
                    tickFormatter={(v: number) => `${v}h`}
                    domain={[0, (dataMax: number) => Math.max(dataMax, 1)]}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area
                    yAxisId="left"
                    dataKey="activity"
                    type="monotone"
                    fill="url(#fillActivity)"
                    stroke="var(--color-activity)"
                    strokeWidth={2.5}
                  />
                  <Area
                    yAxisId="right"
                    dataKey="hours"
                    type="monotone"
                    fill="none"
                    stroke="var(--color-hours)"
                    strokeWidth={2}
                    dot={{ r: 3.5, fill: "var(--color-hours)", strokeWidth: 2, stroke: "var(--card)" }}
                    activeDot={{ r: 5, strokeWidth: 2 }}
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                </AreaChart>
              </ChartContainer>
            </CardContent>
          </Card>
          )}

          {/* Team Activity — right column (2/5 width) beside the chart, full
              width when the chart is hidden because the team is empty */}
          <Card className={team.length > 0 ? 'lg:col-span-2' : 'lg:col-span-5'}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
                    <Users className="h-4 w-4 text-blue-500" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">Team Activity</h3>
                    <p className="text-[0.65rem] text-muted-foreground mt-0.5">Real-time status</p>
                  </div>
                </div>
                <Badge variant="outline" className="text-[0.65rem]">
                  {team.filter(m => m.is_online).length}/{team.length} online
                </Badge>
              </div>
              <ToggleGroup
                value={[teamPeriod]}
                onValueChange={(val) => {
                  if (val.length > 0) setTeamPeriod(val[0]);
                }}
                variant="outline"
                size="sm"
                className="bg-muted/50 rounded-lg p-0.5"
              >
                <ToggleGroupItem value="90d" className="text-[0.65rem] rounded-md px-2 data-[state=on]:bg-background data-[state=on]:shadow-sm">3 months</ToggleGroupItem>
                <ToggleGroupItem value="30d" className="text-[0.65rem] rounded-md px-2 data-[state=on]:bg-background data-[state=on]:shadow-sm">30 days</ToggleGroupItem>
                <ToggleGroupItem value="7d" className="text-[0.65rem] rounded-md px-2 data-[state=on]:bg-background data-[state=on]:shadow-sm">7 days</ToggleGroupItem>
              </ToggleGroup>
            </CardHeader>
            <CardContent className="px-0 pb-1">
              {isLoading ? (
                <div className="flex flex-col gap-1 px-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-9 bg-muted rounded animate-pulse" />
                  ))}
                </div>
              ) : team.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-muted-foreground text-sm font-medium">No team members yet</p>
                </div>
              ) : (
                <div className="overflow-y-auto max-h-[260px]">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card z-10">
                      <TableRow className="hover:bg-transparent border-b border-border/50">
                        <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground h-7 px-4">Name</TableHead>
                        <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground h-7 px-2">Status</TableHead>
                        <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground h-7 px-2">Hours</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {team.map((member) => (
                        <TableRow key={member.id} className="hover:bg-muted/30 border-b border-border/30">
                          <TableCell className="py-2 px-4">
                            <span className="text-[0.7rem] font-medium text-foreground truncate block max-w-[100px]">
                              {member.name}
                            </span>
                          </TableCell>
                          <TableCell className="py-2 px-2">
                            <div className="flex items-center gap-1.5">
                              <span className={`h-1.5 w-1.5 rounded-full ${
                                member.is_online
                                  ? 'bg-emerald-500'
                                  : 'bg-muted-foreground/40'
                              }`} />
                              <span className={`text-[0.65rem] font-medium ${
                                member.is_online
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-muted-foreground'
                              }`}>
                                {member.is_online ? 'Online' : 'Offline'}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2 px-2">
                            <span className="text-[0.7rem] font-mono font-semibold text-foreground tabular-nums">
                              {formatTimeShort(member.today_seconds)}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Employee chart + weekly target side by side */}
      {isEmployeeView && employeeChartData.length > 0 && (
        <div className={`grid gap-4 grid-cols-1 lg:grid-cols-5 transition-opacity duration-300 ${isFetching ? 'opacity-50' : 'opacity-100'}`}>
          <Card className="lg:col-span-3">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
                  <BarChart3 className="h-4 w-4 text-blue-500" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">
                    {weekOffset === 0 ? 'Your Hours This Week' : 'Weekly Hours'}
                  </h3>
                  <p className="text-[0.65rem] text-muted-foreground mt-0.5">
                    {data?.weekStart && data?.weekEnd
                      ? `${format(new Date(data.weekStart + 'T00:00:00'), 'MMM d')} – ${format(new Date(data.weekEnd + 'T00:00:00'), 'MMM d, yyyy')}`
                      : 'Daily hours tracked (Mon - Sun)'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setWeekOffset(w => w - 1)}
                  className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
                  aria-label="Previous week"
                >
                  <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                </button>
                {weekOffset !== 0 && (
                  <button
                    onClick={() => setWeekOffset(0)}
                    className="text-[0.65rem] font-medium text-blue-500 hover:text-blue-600 px-1.5"
                  >
                    This week
                  </button>
                )}
                <button
                  onClick={() => setWeekOffset(w => w + 1)}
                  disabled={weekOffset >= 0}
                  className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  aria-label="Next week"
                >
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
            </CardHeader>
            <CardContent className="pb-3">
              <ChartContainer config={employeeChartConfig} className="aspect-auto h-[220px] w-full">
                <AreaChart data={employeeChartData} margin={{ top: 5, right: 5, left: -5, bottom: 0 }}>
                  <defs>
                    <linearGradient id="fillEmployeeHours" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-hours)" stopOpacity={0.5} />
                      <stop offset="95%" stopColor="var(--color-hours)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" className="opacity-30" />
                  <XAxis
                    dataKey="day"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    fontSize={11}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickMargin={4}
                    width={30}
                    fontSize={10}
                    tickFormatter={(v: number) => `${v}h`}
                    domain={[0, (dataMax: number) => Math.max(dataMax, 1)]}
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
                    type="monotone"
                    fill="url(#fillEmployeeHours)"
                    stroke="var(--color-hours)"
                    strokeWidth={2.5}
                    dot={{ r: 3.5, fill: "var(--color-hours)", strokeWidth: 2, stroke: "var(--card)" }}
                    activeDot={{ r: 5, strokeWidth: 2 }}
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                </AreaChart>
              </ChartContainer>
            </CardContent>
          </Card>

          {/* Weekly Target — beside the chart */}
          {(() => {
            const target = data?.weeklyHoursTarget ?? 0;
            const hasTarget = target > 0;
            const targetSec = hasTarget ? target * 3600 : 0;
            const ws = data?.weekSeconds || 0;
            const pct = hasTarget ? Math.min(ws / targetSec, 1) : 0;
            const completed = hasTarget && ws >= targetSec;
            const remainSec = hasTarget ? Math.max(0, targetSec - ws) : 0;
            const remainH = Math.floor(remainSec / 3600);
            const remainM = Math.round((remainSec % 3600) / 60);
            const workedH = Math.floor(ws / 3600);
            const workedM = Math.round((ws % 3600) / 60);

            return (
              <Card className={`lg:col-span-2 overflow-hidden ${completed ? 'ring-2 ring-green-500/30' : ''}`}>
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <div className="flex items-center gap-2">
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${completed ? 'bg-green-500/10' : 'bg-blue-500/10'}`}>
                      {completed ? (
                        <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      ) : (
                        <TrendingUp className="h-4 w-4 text-blue-500" />
                      )}
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold">Weekly Progress</h3>
                      <p className="text-[0.65rem] text-muted-foreground">
                        {data?.weekStart && data?.weekEnd
                          ? `${format(new Date(data.weekStart + 'T00:00:00'), 'MMM d')} – ${format(new Date(data.weekEnd + 'T00:00:00'), 'MMM d')}`
                          : hasTarget ? `${target}h target` : (weekOffset === 0 ? 'Hours this week' : 'Hours tracked')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setWeekOffset(w => w - 1)} className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors" aria-label="Previous week">
                      <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                    {weekOffset !== 0 && (
                      <button onClick={() => setWeekOffset(0)} className="text-[0.6rem] font-medium text-blue-500 hover:text-blue-600 px-1">
                        Now
                      </button>
                    )}
                    <button onClick={() => setWeekOffset(w => w + 1)} disabled={weekOffset >= 0} className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors disabled:opacity-30 disabled:pointer-events-none" aria-label="Next week">
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col items-center justify-center py-4">
                    <div className="relative h-28 w-28">
                      <svg className="h-28 w-28 -rotate-90" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="8" className="text-muted-foreground/20" />
                        {hasTarget && (
                          <circle cx="50" cy="50" r="42" fill="none" strokeWidth="8" strokeLinecap="round"
                            className={completed ? 'text-emerald-500' : pct >= 0.75 ? 'text-blue-500' : 'text-violet-500'}
                            stroke="currentColor"
                            strokeDasharray={`${Math.round(pct * 264)} 264`}
                          />
                        )}
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        {hasTarget ? (
                          <span className="text-2xl font-bold tabular-nums">{Math.round(pct * 100)}%</span>
                        ) : (
                          <span className="text-xl font-bold tabular-nums">{workedH}h {workedM}m</span>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 text-center">
                      {hasTarget ? (
                        <>
                          <p className="text-xs font-medium text-foreground tabular-nums">{workedH}h {workedM}m / {target}h</p>
                          {completed ? (
                            <Badge className="mt-1.5 bg-green-500/10 text-green-500 border-green-500/20 gap-1 text-[0.65rem]">
                              Goal Achieved
                            </Badge>
                          ) : (
                            <p className="text-[0.65rem] text-muted-foreground mt-1 tabular-nums">
                              {remainH}h {remainM}m remaining
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-[0.65rem] text-muted-foreground mt-1">
                          {weekOffset === 0 ? 'Total tracked this week' : 'Total tracked'}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })()}
        </div>
      )}

      {/* Attendance Overview + Project Hours + Pending Approvals (admin only) */}
      {!isEmployeeView && (
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
          {/* Attendance Overview — Tabular Listing */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10">
                    <CalendarCheck className="h-4 w-4 text-emerald-500" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">Attendance Overview</h3>
                    <p className="text-[0.65rem] text-muted-foreground mt-0.5">Employee check-in records</p>
                  </div>
                </div>
                <Select value={attendanceFilter} onValueChange={(v) => { if (v) setAttendanceFilter(v); }}>
                  <SelectTrigger className="h-7 w-[120px] text-[0.65rem] rounded-md">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="today" className="text-xs">Today</SelectItem>
                    <SelectItem value="7d" className="text-xs">Last 7 days</SelectItem>
                    <SelectItem value="month" className="text-xs">This month</SelectItem>
                    <SelectItem value="30d" className="text-xs">Last 30 days</SelectItem>
                    <SelectItem value="custom" className="text-xs">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {attendanceFilter === 'custom' && (
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="date"
                    value={attCustomFrom}
                    max={attCustomTo}
                    onChange={(e) => {
                      setAttCustomFrom(e.target.value);
                      if (e.target.value > attCustomTo) setAttCustomTo(e.target.value);
                    }}
                    className="h-7 rounded-md border border-input bg-background px-2 text-[0.65rem] text-foreground"
                  />
                  <span className="text-[0.6rem] text-muted-foreground">to</span>
                  <input
                    type="date"
                    value={attCustomTo}
                    min={attCustomFrom}
                    onChange={(e) => setAttCustomTo(e.target.value)}
                    className="h-7 rounded-md border border-input bg-background px-2 text-[0.65rem] text-foreground"
                  />
                </div>
              )}
            </CardHeader>
            <CardContent className="px-0 pb-1">
              {attendanceLoading ? (
                <div className="flex flex-col gap-1 px-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-9 bg-muted rounded animate-pulse" />
                  ))}
                </div>
              ) : !attendanceRecords || attendanceRecords.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8">
                  <CalendarCheck className="h-8 w-8 text-muted-foreground/40 mb-2" />
                  <p className="text-sm text-muted-foreground font-medium">No attendance data</p>
                  <p className="text-xs text-muted-foreground/70 mt-0.5">Check-in records will appear here</p>
                </div>
              ) : (
                <div className="overflow-y-auto max-h-[260px]">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card z-10">
                      <TableRow className="hover:bg-transparent border-b border-border/50">
                        <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground h-7 px-4">Date</TableHead>
                        <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground h-7 px-2">Employee</TableHead>
                        <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground h-7 px-2">Status</TableHead>
                        <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground h-7 px-2">Check In</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {attendanceRecords.map((record) => {
                        const statusStyle = ATTENDANCE_STATUS_STYLES[record.status] ?? { label: record.status ?? 'Unknown', className: 'bg-muted text-muted-foreground border-border' };
                        let checkInTime = '—';
                        try {
                          if (record.check_in_at) {
                            const d = new Date(record.check_in_at);
                            if (!isNaN(d.getTime())) checkInTime = format(d, 'hh:mm a');
                          }
                        } catch { /* invalid date */ }
                        let dateStr = '—';
                        try {
                          if (record.date) {
                            const d = new Date(record.date);
                            if (!isNaN(d.getTime())) dateStr = format(d, 'MMM dd');
                          }
                        } catch { /* invalid date */ }
                        return (
                          <TableRow key={record.id} className="hover:bg-muted/30 border-b border-border/30">
                            <TableCell className="text-[0.7rem] font-medium tabular-nums py-2 px-4">{dateStr}</TableCell>
                            <TableCell className="py-2 px-2">
                              <span className="text-[0.7rem] font-medium text-foreground truncate block max-w-[100px]">
                                {record.user?.name ?? '—'}
                              </span>
                            </TableCell>
                            <TableCell className="py-2 px-2">
                              <div className="flex flex-wrap gap-0.5">
                                <Badge variant="outline" className={`text-[0.55rem] px-1.5 py-0 h-4 font-medium ${statusStyle.className}`}>
                                  {statusStyle.label}
                                  {record.check_in_status === 'late' && record.status === 'present' && (
                                    <span className="ml-0.5 text-amber-500">*</span>
                                  )}
                                </Badge>
                                {record.is_early_checkout && (
                                  <Badge variant="outline" className="text-[0.55rem] px-1.5 py-0 h-4 font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20">
                                    Early Checkout
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-[0.7rem] font-mono tabular-nums py-2 px-2 text-muted-foreground">{checkInTime}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Approved Leave — Who's on leave today */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10">
                    <CalendarOff className="h-4 w-4 text-violet-500" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">Approved Leave</h3>
                    <p className="text-[0.65rem] text-muted-foreground mt-0.5">Employees on leave today</p>
                  </div>
                </div>
                {(onLeaveData?.length ?? 0) > 0 && (
                  <Badge className="bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/20 hover:bg-violet-500/15 text-[0.65rem]">
                    {onLeaveData!.length} on leave
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="px-0 pb-1">
              {onLeaveLoading ? (
                <div className="flex flex-col gap-1 px-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-9 bg-muted rounded animate-pulse" />
                  ))}
                </div>
              ) : !onLeaveData || onLeaveData.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8">
                  <CalendarCheck className="h-8 w-8 text-emerald-500/40 mb-2" />
                  <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">All Present</p>
                  <p className="text-xs text-muted-foreground/70 mt-0.5">No one is on leave today</p>
                </div>
              ) : (
                <div className="overflow-y-auto max-h-[260px]">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card z-10">
                      <TableRow className="hover:bg-transparent border-b border-border/50">
                        <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground h-7 px-4">Employee</TableHead>
                        <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground h-7 px-2">Status</TableHead>
                        <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground h-7 px-2">Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {onLeaveData.map((item) => (
                        <TableRow key={item.id} className="hover:bg-muted/30 border-b border-border/30">
                          <TableCell className="py-2 px-4">
                            <span className="text-[0.7rem] font-medium text-foreground truncate block max-w-[100px]">
                              {item.userName}
                            </span>
                          </TableCell>
                          <TableCell className="py-2 px-2">
                            <Badge variant="outline" className="text-[0.55rem] px-1.5 py-0 h-4 font-medium bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/20">
                              On Leave
                            </Badge>
                          </TableCell>
                          <TableCell className="text-[0.7rem] text-muted-foreground py-2 px-2">
                            {item.dateLabel}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pending Approvals */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10">
                    <ClipboardList className="h-4 w-4 text-amber-500" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">Pending Approvals</h3>
                    <p className="text-[0.65rem] text-muted-foreground mt-0.5">{totalPendingCount > 0 ? `${totalPendingCount} items need attention` : 'All clear'}</p>
                  </div>
                </div>
                {totalPendingCount > 0 && (
                  <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20 hover:bg-amber-500/15 text-[0.65rem]">
                    {totalPendingCount} pending
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Link href="/time-entries/approvals" className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-muted/50 transition-colors group border border-border/50">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10">
                      <Clock className="h-4 w-4 text-blue-500" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground">Time Entries</p>
                      <p className="text-[0.65rem] text-muted-foreground">Manual time submissions</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-lg font-bold tabular-nums ${(pendingCounts?.timeEntries ?? 0) > 0 ? 'text-amber-500' : 'text-muted-foreground/40'}`}>
                      {pendingCounts?.timeEntries ?? 0}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
                  </div>
                </Link>
                <Link href="/hr/leave/approvals" className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-muted/50 transition-colors group border border-border/50">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/10">
                      <CalendarDays className="h-4 w-4 text-violet-500" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground">Leave Requests</p>
                      <p className="text-[0.65rem] text-muted-foreground">Employee leave applications</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-lg font-bold tabular-nums ${(pendingCounts?.leaveRequests ?? 0) > 0 ? 'text-amber-500' : 'text-muted-foreground/40'}`}>
                      {pendingCounts?.leaveRequests ?? 0}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
                  </div>
                </Link>
                <Link href="/hr/attendance/regularizations" className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-muted/50 transition-colors group border border-border/50">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500/10">
                      <FileEdit className="h-4 w-4 text-cyan-500" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground">Regularizations</p>
                      <p className="text-[0.65rem] text-muted-foreground">Attendance corrections</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-lg font-bold tabular-nums ${(pendingCounts?.regularizations ?? 0) > 0 ? 'text-amber-500' : 'text-muted-foreground/40'}`}>
                      {pendingCounts?.regularizations ?? 0}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
                  </div>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Timesheet (both roles see their own entries) */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/10">
                <Timer className="h-4 w-4 text-orange-500" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Timesheet</h3>
                <p className="text-[0.65rem] text-muted-foreground mt-0.5">
                  Your time entries for {rangeLabel.toLowerCase()}
                </p>
              </div>
            </div>
            {timeEntries.length > maxEntries && (
              <Link
                href={`/time?from=${dateFrom}&to=${dateTo}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-500 dark:text-orange-400 dark:hover:text-orange-300 transition-colors"
              >
                View all ({timeEntries.length})
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        </CardHeader>
        <CardContent className="pb-3">
          {timesheetLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-9 bg-muted rounded animate-pulse" />
              ))}
            </div>
          ) : timeEntries.length === 0 ? (
            <div className="text-center py-8">
              <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-muted-foreground text-sm font-medium">No time entries in this range</p>
              <p className="text-xs text-muted-foreground mt-1">
                Start the timer or log time on the Time page
              </p>
            </div>
          ) : (
            <div className="overflow-y-auto max-h-[400px]">
            <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground py-2">Date / Time</TableHead>
                    <TableHead className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground py-2">Project</TableHead>
                    <TableHead className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground py-2">Task</TableHead>
                    <TableHead className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground py-2 text-right">Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {timeEntries.slice(0, maxEntries).map((entry) => (
                    <TableRow key={entry.id} className="border-border hover:bg-muted/50 transition-colors">
                      <TableCell className="py-2">
                        {(() => {
                          try {
                            const start = new Date(entry.started_at);
                            if (isNaN(start.getTime())) return <span className="text-xs text-muted-foreground">—</span>;
                            const end = entry.ended_at ? new Date(entry.ended_at) : null;
                            return (
                              <div>
                                <span className="text-xs font-medium text-foreground">{format(start, 'MMM d, yyyy')}</span>
                                <div className="text-[0.65rem] text-muted-foreground tabular-nums">
                                  {format(start, 'hh:mm a')}{end ? ` - ${format(end, 'hh:mm a')}` : ''}
                                </div>
                              </div>
                            );
                          } catch { return <span className="text-xs text-muted-foreground">—</span>; }
                        })()}
                      </TableCell>
                      <TableCell className="py-2">
                        <span className="text-xs text-foreground">
                          {entry.project?.name ?? '\u2014'}
                        </span>
                      </TableCell>
                      <TableCell className="py-2">
                        {entry.task?.name ? (
                          <span className="text-xs text-muted-foreground">{entry.task.name}</span>
                        ) : (
                          <span className="text-muted-foreground text-[0.65rem]">No task</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums py-2">
                        {entry.ended_at ? (
                          <span className="text-foreground font-semibold">{formatDuration(entry.duration_seconds)}</span>
                        ) : (
                          <span className="text-emerald-500 font-semibold">{formatDuration(getDisplayDuration(entry))} ●</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
