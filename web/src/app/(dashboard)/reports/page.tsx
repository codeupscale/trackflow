'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  CalendarIcon,
  Download,
  FileText,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import api from '@/lib/api';
import { formatDuration } from '@/lib/utils';
import { format } from 'date-fns';
import { useAuthStore } from '@/stores/auth-store';

type ReportType = 'summary' | 'team' | 'projects' | 'apps' | 'payroll' | 'attendance';

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
  };
}

interface TeamUser {
  id: string;
  name: string;
}

const reportTypes: { value: ReportType; label: string; description: string }[] = [
  { value: 'summary', label: 'Summary', description: 'Overview of hours and activity' },
  { value: 'team', label: 'Team', description: 'Breakdown by team member' },
  { value: 'projects', label: 'Projects', description: 'Hours and costs per project' },
  { value: 'apps', label: 'Apps & URLs', description: 'Application and website usage' },
  { value: 'payroll', label: 'Payroll', description: 'Billable hours and payroll data' },
  { value: 'attendance', label: 'Attendance', description: 'Work schedule and attendance' },
];

export default function ReportsPage() {
  const { user } = useAuthStore();
  const isEmployee = user?.role === 'employee';

  const [reportType, setReportType] = useState<ReportType>('summary');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return format(d, 'yyyy-MM-dd');
  });
  const [dateTo, setDateTo] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [userFilter, setUserFilter] = useState<string>('all');
  const [shouldFetch, setShouldFetch] = useState(false);
  const [isExporting, setIsExporting] = useState<'pdf' | 'csv' | null>(null);

  const { data: teamUsers } = useQuery<TeamUser[]>({
    queryKey: ['team-users'],
    queryFn: async () => {
      const res = await api.get('/users', { params: { per_page: 100 } });
      return res.data.data || res.data;
    },
    enabled: !isEmployee,
  });

  const {
    data: reportData,
    isLoading,
    isFetching,
  } = useQuery<ReportData>({
    queryKey: ['report', reportType, dateFrom, dateTo, userFilter],
    queryFn: async () => {
      const params: Record<string, string> = {
        type: reportType,
        date_from: dateFrom,
        date_to: dateTo,
      };
      if (userFilter && userFilter !== 'all') {
        params.user_id = userFilter;
      }
      const res = await api.get('/reports', { params });
      return res.data;
    },
    enabled: shouldFetch,
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
          date_from: dateFrom,
          date_to: dateTo,
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
        `report-${reportType}-${dateFrom}-to-${dateTo}.${exportFormat}`
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

  const formatCellValue = (key: string, value: string | number | boolean | null) => {
    if (value === null || value === undefined) return '--';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (key.includes('seconds') || key.includes('duration')) {
      return formatDuration(Number(value));
    }
    if (key.includes('amount') || key.includes('cost') || key.includes('rate')) {
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Reports</h1>
        <p className="text-slate-400 text-sm mt-1">Generate detailed reports for your team</p>
      </div>

      {/* Report Configuration */}
      <Card className="border-slate-800 bg-slate-900/50">
        <CardHeader>
          <CardTitle className="text-lg text-white">Report Builder</CardTitle>
          <CardDescription className="text-slate-400">
            Select a report type, date range, and generate your report
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Report Type */}
          <div className="grid gap-1.5">
            <label className="text-sm font-medium text-slate-300">Report Type</label>
            <Select
              value={reportType}
              onValueChange={(val) => {
                setReportType(val as ReportType);
                setShouldFetch(false);
              }}
            >
              <SelectTrigger className="w-full sm:w-[300px] bg-slate-800/50 border-slate-700">
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
            <p className="text-xs text-slate-500">
              {reportTypes.find((r) => r.value === reportType)?.description}
            </p>
          </div>

          <Separator className="bg-slate-800" />

          {/* Date Range, User Filter & Generate */}
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-slate-300" htmlFor="rpt-date-from">
                From
              </label>
              <div className="relative">
                <CalendarIcon className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <Input
                  id="rpt-date-from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => { setDateFrom(e.target.value); setShouldFetch(false); }}
                  className="pl-10 w-[160px] bg-slate-800/50 border-slate-700 text-white"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-slate-300" htmlFor="rpt-date-to">
                To
              </label>
              <div className="relative">
                <CalendarIcon className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <Input
                  id="rpt-date-to"
                  type="date"
                  value={dateTo}
                  onChange={(e) => { setDateTo(e.target.value); setShouldFetch(false); }}
                  className="pl-10 w-[160px] bg-slate-800/50 border-slate-700 text-white"
                />
              </div>
            </div>

            {!isEmployee && (
              <div className="grid gap-1.5">
                <label className="text-sm font-medium text-slate-300">User</label>
                <Select value={userFilter} onValueChange={(val) => { setUserFilter(val ?? 'all'); setShouldFetch(false); }}>
                  <SelectTrigger className="w-[200px] bg-slate-800/50 border-slate-700">
                    <SelectValue placeholder="All users" />
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
            )}

            <Button
              onClick={handleGenerate}
              disabled={isFetching}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isFetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <BarChart3 className="mr-2 h-4 w-4" />
              )}
              Generate Report
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Report Results */}
      {shouldFetch && (
        <Card className="border-slate-800 bg-slate-900/50">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <CardTitle className="text-lg text-white">
                  {reportTypes.find((r) => r.value === reportType)?.label} Report
                </CardTitle>
                <CardDescription className="text-slate-400">
                  {format(new Date(dateFrom), 'MMM d, yyyy')} &mdash;{' '}
                  {format(new Date(dateTo), 'MMM d, yyyy')}
                </CardDescription>
              </div>
              {reportData && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleExport('csv')}
                    disabled={isExporting !== null}
                    className="border-slate-700 text-slate-300"
                  >
                    {isExporting === 'csv' ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="mr-2 h-4 w-4" />
                    )}
                    CSV
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleExport('pdf')}
                    disabled={isExporting !== null}
                    className="border-slate-700 text-slate-300"
                  >
                    {isExporting === 'pdf' ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <FileText className="mr-2 h-4 w-4" />
                    )}
                    PDF
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {isLoading || isFetching ? (
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-10 bg-slate-800/50 rounded animate-pulse" />
                ))}
              </div>
            ) : !reportData || reportData.rows.length === 0 ? (
              <div className="text-center py-12">
                <BarChart3 className="h-10 w-10 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400 font-medium">No data found</p>
                <p className="text-sm text-slate-500 mt-1">
                  Try adjusting your date range or report type
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Summary Cards */}
                {reportData.summary && (
                  <div className="grid gap-4 sm:grid-cols-3">
                    {reportData.summary.total_hours !== undefined && (
                      <Card className="border-slate-800 bg-slate-800/30">
                        <CardContent className="pt-4 pb-3">
                          <p className="text-xs text-slate-400">Total Hours</p>
                          <p className="text-xl font-bold text-white">
                            {reportData.summary.total_hours.toFixed(1)}h
                          </p>
                        </CardContent>
                      </Card>
                    )}
                    {reportData.summary.total_amount !== undefined && (
                      <Card className="border-slate-800 bg-slate-800/30">
                        <CardContent className="pt-4 pb-3">
                          <p className="text-xs text-slate-400">Total Amount</p>
                          <p className="text-xl font-bold text-white">
                            ${reportData.summary.total_amount.toFixed(2)}
                          </p>
                        </CardContent>
                      </Card>
                    )}
                    {reportData.summary.average_activity !== undefined && (
                      <Card className="border-slate-800 bg-slate-800/30">
                        <CardContent className="pt-4 pb-3">
                          <p className="text-xs text-slate-400">Avg Activity</p>
                          <p className="text-xl font-bold text-white">
                            {reportData.summary.average_activity}%
                          </p>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                )}

                {/* Data Table */}
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-800 hover:bg-transparent">
                      {reportData.columns.map((col) => (
                        <TableHead key={col} className="text-slate-400">
                          {formatColumnName(col)}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reportData.rows.map((row, idx) => (
                      <TableRow key={idx} className="border-slate-800">
                        {reportData.columns.map((col) => (
                          <TableCell key={col} className="text-sm text-slate-300">
                            {formatCellValue(col, row[col])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
