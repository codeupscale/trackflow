'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, startOfWeek, endOfWeek, isToday, isSameDay } from 'date-fns';
import {
  Clock,
  Users,
  FolderOpen,
  Monitor,
  TrendingUp,
  Timer,
  ArrowRight,
  BarChart3,
} from 'lucide-react';
// Bar chart uses pure CSS — no recharts dependency needed for this component

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
}

type FilterPreset = 'today' | 'week' | 'custom';

// ─── Date range helpers ───────────────────────────────────────────

function getTodayRange(): { dateFrom: string; dateTo: string } {
  const d = new Date();
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

// ─── Main Dashboard ───────────────────────────────────────────────

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const isEmployee = user?.role === 'employee';

  const [filterPreset, setFilterPreset] = useState<FilterPreset>('today');
  const [dateFrom, setDateFrom] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(() => format(new Date(), 'yyyy-MM-dd'));

  const rangeLabel = useMemo(() => {
    if (filterPreset === 'today') {
      const d = new Date(dateFrom + 'T00:00:00');
      return isToday(d) ? 'Today' : format(d, 'EEE, MMM d, yyyy');
    }
    return `${format(new Date(dateFrom + 'T00:00:00'), 'MMM d')} – ${format(new Date(dateTo + 'T00:00:00'), 'MMM d, yyyy')}`;
  }, [filterPreset, dateFrom, dateTo]);

  const applyPreset = (preset: 'today' | 'week') => {
    setFilterPreset(preset);
    if (preset === 'today') {
      const { dateFrom: from, dateTo: to } = getTodayRange();
      setDateFrom(from);
      setDateTo(to);
    } else {
      const { dateFrom: from, dateTo: to } = getWeekRange();
      setDateFrom(from);
      setDateTo(to);
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

  // ── Stat cards (different for employee vs admin) ──

  const statCards = isEmployeeView
    ? [
        {
          label: 'Status',
          value: data?.timer ? 'Tracking' : 'Idle',
          icon: Timer,
          color: data?.timer ? 'text-green-400' : 'text-muted-foreground',
          bg: data?.timer ? 'bg-green-500/10' : 'bg-slate-500/10',
        },
        {
          label:
            filterPreset === 'today' && isSameDay(new Date(dateFrom + 'T00:00:00'), new Date())
              ? "Today's Hours"
              : 'Hours',
          value:
            stats?.today_hours != null
              ? `${Math.floor(stats.today_hours)}h ${Math.round((stats.today_hours % 1) * 60)}m`
              : '0h 0m',
          icon: Clock,
          color: 'text-blue-400',
          bg: 'bg-blue-500/10',
        },
        {
          label: 'This Week',
          value: (() => {
            const ws = data?.weekSeconds || 0;
            const h = Math.floor(ws / 3600);
            const m = Math.round((ws % 3600) / 60);
            return `${h}h ${m}m`;
          })(),
          icon: TrendingUp,
          color: (() => {
            const target = data?.weeklyHoursTarget || 0;
            if (!target) return 'text-purple-400';
            const ws = data?.weekSeconds || 0;
            const pct = ws / (target * 3600);
            if (pct >= 1) return 'text-green-400';
            if (pct >= 0.75) return 'text-blue-400';
            return 'text-purple-400';
          })(),
          bg: (() => {
            const target = data?.weeklyHoursTarget || 0;
            if (!target) return 'bg-purple-500/10';
            const ws = data?.weekSeconds || 0;
            const pct = ws / (target * 3600);
            if (pct >= 1) return 'bg-green-500/10';
            if (pct >= 0.75) return 'bg-blue-500/10';
            return 'bg-purple-500/10';
          })(),
        },
      ]
    : [
        {
          label: 'Total Online',
          value: stats?.total_online ?? 0,
          icon: Users,
          color: 'text-green-400',
          bg: 'bg-green-500/10',
        },
        {
          label:
            filterPreset === 'today' && isSameDay(new Date(dateFrom + 'T00:00:00'), new Date())
              ? "Today's Hours"
              : 'Hours',
          value:
            stats?.today_hours != null
              ? `${Math.floor(stats.today_hours)}h ${Math.round((stats.today_hours % 1) * 60)}m`
              : '0h 0m',
          icon: Clock,
          color: 'text-blue-400',
          bg: 'bg-blue-500/10',
        },
        {
          label: 'Active Projects',
          value: stats?.active_projects ?? 0,
          icon: FolderOpen,
          color: 'text-purple-400',
          bg: 'bg-purple-500/10',
        },
        {
          label: 'Team Members',
          value: stats?.total_members ?? 0,
          icon: Monitor,
          color: 'text-amber-400',
          bg: 'bg-amber-500/10',
        },
      ];

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Failed to load dashboard data. Please try again.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
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

      {/* Stats cards */}
      <div className={`grid gap-4 ${isEmployeeView ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'}`}>
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} className="border-border bg-card">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{stat.label}</p>
                    <p className="text-2xl font-bold text-foreground mt-1 tabular-nums">
                      {isLoading ? (
                        <span className="inline-block h-7 w-16 bg-muted rounded animate-pulse" />
                      ) : (
                        stat.value
                      )}
                    </p>
                  </div>
                  <div className={`h-10 w-10 rounded-lg ${stat.bg} flex items-center justify-center`}>
                    <Icon className={`h-5 w-5 ${stat.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Weekly Hours Target — employee view only */}
      {isEmployeeView && (data?.weeklyHoursTarget ?? 0) > 0 && (() => {
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
          <Card className={`border-border bg-card overflow-hidden ${completed ? 'ring-2 ring-green-500/30' : ''}`}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${completed ? 'bg-green-500/10' : 'bg-blue-500/10'}`}>
                    {completed ? (
                      <svg className="h-5 w-5 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    ) : (
                      <TrendingUp className="h-5 w-5 text-blue-500" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Weekly Target
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {target}h required (Mon – Sun)
                    </p>
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
              </div>

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

      {/* Daily Hours Bar Chart — employee view */}
      {isEmployeeView && (data?.dailyBreakdown?.length ?? 0) > 0 && (() => {
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        const maxHours = Math.max(...(data?.dailyBreakdown || []).map(d => d.hours), 1);
        const dailyTarget = (data?.weeklyHoursTarget || 0) / 5; // avg target per weekday

        return (
          <Card className="border-border bg-card">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <BarChart3 className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-foreground text-base">Daily Hours</CardTitle>
                    <CardDescription className="text-muted-foreground">
                      This week (Mon – Sun)
                    </CardDescription>
                  </div>
                </div>
                {dailyTarget > 0 && (
                  <span className="text-xs text-muted-foreground">
                    ~{dailyTarget.toFixed(1)}h/day target
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-0 pb-4">
              {/* Custom CSS bar chart — works perfectly with both themes */}
              <div className="flex items-end gap-2 h-44 px-1">
                {data!.dailyBreakdown.map((entry) => {
                  const isTodayBar = entry.date === todayStr;
                  const hasHours = entry.hours > 0;
                  const heightPct = maxHours > 0 ? Math.max((entry.hours / maxHours) * 100, hasHours ? 4 : 0) : 0;
                  const isFuture = new Date(entry.date + 'T00:00:00') > new Date();

                  return (
                    <div key={entry.date} className="flex-1 flex flex-col items-center gap-1.5 group">
                      {/* Hours label */}
                      <span className={`text-xs tabular-nums transition-opacity ${
                        hasHours ? 'text-foreground font-medium' : 'text-muted-foreground/50'
                      } ${!hasHours && !isTodayBar ? 'opacity-0 group-hover:opacity-100' : ''}`}>
                        {entry.hours > 0 ? `${entry.hours}h` : '0h'}
                      </span>

                      {/* Bar */}
                      <div className="w-full relative" style={{ height: '120px' }}>
                        <div className="absolute bottom-0 left-1 right-1 rounded-t-md transition-all duration-500 ease-out"
                          style={{ height: `${heightPct}%`, minHeight: hasHours ? '4px' : '2px' }}
                        >
                          <div className={`w-full h-full rounded-t-md ${
                            isTodayBar
                              ? 'bg-primary shadow-sm shadow-primary/25'
                              : hasHours
                                ? 'bg-primary/40 dark:bg-primary/30'
                                : isFuture
                                  ? 'bg-muted/30'
                                  : 'bg-muted/60'
                          }`} />
                        </div>

                        {/* Daily target line */}
                        {dailyTarget > 0 && !isFuture && (
                          <div
                            className="absolute left-0 right-0 border-t border-dashed border-muted-foreground/20"
                            style={{ bottom: `${Math.min((dailyTarget / maxHours) * 100, 100)}%` }}
                          />
                        )}
                      </div>

                      {/* Day label */}
                      <span className={`text-xs ${
                        isTodayBar
                          ? 'text-primary font-semibold'
                          : 'text-muted-foreground'
                      }`}>
                        {entry.day}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Legend */}
              {dailyTarget > 0 && (
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border">
                  <div className="flex items-center gap-1.5">
                    <div className="h-2.5 w-2.5 rounded-sm bg-primary" />
                    <span className="text-xs text-muted-foreground">Today</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="h-2.5 w-2.5 rounded-sm bg-primary/40 dark:bg-primary/30" />
                    <span className="text-xs text-muted-foreground">Other days</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="h-px w-4 border-t border-dashed border-muted-foreground/40" />
                    <span className="text-xs text-muted-foreground">Daily avg target</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* Team activity table — only for admin/manager/owner */}
      {!isEmployeeView && (
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-foreground">Team Activity</CardTitle>
            <CardDescription className="text-muted-foreground">
              Real-time activity status of your team members
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
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
                                  member.is_online ? 'bg-green-500' : 'bg-slate-500'
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
                          <Badge
                            variant={member.is_online ? 'default' : 'secondary'}
                            className={
                              member.is_online
                                ? 'bg-green-500/10 text-green-400 border-green-500/20'
                                : 'bg-muted text-muted-foreground border-border'
                            }
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full mr-1.5 inline-block ${
                                member.is_online ? 'bg-green-400' : 'bg-slate-500'
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
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-foreground">Timesheet</CardTitle>
          <CardDescription className="text-muted-foreground">
            Your time entries for {rangeLabel.toLowerCase()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {timesheetLoading ? (
            <div className="space-y-3">
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
                  {timeEntries.slice(0, 10).map((entry) => (
                    <TableRow key={entry.id} className="border-border">
                      <TableCell className="text-foreground font-mono text-sm">
                        {format(new Date(entry.started_at), 'MMM d, yyyy HH:mm')}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-foreground">
                          {entry.project?.name ?? '—'}
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
              {timeEntries.length > 10 && (
                <div className="mt-4 pt-4 border-t border-border text-center">
                  <Link
                    href="/time"
                    className="inline-flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 transition-colors"
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
