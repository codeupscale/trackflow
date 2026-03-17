'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, startOfWeek, endOfWeek, isToday, isSameDay } from 'date-fns';
import {
  Clock,
  Users,
  FolderOpen,
  Monitor,
  Calendar,
  ChevronDown,
} from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import api from '@/lib/api';
import { formatDuration } from '@/lib/utils';

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

interface DashboardData {
  stats: DashboardStats;
  team: TeamMember[];
}

type FilterPreset = 'today' | 'week' | 'custom';

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

export default function DashboardPage() {
  const [filterPreset, setFilterPreset] = useState<FilterPreset>('today');
  const [dateFrom, setDateFrom] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [customOpen, setCustomOpen] = useState(false);

  const rangeLabel = useMemo(() => {
    if (filterPreset === 'today') {
      const d = new Date(dateFrom);
      return isToday(d) ? 'Today' : format(d, 'EEE, MMM d, yyyy');
    }
    if (filterPreset === 'week') {
      return `${format(new Date(dateFrom), 'MMM d')} – ${format(new Date(dateTo), 'MMM d, yyyy')}`;
    }
    return `${format(new Date(dateFrom), 'MMM d')} – ${format(new Date(dateTo), 'MMM d, yyyy')}`;
  }, [filterPreset, dateFrom, dateTo]);

  const applyPreset = (preset: FilterPreset) => {
    setFilterPreset(preset);
    if (preset === 'today') {
      const { dateFrom: from, dateTo: to } = getTodayRange();
      setDateFrom(from);
      setDateTo(to);
      setCustomOpen(false);
    } else if (preset === 'week') {
      const { dateFrom: from, dateTo: to } = getWeekRange();
      setDateFrom(from);
      setDateTo(to);
      setCustomOpen(false);
    } else {
      setCustomOpen(true);
    }
  };

  const { data, isLoading, error } = useQuery<DashboardData>({
    queryKey: ['dashboard', dateFrom, dateTo],
    queryFn: async () => {
      const res = await api.get('/dashboard', {
        params: { date_from: dateFrom, date_to: dateTo },
      });
      const raw = res.data;

      // Transform API response { online_users, team_summary } into our expected shape
      // online_users is [{ user: { id, ... }, timer, elapsed_seconds }]
      const onlineUserIds = new Set(
        (raw.online_users || []).map((u: { user: { id: string } }) => u.user.id)
      );
      const teamSummary = raw.team_summary || [];

      const team: TeamMember[] = teamSummary.map((entry: { user: { id: string; name: string; email: string; avatar_url: string | null }; today_seconds: number; activity_score: number }) => ({
        id: entry.user.id,
        name: entry.user.name,
        email: entry.user.email,
        avatar_url: entry.user.avatar_url,
        is_online: onlineUserIds.has(entry.user.id),
        today_seconds: entry.today_seconds || 0,
        current_project: null,
        activity_score: entry.activity_score || 0,
      }));

      const totalSeconds = team.reduce((sum: number, m: TeamMember) => sum + m.today_seconds, 0);

      return {
        stats: {
          total_online: onlineUserIds.size,
          today_hours: totalSeconds / 3600,
          active_projects: 0, // Not in API response
          total_members: team.length,
        },
        team,
      };
    },
    refetchInterval: 30000,
  });

  const stats = data?.stats;
  const team = data?.team || [];

  const { data: timesheetData, isLoading: timesheetLoading } = useQuery({
    queryKey: ['time-entries-dashboard', dateFrom, dateTo],
    queryFn: async () => {
      const res = await api.get('/time-entries', {
        params: {
          date_from: dateFrom,
          date_to: `${dateTo} 23:59:59`,
          per_page: 50,
        },
      });
      const d = res.data;
      const list = d?.data ?? (Array.isArray(d) ? d : []);
      return list;
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

  const statCards = [
    {
      label: 'Total Online',
      value: stats?.total_online ?? 0,
      icon: Users,
      color: 'text-green-400',
      bg: 'bg-green-500/10',
    },
    {
      label: filterPreset === 'today' && isSameDay(new Date(dateFrom), new Date()) ? "Today's Hours" : 'Hours',
      value: stats?.today_hours != null
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
        <p className="text-slate-400">Failed to load dashboard data. Please try again.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header + weekly filter */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-slate-400 text-sm mt-1">
            {filterPreset === 'today' && isSameDay(new Date(dateFrom), new Date())
              ? "Overview of your team's activity today"
              : `Overview for ${rangeLabel}`}
          </p>
        </div>
        <DropdownMenu open={customOpen} onOpenChange={setCustomOpen}>
          <DropdownMenuTrigger className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-700 bg-slate-800/50 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700/50 hover:text-white">
            <Calendar className="h-4 w-4" />
            {rangeLabel}
            <ChevronDown className="h-4 w-4 opacity-70" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 border-slate-800 bg-slate-900">
            <DropdownMenuItem onClick={() => applyPreset('today')}>
              Today
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => applyPreset('week')}>
              This week
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => e.preventDefault()}
              className="flex flex-col items-stretch gap-2 p-3"
            >
              <span className="text-xs text-slate-400 font-medium">Custom range</span>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-8 text-sm bg-slate-800 border-slate-700"
                />
                <span className="text-slate-500">–</span>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-8 text-sm bg-slate-800 border-slate-700"
                />
              </div>
              <Button
                size="sm"
                className="mt-1"
                onClick={() => {
                  setFilterPreset('custom');
                  setCustomOpen(false);
                }}
              >
                Apply
              </Button>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} className="border-slate-800 bg-slate-900/50">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-400">{stat.label}</p>
                    <p className="text-2xl font-bold text-white mt-1">
                      {isLoading ? (
                        <span className="inline-block h-7 w-16 bg-slate-800 rounded animate-pulse" />
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

      {/* Team activity table */}
      <Card className="border-slate-800 bg-slate-900/50">
        <CardHeader>
          <CardTitle className="text-white">Team Activity</CardTitle>
          <CardDescription className="text-slate-400">
            Real-time activity status of your team members
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 bg-slate-800/50 rounded animate-pulse" />
              ))}
            </div>
          ) : team.length === 0 ? (
            <div className="text-center py-12">
              <Users className="h-10 w-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 font-medium">No team members yet</p>
              <p className="text-sm text-slate-500 mt-1">
                Invite your team to start tracking time together
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="text-slate-400">Member</TableHead>
                  <TableHead className="text-slate-400">Status</TableHead>
                  <TableHead className="text-slate-400">
                    {filterPreset === 'today' && isSameDay(new Date(dateFrom), new Date())
                      ? "Today's Hours"
                      : 'Hours'}
                  </TableHead>
                  <TableHead className="text-slate-400">Activity</TableHead>
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
                    <TableRow key={member.id} className="border-slate-800">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <Avatar className="h-8 w-8 border border-slate-700">
                              <AvatarImage
                                src={member.avatar_url || undefined}
                                alt={member.name}
                              />
                              <AvatarFallback className="bg-slate-700 text-white text-xs">
                                {initials}
                              </AvatarFallback>
                            </Avatar>
                            <span
                              className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-slate-900 ${
                                member.is_online ? 'bg-green-500' : 'bg-slate-500'
                              }`}
                            />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-white">{member.name}</p>
                            <p className="text-xs text-slate-500">{member.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={member.is_online ? 'default' : 'secondary'}
                          className={
                            member.is_online
                              ? 'bg-green-500/10 text-green-400 border-green-500/20'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
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
                        <span className="text-sm font-mono text-slate-300">
                          {formatDuration(member.today_seconds)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-2 bg-slate-800 rounded-full max-w-[120px]">
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
                          <span className="text-xs text-slate-400 w-8 text-right">
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

      {/* Timesheet for selected range (current user's entries) */}
      <Card className="border-slate-800 bg-slate-900/50">
        <CardHeader>
          <CardTitle className="text-white">Timesheet</CardTitle>
          <CardDescription className="text-slate-400">
            Your time entries for {rangeLabel.toLowerCase()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {timesheetLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 bg-slate-800/50 rounded animate-pulse" />
              ))}
            </div>
          ) : timeEntries.length === 0 ? (
            <div className="text-center py-12">
              <Clock className="h-10 w-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 font-medium">No time entries in this range</p>
              <p className="text-sm text-slate-500 mt-1">
                Start the timer or log time on the Time page
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="text-slate-400">Date / Time</TableHead>
                  <TableHead className="text-slate-400">Project</TableHead>
                  <TableHead className="text-slate-400">Task</TableHead>
                  <TableHead className="text-slate-400 text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {timeEntries.map((entry) => (
                  <TableRow key={entry.id} className="border-slate-800">
                    <TableCell className="text-slate-300 font-mono text-sm">
                      {format(new Date(entry.started_at), 'MMM d, yyyy HH:mm')}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-slate-300">
                        {entry.project?.name ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-slate-400">
                        {entry.task?.title ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-slate-300">
                      {formatDuration(entry.duration_seconds)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
