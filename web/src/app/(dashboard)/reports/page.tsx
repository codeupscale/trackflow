'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  Clock,
  Activity,
  DollarSign,
  PieChart,
  Download,
  FileText,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Cell } from 'recharts';
import { toast } from 'sonner';
import { format, startOfMonth } from 'date-fns';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import api from '@/lib/api';
import { cn, formatDuration } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { usePermissionStore } from '@/stores/permission-store';

// ─── Types ────────────────────────────────────────────────────────

type DatePreset = 'today' | '7days' | 'month' | 'custom';

type ReportType = 'summary' | 'team' | 'projects' | 'apps' | 'payroll' | 'attendance';

interface AnalyticsData {
  total_hours: number;
  hours_change_percent: number;
  average_activity: number;
  total_budget_used: number;
  budget_change_percent: number;
  billable_ratio: number;
  non_billable_ratio: number;
  time_per_project: TimePerProject[];
  team_activity_levels: TeamActivityLevel[];
}

interface TimePerProject {
  project_name: string;
  total_hours: number;
  color: string | null;
}

interface TeamActivityLevel {
  day: string;
  avg_activity: number;
  is_weekend: boolean;
}

interface DetailedLog {
  member_name: string;
  member_role: string;
  project_name: string;
  project_color: string;
  task_name: string;
  duration_seconds: number;
  activity_percent: number;
  billable_amount: number;
}

interface DetailedLogsMeta {
  current_page: number;
  last_page: number;
  total: number;
}

interface DetailedLogsResponse {
  data: DetailedLog[];
  meta: DetailedLogsMeta;
}

// Legacy report builder types (kept for Advanced Report Builder)
interface ReportRow {
  [key: string]: string | number | boolean | null;
}

interface ReportData {
  columns: string[];
  rows: ReportRow[];
  summary?: {
    total_hours?: number;
    total_amount?: number;
    average_activity?: number;
    idle_hours?: number;
    idle_percent?: number;
  };
}

interface TeamUser {
  id: string;
  name: string;
}

// ─── Chart Configs ────────────────────────────────────────────────

const chartConfig = {
  total_hours: { label: 'Hours', color: 'hsl(var(--chart-1))' },
  avg_activity: { label: 'Activity %', color: 'hsl(var(--chart-1))' },
} satisfies ChartConfig;

// ─── Helpers ──────────────────────────────────────────────────────

function formatHHMMSS(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function getDateRange(preset: DatePreset): { from: string; to: string } {
  const today = new Date();
  const todayStr = format(today, 'yyyy-MM-dd');
  switch (preset) {
    case 'today':
      return { from: todayStr, to: todayStr };
    case '7days': {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      return { from: format(sevenDaysAgo, 'yyyy-MM-dd'), to: todayStr };
    }
    case 'month':
      return { from: format(startOfMonth(today), 'yyyy-MM-dd'), to: todayStr };
    default:
      return { from: todayStr, to: todayStr };
  }
}

function activityBarColor(percent: number): string {
  if (percent >= 80) return 'bg-green-500';
  if (percent >= 50) return 'bg-yellow-500';
  return 'bg-red-500';
}

// ─── Legacy report builder helpers ────────────────────────────────

function transformReportResponse(type: ReportType, raw: Record<string, unknown>): ReportData {
  switch (type) {
    case 'summary': {
      const daily = (raw.daily || []) as Record<string, unknown>[];
      return {
        columns: ['date', 'total_seconds', 'activity_score_avg', 'entry_count'],
        rows: daily.map((d) => ({
          date: String(d.date ?? ''),
          total_seconds: Number(d.total_seconds ?? 0),
          activity_score_avg: Number(d.activity_score_avg ?? 0),
          entry_count: Number(d.entry_count ?? 0),
        })),
        summary: {
          total_hours: Number(raw.total_seconds ?? 0) / 3600,
          average_activity: Math.round(Number(raw.avg_activity ?? 0)),
          total_amount: Number(raw.total_earnings ?? 0),
          idle_hours: Number(raw.idle_hours ?? 0),
          idle_percent: Number(raw.idle_percent ?? 0),
        },
      };
    }
    case 'team': {
      const team = (raw.team || []) as Record<string, unknown>[];
      return {
        columns: ['name', 'email', 'role', 'total_seconds', 'avg_activity', 'entry_count', 'idle_hours', 'idle_percent'],
        rows: team.map((t) => {
          const user = (t.user || {}) as Record<string, unknown>;
          return {
            name: String(user.name ?? ''),
            email: String(user.email ?? ''),
            role: String(user.role ?? ''),
            total_seconds: Number(t.total_seconds ?? 0),
            avg_activity: Number(t.avg_activity ?? 0),
            entry_count: Number(t.entry_count ?? 0),
            idle_hours: Number(t.idle_hours ?? 0),
            idle_percent: Number(t.idle_percent ?? 0),
          };
        }),
      };
    }
    case 'projects': {
      const projects = (raw.projects || []) as Record<string, unknown>[];
      return {
        columns: ['project_name', 'total_seconds', 'billable', 'hourly_rate'],
        rows: projects.map((p) => ({
          project_name: String(p.project_name ?? ''),
          total_seconds: Number(p.total_seconds ?? 0),
          billable: Boolean(p.billable),
          hourly_rate: Number(p.hourly_rate ?? 0),
        })),
      };
    }
    case 'apps': {
      const apps = (raw.apps || []) as Record<string, unknown>[];
      return {
        columns: ['active_app', 'count', 'estimated_seconds'],
        rows: apps.map((a) => ({
          active_app: String(a.active_app ?? ''),
          count: Number(a.count ?? 0),
          estimated_seconds: Number(a.estimated_seconds ?? 0),
        })),
      };
    }
    case 'payroll': {
      const payroll = (raw.payroll || []) as Record<string, unknown>[];
      return {
        columns: ['name', 'email', 'total_hours', 'billable_hours', 'earnings'],
        rows: payroll.map((p) => {
          const user = (p.user || {}) as Record<string, unknown>;
          return {
            name: String(user.name ?? ''),
            email: String(user.email ?? ''),
            total_hours: Number(p.total_hours ?? 0),
            billable_hours: Number(p.billable_hours ?? 0),
            earnings: Number(p.earnings ?? 0),
          };
        }),
        summary: {
          total_hours: payroll.reduce((s, p) => s + Number((p as Record<string, unknown>).total_hours ?? 0), 0),
          total_amount: payroll.reduce((s, p) => s + Number((p as Record<string, unknown>).earnings ?? 0), 0),
        },
      };
    }
    case 'attendance': {
      const attendance = (raw.attendance || []) as Record<string, unknown>[];
      return {
        columns: ['user', 'date', 'first_seen', 'last_seen', 'total_seconds'],
        rows: attendance.map((a) => ({
          user: String(a.user_name ?? a.user_id ?? ''),
          date: String(a.date ?? ''),
          first_seen: String(a.first_seen ?? ''),
          last_seen: String(a.last_seen ?? ''),
          total_seconds: Number(a.total_seconds ?? 0),
        })),
      };
    }
    default:
      return { columns: [], rows: [] };
  }
}

const reportTypes: { value: ReportType; label: string; description: string }[] = [
  { value: 'summary', label: 'Summary', description: 'Overview of hours and activity' },
  { value: 'team', label: 'Team', description: 'Breakdown by team member' },
  { value: 'projects', label: 'Projects', description: 'Hours and costs per project' },
  { value: 'apps', label: 'Apps & URLs', description: 'Application and website usage' },
  { value: 'payroll', label: 'Payroll', description: 'Billable hours and payroll data' },
  { value: 'attendance', label: 'Attendance', description: 'Work schedule and attendance' },
];

// ─── Page Component ───────────────────────────────────────────────

export default function ReportsPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { hasPermission } = usePermissionStore();
  const isEmployee = !hasPermission('reports.view');

  // Redirect employees
  useEffect(() => {
    if (isEmployee) {
      toast.error("You don't have access to Reports.");
      router.replace('/dashboard');
    }
  }, [isEmployee, router]);

  // ── Analytics date state ──
  const [preset, setPreset] = useState<DatePreset>('7days');
  const [dateFrom, setDateFrom] = useState(() => getDateRange('7days').from);
  const [dateTo, setDateTo] = useState(() => getDateRange('7days').to);
  const [logsPage, setLogsPage] = useState(1);

  // Reset logsPage when date range changes
  useEffect(() => {
    setLogsPage(1);
  }, [dateFrom, dateTo]);

  // Apply preset
  const handlePreset = (newPreset: DatePreset) => {
    setPreset(newPreset);
    if (newPreset !== 'custom') {
      const range = getDateRange(newPreset);
      setDateFrom(range.from);
      setDateTo(range.to);
    }
  };

  // ── Analytics query ──
  const {
    data: analytics,
    isLoading: analyticsLoading,
    isError: analyticsError,
  } = useQuery<AnalyticsData>({
    queryKey: ['reports-analytics', dateFrom, dateTo],
    queryFn: async () => {
      const res = await api.get('/reports/analytics', {
        params: { date_from: dateFrom, date_to: dateTo },
      });
      const raw = res.data;
      const kpis = raw.kpis ?? {};
      return {
        total_hours: kpis.total_tracked_hours?.value ?? 0,
        hours_change_percent: kpis.total_tracked_hours?.change_percent ?? 0,
        average_activity: kpis.avg_activity_percent?.value ?? 0,
        total_budget_used: kpis.total_budget_used?.value ?? 0,
        budget_change_percent: kpis.total_budget_used?.change_percent ?? 0,
        billable_ratio: kpis.billable_ratio?.billable ?? 0,
        non_billable_ratio: kpis.billable_ratio?.non_billable ?? 0,
        time_per_project: raw.time_per_project ?? [],
        team_activity_levels: (raw.team_activity_levels ?? []).map((d: Record<string, unknown>) => ({
          day: String(d.day ?? ''),
          avg_activity: Number(d.avg_activity ?? 0),
          is_weekend: d.day_num === 0 || d.day_num === 6,
        })),
      } as AnalyticsData;
    },
    enabled: !isEmployee,
  });

  // ── Detailed logs query ──
  const {
    data: logsResponse,
    isLoading: logsLoading,
    isError: logsError,
  } = useQuery<DetailedLogsResponse>({
    queryKey: ['reports-detailed-logs', dateFrom, dateTo, logsPage],
    queryFn: async () => {
      const res = await api.get('/reports/detailed-logs', {
        params: { date_from: dateFrom, date_to: dateTo, page: logsPage, per_page: 10 },
      });
      return res.data;
    },
    enabled: !isEmployee,
  });

  // ── Legacy report builder state ──
  const [showReportBuilder, setShowReportBuilder] = useState(false);
  const [reportType, setReportType] = useState<ReportType>('summary');
  const [builderDateFrom, setBuilderDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return format(d, 'yyyy-MM-dd');
  });
  const [builderDateTo, setBuilderDateTo] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [userFilter, setUserFilter] = useState<string>('all');
  const [shouldFetch, setShouldFetch] = useState(false);
  const [isExporting, setIsExporting] = useState<'pdf' | 'csv' | null>(null);

  const { data: teamUsers } = useQuery<TeamUser[]>({
    queryKey: ['team-users'],
    queryFn: async () => {
      const res = await api.get('/users', { params: { per_page: 100 } });
      return res.data.users || res.data.data || (Array.isArray(res.data) ? res.data : []);
    },
    enabled: !isEmployee,
  });

  const {
    data: reportData,
    isLoading: reportLoading,
    isFetching: reportFetching,
    isError: isReportError,
  } = useQuery<ReportData>({
    queryKey: ['report', reportType, builderDateFrom, builderDateTo, userFilter],
    queryFn: async () => {
      const params: Record<string, string> = {
        date_from: builderDateFrom,
        date_to: builderDateTo,
      };
      if (userFilter && userFilter !== 'all') {
        params.user_id = userFilter;
      }
      const res = await api.get(`/reports/${reportType}`, { params });
      return transformReportResponse(reportType, res.data);
    },
    enabled: shouldFetch && !isEmployee,
  });

  const handleGenerate = () => {
    setShouldFetch(true);
  };

  const handleExport = async (exportFormat: 'pdf' | 'csv') => {
    setIsExporting(exportFormat);
    try {
      const res = await api.post(
        '/reports/export',
        {
          type: reportType,
          date_from: builderDateFrom,
          date_to: builderDateTo,
          format: exportFormat,
          user_id: userFilter !== 'all' ? userFilter : undefined,
        },
        { responseType: 'blob' }
      );
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute(
        'download',
        `report-${reportType}-${builderDateFrom}-to-${builderDateTo}.${exportFormat}`
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success(`Report exported as ${exportFormat.toUpperCase()}`);
    } catch {
      toast.error('Failed to export report');
    } finally {
      setIsExporting(null);
    }
  };

  const handleExportCSV = async () => {
    setIsExporting('csv');
    try {
      const res = await api.post(
        '/reports/export',
        {
          type: 'summary',
          date_from: dateFrom,
          date_to: dateTo,
          format: 'csv',
        },
        { responseType: 'blob' }
      );
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `report-${dateFrom}-to-${dateTo}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Report exported as CSV');
    } catch {
      toast.error('Failed to export report');
    } finally {
      setIsExporting(null);
    }
  };

  const formatCellValue = (key: string, value: string | number | boolean | null) => {
    if (value === null || value === undefined) return '--';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (key.includes('seconds') || key.includes('duration')) {
      return formatDuration(Number(value));
    }
    if (key.includes('hours') || key === 'idle_hours') {
      return `${Number(value).toFixed(1)}h`;
    }
    if (key === 'idle_percent') {
      return `${Number(value).toFixed(1)}%`;
    }
    if (key.includes('amount') || key.includes('cost') || key.includes('rate') || key.includes('earnings')) {
      return `$${Number(value).toFixed(2)}`;
    }
    if (key.includes('score') || key.includes('percentage') || key.includes('activity')) {
      return `${value}%`;
    }
    return String(value);
  };

  const formatColumnName = (key: string) => {
    return key
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  // Derived data
  const timePerProject = useMemo(() => analytics?.time_per_project ?? [], [analytics]);
  const teamActivityLevels = useMemo(() => analytics?.team_activity_levels ?? [], [analytics]);
  const logs = logsResponse?.data ?? [];
  const logsMeta = logsResponse?.meta ?? { current_page: 1, last_page: 1, total: 0 };

  // ── Early return for employees ──
  if (isEmployee) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Section 1: Page Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Reports &amp; Analytics</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Detailed performance and productivity metrics for your team.
          </p>
        </div>
        <div className="flex flex-col items-end gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-border p-1">
            {([
              { value: 'today', label: 'Today' },
              { value: '7days', label: 'Last 7 Days' },
              { value: 'month', label: 'This Month' },
              { value: 'custom', label: 'Custom' },
            ] as const).map((item) => (
              <button
                key={item.value}
                onClick={() => handlePreset(item.value)}
                className={cn(
                  'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                  preset === item.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
                aria-pressed={preset === item.value}
              >
                {item.label}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            disabled={isExporting !== null}
            aria-label="Export report as CSV"
          >
            {isExporting === 'csv' ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <Download data-icon="inline-start" />
            )}
            Export Report
          </Button>
        </div>
      </div>

      {/* Custom date pickers */}
      {preset === 'custom' && (
        <div className="flex items-center gap-3">
          <DatePicker
            value={dateFrom}
            onChange={setDateFrom}
            placeholder="Start date"
          />
          <span className="text-muted-foreground text-sm">to</span>
          <DatePicker
            value={dateTo}
            onChange={setDateTo}
            placeholder="End date"
          />
        </div>
      )}

      {/* ── Section 2: KPI Cards ── */}
      {analyticsLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-4">
                  <Skeleton className="size-10 rounded-lg" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <Skeleton className="h-3 w-32 mb-2" />
                <Skeleton className="h-8 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : analyticsError ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BarChart3 className="size-10 text-destructive/60 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">Failed to load analytics</p>
            <p className="text-sm text-muted-foreground mt-1">Please check your connection and try again.</p>
          </CardContent>
        </Card>
      ) : analytics ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Card 1: Total Tracked Hours */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center justify-center size-10 rounded-lg bg-blue-500/10">
                  <Clock className="size-5 text-blue-500" />
                </div>
                <span
                  className={cn(
                    'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold',
                    analytics.hours_change_percent >= 0
                      ? 'bg-green-500/10 text-green-500'
                      : 'bg-red-500/10 text-red-500'
                  )}
                >
                  {analytics.hours_change_percent >= 0 ? '+' : ''}
                  {analytics.hours_change_percent.toFixed(1)}%
                </span>
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Total Tracked Hours
              </p>
              <p className="text-3xl font-bold text-foreground">
                {analytics.total_hours.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                <span className="text-base font-normal text-muted-foreground ml-1">h</span>
              </p>
            </CardContent>
          </Card>

          {/* Card 2: Average Activity % */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center justify-center size-10 rounded-lg bg-teal-500/10">
                  <Activity className="size-5 text-teal-500" />
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-500">
                  <span className="size-1.5 rounded-full bg-green-500 animate-pulse" />
                  LIVE
                </span>
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Average Activity %
              </p>
              <p className="text-3xl font-bold text-foreground">
                {analytics.average_activity.toFixed(1)}
                <span className="text-base font-normal text-muted-foreground ml-1">%</span>
              </p>
            </CardContent>
          </Card>

          {/* Card 3: Total Budget Used */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center justify-center size-10 rounded-lg bg-emerald-500/10">
                  <DollarSign className="size-5 text-emerald-500" />
                </div>
                <span
                  className={cn(
                    'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold',
                    analytics.budget_change_percent >= 0
                      ? 'bg-green-500/10 text-green-500'
                      : 'bg-red-500/10 text-red-500'
                  )}
                >
                  {analytics.budget_change_percent >= 0 ? '+' : ''}
                  {analytics.budget_change_percent.toFixed(1)}%
                </span>
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Total Budget Used
              </p>
              <p className="text-3xl font-bold text-foreground">
                ${analytics.total_budget_used.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                <span className="text-base font-normal text-muted-foreground ml-1">USD</span>
              </p>
            </CardContent>
          </Card>

          {/* Card 4: Billable Ratio */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center justify-center size-10 rounded-lg bg-slate-500/10">
                  <PieChart className="size-5 text-slate-400" />
                </div>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground">
                  Target 90%
                </span>
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Billable Ratio
              </p>
              <p className="text-3xl font-bold text-foreground">
                {Math.round(analytics.billable_ratio)}:{Math.round(analytics.non_billable_ratio)}
                <span className="text-base font-normal text-muted-foreground ml-1">ratio</span>
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* ── Section 3: Charts ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left: Time per Project */}
        <Card>
          <CardHeader>
            <CardTitle>Time per Project</CardTitle>
            <CardDescription>Distribution across top active projects</CardDescription>
          </CardHeader>
          <CardContent>
            {analyticsLoading ? (
              <div className="flex flex-col gap-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full rounded" />
                ))}
              </div>
            ) : analyticsError ? (
              <div className="flex items-center justify-center h-[280px]">
                <p className="text-sm text-muted-foreground">Failed to load chart data</p>
              </div>
            ) : !timePerProject.length ? (
              <div className="flex items-center justify-center h-[280px]">
                <p className="text-sm text-muted-foreground">No project data available</p>
              </div>
            ) : (
              <ChartContainer config={chartConfig} className="h-[280px] w-full">
                <BarChart
                  layout="vertical"
                  data={timePerProject}
                  margin={{ left: 0, right: 16, top: 8, bottom: 8 }}
                >
                  <XAxis
                    type="number"
                    tickFormatter={(v: number) => `${v}h`}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    dataKey="project_name"
                    type="category"
                    width={120}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12 }}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value) => `${Number(value).toFixed(1)}h`}
                      />
                    }
                  />
                  <Bar dataKey="total_hours" radius={[0, 4, 4, 0]}>
                    {timePerProject.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.color || 'hsl(var(--chart-1))'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        {/* Right: Team Activity Levels */}
        <Card>
          <CardHeader>
            <CardTitle>Team Activity Levels</CardTitle>
            <CardDescription>Daily average engagement percentages</CardDescription>
          </CardHeader>
          <CardContent>
            {analyticsLoading ? (
              <div className="flex items-end gap-2 h-[280px] pb-8">
                {Array.from({ length: 7 }).map((_, i) => (
                  <Skeleton key={i} className="flex-1 rounded" style={{ height: `${40 + Math.random() * 60}%` }} />
                ))}
              </div>
            ) : analyticsError ? (
              <div className="flex items-center justify-center h-[280px]">
                <p className="text-sm text-muted-foreground">Failed to load chart data</p>
              </div>
            ) : !teamActivityLevels.length ? (
              <div className="flex items-center justify-center h-[280px]">
                <p className="text-sm text-muted-foreground">No activity data available</p>
              </div>
            ) : (
              <ChartContainer config={chartConfig} className="h-[280px] w-full">
                <BarChart
                  data={teamActivityLevels}
                  margin={{ left: 0, right: 0, top: 8, bottom: 8 }}
                >
                  <XAxis
                    dataKey="day"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis
                    domain={[0, 100]}
                    hide
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value) => `${Number(value).toFixed(1)}%`}
                      />
                    }
                  />
                  <Bar dataKey="avg_activity" radius={[4, 4, 0, 0]}>
                    {teamActivityLevels.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.is_weekend ? 'hsl(var(--chart-2))' : 'hsl(var(--chart-1))'}
                        fillOpacity={entry.is_weekend ? 0.6 : 1}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Section 4: Detailed Time Logs Table ── */}
      <Card>
        <CardHeader>
          <CardTitle>Detailed Time Logs</CardTitle>
          <CardDescription>Individual time entries for the selected period</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {logsLoading ? (
            <div className="flex flex-col gap-3 p-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded" />
              ))}
            </div>
          ) : logsError ? (
            <div className="text-center py-12">
              <BarChart3 className="size-10 text-destructive/60 mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">Failed to load time logs</p>
              <p className="text-sm text-muted-foreground mt-1">Please try again.</p>
            </div>
          ) : !logs.length ? (
            <div className="text-center py-12">
              <BarChart3 className="size-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">No time logs found</p>
              <p className="text-sm text-muted-foreground mt-1">Try adjusting your date range</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Member Name
                      </TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Project
                      </TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Task
                      </TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Duration
                      </TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Activity %
                      </TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground text-right">
                        Billable Amount
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((row, idx) => (
                      <TableRow key={idx} className="border-border hover:bg-muted/50 transition-colors">
                        {/* Member Name */}
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="size-9 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-foreground shrink-0">
                              {initials(row.member_name)}
                            </div>
                            <div>
                              <p className="font-medium text-foreground">{row.member_name}</p>
                              <p className="text-xs text-muted-foreground capitalize">{row.member_role}</p>
                            </div>
                          </div>
                        </TableCell>
                        {/* Project */}
                        <TableCell>
                          <span
                            className="inline-flex items-center px-2 py-1 rounded text-xs font-medium"
                            style={{
                              backgroundColor: row.project_color + '20',
                              color: row.project_color,
                            }}
                          >
                            {row.project_name}
                          </span>
                        </TableCell>
                        {/* Task */}
                        <TableCell className="text-sm text-foreground max-w-[200px]">
                          <span className="truncate block" title={row.task_name}>
                            {row.task_name && row.task_name.length > 35
                              ? row.task_name.slice(0, 35) + '\u2026'
                              : row.task_name || '--'}
                          </span>
                        </TableCell>
                        {/* Duration */}
                        <TableCell className="text-sm font-mono text-foreground">
                          {formatHHMMSS(row.duration_seconds)}
                        </TableCell>
                        {/* Activity % */}
                        <TableCell>
                          <div className="flex items-center gap-2 min-w-[80px]">
                            <div className="flex-1 bg-muted rounded-full h-1.5">
                              <div
                                className={cn(
                                  'h-1.5 rounded-full',
                                  activityBarColor(row.activity_percent)
                                )}
                                style={{ width: `${Math.min(row.activity_percent, 100)}%` }}
                              />
                            </div>
                            <span className="text-sm text-foreground w-9 text-right">
                              {row.activity_percent}%
                            </span>
                          </div>
                        </TableCell>
                        {/* Billable Amount */}
                        <TableCell className="text-sm text-foreground text-right font-medium">
                          ${row.billable_amount.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {/* Pagination */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                <span className="text-sm text-muted-foreground">
                  Showing {((logsPage - 1) * 10) + 1}&ndash;{Math.min(logsPage * 10, logsMeta.total)} of {logsMeta.total} logs
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={logsPage === 1}
                    onClick={() => setLogsPage((p) => p - 1)}
                    aria-label="Previous page"
                  >
                    &lsaquo; Previous
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={logsPage >= logsMeta.last_page}
                    onClick={() => setLogsPage((p) => p + 1)}
                    aria-label="Next page"
                  >
                    Next &rsaquo;
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Section 5: Advanced Report Builder (collapsible) ── */}
      <Card>
        <CardHeader
          className="cursor-pointer select-none"
          onClick={() => setShowReportBuilder((v) => !v)}
          role="button"
          tabIndex={0}
          aria-expanded={showReportBuilder}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setShowReportBuilder((v) => !v);
            }
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Advanced Report Builder</CardTitle>
              <CardDescription>Generate custom reports with specific filters and export options</CardDescription>
            </div>
            {showReportBuilder ? (
              <ChevronUp className="size-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="size-5 text-muted-foreground" />
            )}
          </div>
        </CardHeader>
        {showReportBuilder && (
          <CardContent className="flex flex-col gap-6">
            {/* Report Type */}
            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-foreground">Report Type</label>
              <Select
                value={reportType}
                onValueChange={(val) => {
                  setReportType(val as ReportType);
                  setShouldFetch(false);
                }}
              >
                <SelectTrigger className="w-full sm:w-[300px]">
                  <SelectValue placeholder="Select report type" />
                </SelectTrigger>
                <SelectContent>
                  {reportTypes.map((rt) => (
                    <SelectItem key={rt.value} value={rt.value}>
                      {rt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {reportTypes.find((r) => r.value === reportType)?.description}
              </p>
            </div>

            <Separator />

            {/* Date Range, User Filter & Generate */}
            <div className="flex flex-col sm:flex-row gap-4 items-end">
              <div className="grid gap-1.5">
                <label className="text-sm font-medium text-foreground">From</label>
                <DatePicker
                  value={builderDateFrom}
                  onChange={(val) => { setBuilderDateFrom(val); setShouldFetch(false); }}
                  placeholder="Start date"
                />
              </div>
              <div className="grid gap-1.5">
                <label className="text-sm font-medium text-foreground">To</label>
                <DatePicker
                  value={builderDateTo}
                  onChange={(val) => { setBuilderDateTo(val); setShouldFetch(false); }}
                  placeholder="End date"
                />
              </div>

              <div className="grid gap-1.5">
                <label className="text-sm font-medium text-foreground">User</label>
                <Select value={userFilter} onValueChange={(val) => { setUserFilter(val ?? 'all'); setShouldFetch(false); }}>
                  <SelectTrigger className="w-[200px]">
                    <span className="truncate">
                      {userFilter === 'all'
                        ? 'All Users'
                        : teamUsers?.find((u) => u.id === userFilter)?.name ?? 'Select user'}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Users</SelectItem>
                    {teamUsers?.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button onClick={handleGenerate} disabled={reportFetching}>
                {reportFetching ? (
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                ) : (
                  <BarChart3 data-icon="inline-start" />
                )}
                Generate Report
              </Button>
            </div>

            {/* Report Results */}
            {shouldFetch && (
              <div className="flex flex-col gap-4">
                <Separator />
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">
                      {reportTypes.find((r) => r.value === reportType)?.label} Report
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {format(new Date(builderDateFrom), 'MMM d, yyyy')} &mdash;{' '}
                      {format(new Date(builderDateTo), 'MMM d, yyyy')}
                    </p>
                  </div>
                  {reportData && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleExport('csv')}
                        disabled={isExporting !== null}
                      >
                        {isExporting === 'csv' ? (
                          <Loader2 className="animate-spin" data-icon="inline-start" />
                        ) : (
                          <Download data-icon="inline-start" />
                        )}
                        CSV
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleExport('pdf')}
                        disabled={isExporting !== null}
                      >
                        {isExporting === 'pdf' ? (
                          <Loader2 className="animate-spin" data-icon="inline-start" />
                        ) : (
                          <FileText data-icon="inline-start" />
                        )}
                        PDF
                      </Button>
                    </div>
                  )}
                </div>

                {isReportError ? (
                  <div className="text-center py-12">
                    <BarChart3 className="size-10 text-destructive/60 mx-auto mb-3" />
                    <p className="text-muted-foreground font-medium">Failed to load report</p>
                    <p className="text-sm text-muted-foreground mt-1">Please try again.</p>
                  </div>
                ) : reportLoading || reportFetching ? (
                  <div className="flex flex-col gap-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <Skeleton key={i} className="h-10 w-full rounded" />
                    ))}
                  </div>
                ) : !reportData || reportData.rows.length === 0 ? (
                  <div className="text-center py-12">
                    <BarChart3 className="size-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground font-medium">No data found</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Try adjusting your date range or report type
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-6">
                    {/* Summary Cards */}
                    {reportData.summary && (
                      <div className="grid gap-4 sm:grid-cols-3">
                        {reportData.summary.total_hours !== undefined && (
                          <Card>
                            <CardContent className="pt-4 pb-3">
                              <p className="text-xs text-muted-foreground">Total Hours</p>
                              <p className="text-xl font-bold text-foreground">
                                {reportData.summary.total_hours.toFixed(1)}h
                              </p>
                            </CardContent>
                          </Card>
                        )}
                        {reportData.summary.total_amount !== undefined && (
                          <Card>
                            <CardContent className="pt-4 pb-3">
                              <p className="text-xs text-muted-foreground">Total Amount</p>
                              <p className="text-xl font-bold text-foreground">
                                ${reportData.summary.total_amount.toFixed(2)}
                              </p>
                            </CardContent>
                          </Card>
                        )}
                        {reportData.summary.average_activity !== undefined && (
                          <Card>
                            <CardContent className="pt-4 pb-3">
                              <p className="text-xs text-muted-foreground">Avg Activity</p>
                              <p className="text-xl font-bold text-foreground">
                                {reportData.summary.average_activity}%
                              </p>
                            </CardContent>
                          </Card>
                        )}
                        {reportData.summary.idle_hours !== undefined && (
                          <Card>
                            <CardContent className="pt-4 pb-3">
                              <p className="text-xs text-muted-foreground">Idle (hr)</p>
                              <p className="text-xl font-bold text-foreground">
                                {reportData.summary.idle_hours.toFixed(1)}h
                              </p>
                            </CardContent>
                          </Card>
                        )}
                        {reportData.summary.idle_percent !== undefined && (
                          <Card>
                            <CardContent className="pt-4 pb-3">
                              <p className="text-xs text-muted-foreground">Idle (%)</p>
                              <p className="text-xl font-bold text-foreground">
                                {reportData.summary.idle_percent.toFixed(1)}%
                              </p>
                            </CardContent>
                          </Card>
                        )}
                      </div>
                    )}

                    {/* Data Table */}
                    <div className="rounded-lg border border-border overflow-hidden">
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow className="border-border hover:bg-transparent">
                              {reportData.columns.map((col) => (
                                <TableHead key={col} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                  {formatColumnName(col)}
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {reportData.rows.map((row, idx) => (
                              <TableRow key={idx} className="border-border hover:bg-muted/50 transition-colors">
                                {reportData.columns.map((col) => (
                                  <TableCell key={col} className="text-sm text-foreground">
                                    {formatCellValue(col, row[col])}
                                  </TableCell>
                                ))}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
