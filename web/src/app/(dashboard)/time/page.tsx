'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { CalendarIcon, CheckCircle, Clock, Info, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
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
import { formatDuration, getActivityColor } from '@/lib/utils';
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
  current_page?: number;
  last_page?: number;
  per_page?: number;
  total?: number;
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
  const searchParams = useSearchParams();
  const canApprove = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'manager';

  const [dateFrom, setDateFrom] = useState(() => searchParams.get('from') || format(new Date(), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(() => searchParams.get('to') || format(new Date(), 'yyyy-MM-dd'));
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
        date_to: dateTo,
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
  const meta = entriesData?.meta || (entriesData?.current_page != null ? {
    current_page: entriesData.current_page!,
    last_page: entriesData.last_page!,
    per_page: entriesData.per_page!,
    total: entriesData.total!,
  } : undefined);

  // Live tick for running entries so duration counts up in real time
  const [, setTick] = useState(0);
  const hasRunningEntry = entries.some((e) => !e.ended_at);
  useEffect(() => {
    if (!hasRunningEntry) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [hasRunningEntry]);

  function getDisplayDuration(entry: { started_at: string; ended_at: string | null; duration_seconds: number }): number {
    if (entry.ended_at) return entry.duration_seconds;
    return Math.max(0, Math.floor((new Date().getTime() - new Date(entry.started_at).getTime()) / 1000));
  }

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

  const totalSeconds = entries.reduce((sum, e) => sum + getDisplayDuration(e), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Time Entries</h1>
        <p className="text-muted-foreground text-sm mt-1">Track and manage your work hours</p>
      </div>

      {/* Filters */}
      <Card className="border-border bg-card">
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor="date-from">
                From
              </label>
              <div className="relative">
                <CalendarIcon className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="date-from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                  className="pl-10 w-[160px] bg-muted border-border text-foreground"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor="date-to">
                To
              </label>
              <div className="relative">
                <CalendarIcon className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="date-to"
                  type="date"
                  value={dateTo}
                  onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                  className="pl-10 w-[160px] bg-muted border-border text-foreground"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-foreground">Project</label>
              <Select value={projectFilter} onValueChange={(val) => { setProjectFilter(val ?? 'all'); setPage(1); }}>
                <SelectTrigger className="w-[200px] bg-muted border-border">
                  <SelectValue placeholder="All projects">
                    {projectFilter === 'all'
                      ? 'All Projects'
                      : projects?.find((p) => p.id === projectFilter)?.name ?? 'All Projects'}
                  </SelectValue>
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
              <label className="text-sm font-medium text-foreground">Time type</label>
              <Select value={typeFilter} onValueChange={(val) => { setTypeFilter(val ?? 'all'); setPage(1); }}>
                <SelectTrigger className="w-[160px] bg-muted border-border">
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
                className="ml-auto"
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
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-foreground">Entries</CardTitle>
          <CardDescription className="text-muted-foreground">
            {meta && meta.total != null
              ? `Showing ${entries.length} of ${meta.total} entries`
              : `${entries.length} entries`}{' '}
            | Page Total: {formatDuration(totalSeconds)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 bg-muted rounded animate-pulse" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12">
              <Clock className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">No time entries found</p>
              <p className="text-sm text-muted-foreground mt-1">
                Start the timer or adjust your filters to see entries
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    {canApprove && (
                      <TableHead className="w-[40px]">
                        <Checkbox
                          checked={
                            selectedEntries.length ===
                            entries.filter((e) => e.status === 'pending').length &&
                            entries.filter((e) => e.status === 'pending').length > 0
                          }
                          onCheckedChange={toggleAll}
                          aria-label="Select all pending entries"
                        />
                      </TableHead>
                    )}
                    <TableHead className="text-muted-foreground">Date</TableHead>
                    <TableHead className="text-muted-foreground">Type</TableHead>
                    <TableHead className="text-muted-foreground">Project</TableHead>
                    <TableHead className="text-muted-foreground">Task</TableHead>
                    <TableHead className="text-muted-foreground text-right">Duration</TableHead>
                    <TableHead className="text-muted-foreground text-right">
                      <span className="inline-flex items-center gap-1">
                        Activity
                        <Tooltip>
                          <TooltipTrigger
                            render={<span />}
                            className="inline-flex"
                            aria-label="Activity info"
                          >
                            <Info className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground transition-colors" />
                          </TooltipTrigger>
                          <TooltipContent>
                            Activity is calculated from keyboard and mouse events during each tracking interval. Higher % means more consistent input activity.
                          </TooltipContent>
                        </Tooltip>
                      </span>
                    </TableHead>
                    <TableHead className="text-muted-foreground text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id} className="border-border">
                      {canApprove && (
                        <TableCell>
                          {entry.status === 'pending' && (
                            <Checkbox
                              checked={selectedEntries.includes(entry.id)}
                              onCheckedChange={() => toggleEntry(entry.id)}
                              aria-label={`Select entry ${entry.id}`}
                            />
                          )}
                        </TableCell>
                      )}
                      <TableCell>
                        <span className="text-sm text-foreground">
                          {format(new Date(entry.started_at), 'MMM d, yyyy')}
                        </span>
                        <div className="text-xs text-muted-foreground">
                          {(() => {
                            const start = new Date(entry.started_at);
                            if (!entry.ended_at) return format(start, 'HH:mm');
                            const end = new Date(entry.ended_at);
                            // Ensure chronological order (idle entries can have start > end)
                            const earlier = start <= end ? start : end;
                            const later = start <= end ? end : start;
                            return `${format(earlier, 'HH:mm')} - ${format(later, 'HH:mm')}`;
                          })()}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={
                          entry.type === 'idle'
                            ? 'outline'
                            : entry.type === 'manual'
                            ? 'secondary'
                            : 'default'
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
                            <span className="text-sm text-foreground">{entry.project.name}</span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">No project</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-foreground">
                        {entry.task?.title || <span className="text-muted-foreground text-xs">No task</span>}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm tabular-nums">
                        {entry.ended_at ? (
                          <span className="text-foreground">{formatDuration(entry.duration_seconds)}</span>
                        ) : (
                          <span className="text-green-400">{formatDuration(getDisplayDuration(entry))} ●</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${getActivityColor(entry.activity_score).bar}`}
                              style={{ width: `${Math.min(entry.activity_score, 100)}%` }}
                            />
                          </div>
                          <Badge variant="outline" className={`text-xs tabular-nums ${getActivityColor(entry.activity_score).badge}`}>
                            {entry.activity_score}%
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={
                          entry.status === 'approved'
                            ? 'default'
                            : entry.status === 'rejected'
                            ? 'destructive'
                            : 'secondary'
                        }>
                          {entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>

              {/* Pagination */}
              {meta && meta.last_page > 1 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-4 pt-4 border-t border-border">
                  <p className="text-sm text-muted-foreground">
                    Page {meta.current_page} of {meta.last_page} ({meta.total} total)
                  </p>
                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                          aria-disabled={page <= 1}
                          className={page <= 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                        />
                      </PaginationItem>
                      <PaginationItem>
                        <PaginationNext
                          onClick={() => setPage((p) => p + 1)}
                          aria-disabled={page >= (meta.last_page || 1)}
                          className={page >= (meta.last_page || 1) ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
