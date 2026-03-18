'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { CalendarIcon, CheckCircle, Clock, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import api from '@/lib/api';
import { formatDuration } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';

interface TimeEntry {
  id: string;
  user_id: string;
  project_id: string | null;
  task_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
  type?: 'tracked' | 'manual' | 'idle';
  activity_score: number;
  status: 'pending' | 'approved' | 'rejected';
  project?: {
    id: string;
    name: string;
    color: string;
  };
  task?: {
    id: string;
    title: string;
  };
}

interface Project {
  id: string;
  name: string;
  color: string;
}

interface PaginatedResponse {
  data: TimeEntry[];
  meta?: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
  };
}

export default function TimePage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const canApprove = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'manager';

  const [dateFrom, setDateFrom] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [selectedEntries, setSelectedEntries] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  const { data: projects } = useQuery<Project[]>({
    queryKey: ['projects-list'],
    queryFn: async () => {
      const res = await api.get('/projects', { params: { per_page: 100 } });
      return res.data.projects || res.data.data || (Array.isArray(res.data) ? res.data : []);
    },
  });

  const { data: entriesData, isLoading } = useQuery<PaginatedResponse>({
    queryKey: ['time-entries', dateFrom, dateTo, projectFilter, typeFilter, page],
    queryFn: async () => {
      const params: Record<string, string | number> = {
        date_from: dateFrom,
        date_to: dateTo + ' 23:59:59',
        page,
        per_page: 20,
      };
      if (projectFilter && projectFilter !== 'all') {
        params.project_id = projectFilter;
      }
      if (typeFilter && typeFilter !== 'all') {
        params.type = typeFilter;
      }
      const res = await api.get('/time-entries', { params });
      // Backend returns is_approved boolean, map to status string for UI
      const data = res.data;
      if (data.data) {
        data.data = data.data.map((entry: Record<string, unknown>) => ({
          ...entry,
          status: entry.is_approved ? 'approved' : 'pending',
        }));
      }
      return data;
    },
  });

  const entries = entriesData?.data || [];
  const meta = entriesData?.meta;

  const approveMutation = useMutation({
    mutationFn: async (entryIds: string[]) => {
      await Promise.all(entryIds.map((id) => api.post(`/time-entries/${id}/approve`)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      setSelectedEntries([]);
      toast.success('Time entries approved successfully');
    },
    onError: () => {
      toast.error('Failed to approve entries');
    },
  });

  const toggleEntry = (id: string) => {
    setSelectedEntries((prev) =>
      prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    const pendingIds = entries.filter((e) => e.status === 'pending').map((e) => e.id);
    if (selectedEntries.length === pendingIds.length) {
      setSelectedEntries([]);
    } else {
      setSelectedEntries(pendingIds);
    }
  };

  const totalSeconds = entries.reduce((sum, e) => sum + (e.duration_seconds || 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Time Entries</h1>
        <p className="text-slate-400 text-sm mt-1">Track and manage your work hours</p>
      </div>

      {/* Filters */}
      <Card className="border-slate-800 bg-slate-900/50">
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-slate-300" htmlFor="date-from">
                From
              </label>
              <div className="relative">
                <CalendarIcon className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <Input
                  id="date-from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                  className="pl-10 w-[160px] bg-slate-800/50 border-slate-700 text-white"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-slate-300" htmlFor="date-to">
                To
              </label>
              <div className="relative">
                <CalendarIcon className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <Input
                  id="date-to"
                  type="date"
                  value={dateTo}
                  onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                  className="pl-10 w-[160px] bg-slate-800/50 border-slate-700 text-white"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-slate-300">Project</label>
              <Select value={projectFilter} onValueChange={(val) => { setProjectFilter(val ?? 'all'); setPage(1); }}>
                <SelectTrigger className="w-[200px] bg-slate-800/50 border-slate-700">
                  <SelectValue placeholder="All projects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Projects</SelectItem>
                  {projects?.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      <div className="flex items-center gap-2">
                        <div
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: project.color || '#6366f1' }}
                        />
                        {project.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-slate-300">Time type</label>
              <Select value={typeFilter} onValueChange={(val) => { setTypeFilter(val ?? 'all'); setPage(1); }}>
                <SelectTrigger className="w-[160px] bg-slate-800/50 border-slate-700">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="tracked">Tracked</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="idle">Idle</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {canApprove && selectedEntries.length > 0 && (
              <Button
                onClick={() => approveMutation.mutate(selectedEntries)}
                disabled={approveMutation.isPending}
                className="ml-auto bg-blue-600 hover:bg-blue-700"
              >
                {approveMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle className="mr-2 h-4 w-4" />
                )}
                Approve ({selectedEntries.length})
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Time Entries Table */}
      <Card className="border-slate-800 bg-slate-900/50">
        <CardHeader>
          <CardTitle className="text-white">Entries</CardTitle>
          <CardDescription className="text-slate-400">
            {entries.length} entries | Total: {formatDuration(totalSeconds)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 bg-slate-800/50 rounded animate-pulse" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12">
              <Clock className="h-10 w-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 font-medium">No time entries found</p>
              <p className="text-sm text-slate-500 mt-1">
                Start the timer or adjust your filters to see entries
              </p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-800 hover:bg-transparent">
                    {canApprove && (
                      <TableHead className="w-[40px]">
                        <input
                          type="checkbox"
                          checked={
                            selectedEntries.length ===
                            entries.filter((e) => e.status === 'pending').length &&
                            entries.filter((e) => e.status === 'pending').length > 0
                          }
                          onChange={toggleAll}
                          className="rounded border-slate-600"
                        />
                      </TableHead>
                    )}
                    <TableHead className="text-slate-400">Date</TableHead>
                    <TableHead className="text-slate-400">Type</TableHead>
                    <TableHead className="text-slate-400">Project</TableHead>
                    <TableHead className="text-slate-400">Task</TableHead>
                    <TableHead className="text-slate-400 text-right">Duration</TableHead>
                    <TableHead className="text-slate-400 text-right">Activity</TableHead>
                    <TableHead className="text-slate-400 text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id} className="border-slate-800">
                      {canApprove && (
                        <TableCell>
                          {entry.status === 'pending' && (
                            <input
                              type="checkbox"
                              checked={selectedEntries.includes(entry.id)}
                              onChange={() => toggleEntry(entry.id)}
                              className="rounded border-slate-600"
                            />
                          )}
                        </TableCell>
                      )}
                      <TableCell>
                        <span className="text-sm text-white">
                          {format(new Date(entry.started_at), 'MMM d, yyyy')}
                        </span>
                        <div className="text-xs text-slate-500">
                          {format(new Date(entry.started_at), 'HH:mm')}
                          {entry.ended_at && ` - ${format(new Date(entry.ended_at), 'HH:mm')}`}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={
                          entry.type === 'idle' ? 'border-amber-500/30 text-amber-400' :
                          entry.type === 'manual' ? 'border-slate-500/30 text-slate-400' :
                          'border-emerald-500/30 text-emerald-400'
                        }>
                          {entry.type === 'idle' ? 'Idle' : entry.type === 'manual' ? 'Manual' : 'Tracked'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {entry.project ? (
                          <div className="flex items-center gap-2">
                            <div
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: entry.project.color || '#6366f1' }}
                            />
                            <span className="text-sm text-slate-300">{entry.project.name}</span>
                          </div>
                        ) : (
                          <span className="text-sm text-slate-500">No project</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-slate-300">
                        {entry.task?.title || <span className="text-slate-500">--</span>}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-slate-300">
                        {formatDuration(entry.duration_seconds)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-12 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                entry.activity_score >= 70
                                  ? 'bg-green-500'
                                  : entry.activity_score >= 40
                                  ? 'bg-amber-500'
                                  : 'bg-red-500'
                              }`}
                              style={{ width: `${Math.min(entry.activity_score, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-400 w-8 text-right">
                            {entry.activity_score}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          className={
                            entry.status === 'approved'
                              ? 'bg-green-500/10 text-green-400 border-green-500/20'
                              : entry.status === 'rejected'
                              ? 'bg-red-500/10 text-red-400 border-red-500/20'
                              : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          }
                        >
                          {entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              {meta && meta.last_page > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-800">
                  <p className="text-sm text-slate-400">
                    Page {meta.current_page} of {meta.last_page} ({meta.total} total)
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="border-slate-700 text-slate-300"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => p + 1)}
                      disabled={page >= (meta.last_page || 1)}
                      className="border-slate-700 text-slate-300"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
