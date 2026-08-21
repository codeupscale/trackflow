'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  CheckCircle,
  ChevronsUpDown,
  Clock,
  Filter,
  Info,
  Loader2,
  Plus,
  Search,
  Timer,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
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
import { usePermissionStore } from '@/stores/permission-store';
import { ApprovalStatusBadge } from '@/components/time-entries/ApprovalStatusBadge';
import { ManualTimeEntryDialog } from '@/components/time-entries/ManualTimeEntryDialog';

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
  approval_status?: 'pending' | 'approved' | 'rejected';
  rejection_reason?: string | null;
  project?: {
    id: string;
    name: string;
    color: string;
  };
  task?: {
    id: string;
    name: string;
  };
  user?: {
    id: string;
    name: string;
    email: string;
  };
}

interface TeamUser {
  id: string;
  name: string;
  email: string;
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
  const { hasPermission, hasPermissionWithScope } = usePermissionStore();
  const canApprove = hasPermission('time_entries.approve');
  const canDeleteAll = hasPermission('time_entries.delete');
  const canDeleteOwnManual = !canDeleteAll;

  const isManagerOrAbove = hasPermissionWithScope('time_entries.view', 'project');

  const [dateFrom, setDateFrom] = useState(() => searchParams.get('from') || '');
  const [dateTo, setDateTo] = useState(() => searchParams.get('to') || '');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [memberFilter, setMemberFilter] = useState<string>('all');
  const [selectedEntries, setSelectedEntries] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [projectComboboxOpen, setProjectComboboxOpen] = useState(false);
  const [memberComboboxOpen, setMemberComboboxOpen] = useState(false);
  const [manualEntryOpen, setManualEntryOpen] = useState(false);
  const [viewEntry, setViewEntry] = useState<TimeEntry | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const { data: projects } = useQuery<Project[]>({
    queryKey: ['projects-list'],
    queryFn: async () => {
      const res = await api.get('/projects', { params: { per_page: 100 } });
      return res.data.projects || res.data.data || (Array.isArray(res.data) ? res.data : []);
    },
  });

  const { data: teamUsers } = useQuery<TeamUser[]>({
    queryKey: ['team-users'],
    queryFn: async () => {
      const res = await api.get('/users', { params: { per_page: 100 } });
      return res.data.users || res.data.data || (Array.isArray(res.data) ? res.data : []);
    },
    enabled: isManagerOrAbove,
  });

  const { data: entriesData, isLoading } = useQuery<PaginatedResponse>({
    queryKey: ['time-entries', dateFrom, dateTo, projectFilter, typeFilter, memberFilter, page],
    queryFn: async () => {
      const params: Record<string, string | number> = {
        page,
        per_page: 20,
      };
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      if (projectFilter && projectFilter !== 'all') {
        params.project_id = projectFilter;
      }
      if (typeFilter && typeFilter !== 'all') {
        params.type = typeFilter;
      }
      if (isManagerOrAbove && memberFilter && memberFilter !== 'all') {
        params.user_id = memberFilter;
      }
      const res = await api.get('/time-entries', { params });
      const data = res.data;
      if (data.data) {
        data.data = data.data.map((entry: Record<string, unknown>) => ({
          ...entry,
          status: entry.approval_status ?? (entry.is_approved ? 'approved' : 'pending'),
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

  const [, setTick] = useState(0);
  const hasRunningEntry = entries.some((e) => !e.ended_at);
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

  const deleteMutation = useMutation({
    mutationFn: async (entryIds: string[]) => {
      await Promise.all(entryIds.map((id) => api.delete(`/time-entries/${id}`)));
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      setSelectedEntries([]);
      toast.success(`${variables.length} time ${variables.length === 1 ? 'entry' : 'entries'} deleted`);
    },
    onError: () => {
      toast.error('Failed to delete entries');
    },
  });

  const toggleEntry = (id: string) => {
    setSelectedEntries((prev) =>
      prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    const allIds = entries.map((e) => e.id);
    if (selectedEntries.length === allIds.length) {
      setSelectedEntries([]);
    } else {
      setSelectedEntries(allIds);
    }
  };

  const canDelete = canDeleteAll || canDeleteOwnManual;
  const showCheckboxes = canDelete || canApprove;
  const selectedPendingCount = selectedEntries.filter((id) => entries.find((e) => e.id === id && e.status === 'pending')).length;
  const selectedDeletableCount = canDeleteAll
    ? selectedEntries.length
    : selectedEntries.filter((id) =>
        entries.find((e) => e.id === id && e.user_id === user?.id && e.type === 'manual' && (e.status === 'pending' || e.status === 'rejected'))
      ).length;

  const totalSeconds = entries.reduce((sum, e) => sum + getDisplayDuration(e), 0);

  const activeFilterCount = [
    dateFrom || dateTo,
    projectFilter !== 'all',
    typeFilter !== 'all',
    isManagerOrAbove && memberFilter !== 'all',
  ].filter(Boolean).length;

  const clearFilters = () => {
    setDateFrom('');
    setDateTo('');
    setProjectFilter('all');
    setTypeFilter('all');
    setMemberFilter('all');
    setPage(1);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">Time Entries</h1>
          <p className="text-muted-foreground text-xs mt-0.5">Track and manage your work hours</p>
        </div>
        <Button onClick={() => setManualEntryOpen(true)} size="sm" className="shrink-0">
          <Plus className="h-4 w-4 mr-1.5" />
          Log Time
        </Button>
      </div>

      <ManualTimeEntryDialog
        open={manualEntryOpen}
        onOpenChange={setManualEntryOpen}
        canLogOnBehalf={canApprove}
      />

      <ManualTimeEntryDialog
        open={!!viewEntry}
        onOpenChange={(open) => { if (!open) setViewEntry(null); }}
        canLogOnBehalf={canApprove}
        entry={viewEntry}
        initialMode="view"
      />

      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-border">
          <CardContent className="p-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 shrink-0">
                <Clock className="h-4 w-4 text-blue-500" />
              </div>
              <div className="min-w-0">
                <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Total Hours</p>
                <p className="text-base font-bold text-foreground tabular-nums leading-tight">{formatDuration(totalSeconds)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 shrink-0">
                <CheckCircle className="h-4 w-4 text-emerald-500" />
              </div>
              <div className="min-w-0">
                <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Entries</p>
                <p className="text-base font-bold text-foreground tabular-nums leading-tight">{meta?.total ?? entries.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 shrink-0">
                <Timer className="h-4 w-4 text-amber-500" />
              </div>
              <div className="min-w-0">
                <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Pending</p>
                <p className="text-base font-bold text-foreground tabular-nums leading-tight">{entries.filter((e) => e.status === 'pending').length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 shrink-0">
                <Search className="h-4 w-4 text-violet-500" />
              </div>
              <div className="min-w-0">
                <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Projects</p>
                <p className="text-base font-bold text-foreground tabular-nums leading-tight">{new Set(entries.map((e) => e.project_id).filter(Boolean)).size}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter Bar */}
      <Card className="border-border">
        <CardContent className="p-3">
          {/* Filter Controls Row */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Date Range */}
            <DatePicker
              value={dateFrom}
              onChange={(val) => { setDateFrom(val); if (dateTo && val > dateTo) setDateTo(val); setPage(1); }}
              placeholder="From date"
              className="w-[140px] h-8 text-xs"
              maxDate={dateTo || undefined}
            />
            <span className="text-xs text-muted-foreground">to</span>
            <DatePicker
              value={dateTo}
              onChange={(val) => { setDateTo(val); setPage(1); }}
              placeholder="To date"
              className="w-[140px] h-8 text-xs"
              minDate={dateFrom || undefined}
            />

            <div className="h-5 w-px bg-border mx-1 hidden sm:block" />

            {/* Toggle Filters Button */}
            <Button
              variant={showFilters ? 'secondary' : 'outline'}
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="h-3.5 w-3.5" />
              Filters
              {activeFilterCount > 0 && (
                <Badge className="h-4 w-4 p-0 flex items-center justify-center text-[0.55rem] rounded-full bg-primary text-primary-foreground">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>

            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground gap-1" onClick={clearFilters}>
                <X className="h-3 w-3" />
                Clear
              </Button>
            )}

            {/* Bulk Actions (right side) */}
            {selectedEntries.length > 0 && (
              <div className="flex items-center gap-2 ml-auto">
                {canApprove && selectedPendingCount > 0 && (
                  <Button
                    onClick={() => {
                      const pendingIds = selectedEntries.filter((id) => entries.find((e) => e.id === id && e.status === 'pending'));
                      approveMutation.mutate(pendingIds);
                    }}
                    disabled={approveMutation.isPending}
                    size="sm"
                    className="h-8 text-xs"
                  >
                    {approveMutation.isPending ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Approve ({selectedPendingCount})
                  </Button>
                )}
                {canDelete && selectedDeletableCount > 0 && (
                  <Button
                    onClick={() => {
                      const deletableIds = canDeleteAll
                        ? selectedEntries
                        : selectedEntries.filter((id) =>
                            entries.find((e) => e.id === id && e.user_id === user?.id && e.type === 'manual' && (e.status === 'pending' || e.status === 'rejected'))
                          );
                      deleteMutation.mutate(deletableIds);
                    }}
                    disabled={deleteMutation.isPending}
                    variant="destructive"
                    size="sm"
                    className="h-8 text-xs"
                  >
                    {deleteMutation.isPending ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Delete ({selectedDeletableCount})
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Expandable Filter Panel */}
          {showFilters && (
            <div className="flex items-end gap-3 flex-wrap mt-3 pt-3 border-t border-border/50">
              {/* Project */}
              <div className="grid gap-1">
                <label className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Project</label>
                <Popover open={projectComboboxOpen} onOpenChange={setProjectComboboxOpen}>
                  <PopoverTrigger
                    render={
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-[180px] h-8 justify-between font-normal text-xs"
                      />
                    }
                  >
                    <span className="truncate">
                      {projectFilter === 'all'
                        ? 'All Projects'
                        : projects?.find((p) => p.id === projectFilter)?.name ?? 'All Projects'}
                    </span>
                    <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                  </PopoverTrigger>
                  <PopoverContent className="w-[200px] p-0">
                    <Command>
                      <CommandInput placeholder="Search projects..." />
                      <CommandList>
                        <CommandEmpty>No projects found.</CommandEmpty>
                        <CommandGroup>
                          <CommandItem
                            value="all"
                            data-checked={projectFilter === 'all' ? true : undefined}
                            onSelect={() => {
                              setProjectFilter('all');
                              setPage(1);
                              setProjectComboboxOpen(false);
                            }}
                          >
                            All Projects
                          </CommandItem>
                          {projects?.map((project) => (
                            <CommandItem
                              key={project.id}
                              value={project.name}
                              data-checked={projectFilter === project.id ? true : undefined}
                              onSelect={() => {
                                setProjectFilter(project.id);
                                setPage(1);
                                setProjectComboboxOpen(false);
                              }}
                            >
                              <div className="flex items-center gap-2">
                                <div
                                  className="h-2 w-2 rounded-full shrink-0"
                                  style={{ backgroundColor: project.color || '#6366f1' }}
                                />
                                {project.name}
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Type */}
              <div className="grid gap-1">
                <label className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Type</label>
                <Select value={typeFilter} onValueChange={(val) => { setTypeFilter(val ?? 'all'); setPage(1); }}>
                  <SelectTrigger className="w-[130px] h-8 text-xs">
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="tracked">Tracked</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="idle">Idle</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Member (manager+) */}
              {isManagerOrAbove && (
                <div className="grid gap-1">
                  <label className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Member</label>
                  <Popover open={memberComboboxOpen} onOpenChange={setMemberComboboxOpen}>
                    <PopoverTrigger
                      render={
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-[180px] h-8 justify-between font-normal text-xs"
                        />
                      }
                    >
                      <span className="truncate">
                        {memberFilter === 'all'
                          ? 'All Members'
                          : teamUsers?.find((u) => u.id === memberFilter)?.name ?? 'All Members'}
                      </span>
                      <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                    </PopoverTrigger>
                    <PopoverContent className="w-[200px] p-0">
                      <Command>
                        <CommandInput placeholder="Search members..." />
                        <CommandList>
                          <CommandEmpty>No members found.</CommandEmpty>
                          <CommandGroup>
                            <CommandItem
                              value="all"
                              data-checked={memberFilter === 'all' ? true : undefined}
                              onSelect={() => {
                                setMemberFilter('all');
                                setPage(1);
                                setMemberComboboxOpen(false);
                              }}
                            >
                              All Members
                            </CommandItem>
                            {teamUsers?.map((member) => (
                              <CommandItem
                                key={member.id}
                                value={member.name}
                                data-checked={memberFilter === member.id ? true : undefined}
                                onSelect={() => {
                                  setMemberFilter(member.id);
                                  setPage(1);
                                  setMemberComboboxOpen(false);
                                }}
                              >
                                <div className="flex flex-col">
                                  <span>{member.name}</span>
                                  <span className="text-xs text-muted-foreground">{member.email}</span>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Entries Table */}
      <Card className="border-border">
        <CardContent className="p-0">
          {/* Table Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">Entries</h2>
              <Badge variant="outline" className="text-[0.6rem] h-5 tabular-nums">
                {meta && meta.total != null
                  ? `${entries.length} of ${meta.total}`
                  : entries.length}
              </Badge>
            </div>
          </div>

          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 bg-muted rounded animate-pulse" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-16">
              <Clock className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground font-medium">No time entries found</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Start the timer or adjust your filters to see entries
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      {showCheckboxes && (
                        <TableHead className="w-[40px] px-3">
                          <Checkbox
                            checked={
                              selectedEntries.length === entries.length &&
                              entries.length > 0
                            }
                            onCheckedChange={toggleAll}
                            aria-label="Select all entries"
                          />
                        </TableHead>
                      )}
                      <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">Date</TableHead>
                      {isManagerOrAbove && (
                        <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">Member</TableHead>
                      )}
                      <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">Type</TableHead>
                      <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">Project</TableHead>
                      <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">Task</TableHead>
                      <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground text-right">Duration</TableHead>
                      <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground text-right">
                        <span className="inline-flex items-center gap-1">
                          Activity
                          <Tooltip>
                            <TooltipTrigger
                              render={<span />}
                              className="inline-flex"
                              aria-label="Activity info"
                            >
                              <Info className="h-3 w-3 text-muted-foreground hover:text-foreground transition-colors" />
                            </TooltipTrigger>
                            <TooltipContent>
                              Activity is calculated from keyboard and mouse events during each tracking interval. Higher % means more consistent input activity.
                            </TooltipContent>
                          </Tooltip>
                        </span>
                      </TableHead>
                      <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry) => (
                      <TableRow key={entry.id} className={`border-border/50 hover:bg-muted/30 transition-colors ${entry.type === 'manual' ? 'cursor-pointer' : ''}`} onClick={() => { if (entry.type === 'manual') setViewEntry(entry); }}>
                        {showCheckboxes && (
                          <TableCell className="px-3" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedEntries.includes(entry.id)}
                              onCheckedChange={() => toggleEntry(entry.id)}
                              aria-label={`Select entry ${entry.id}`}
                            />
                          </TableCell>
                        )}
                        <TableCell className="py-2.5">
                          <div>
                            <span className="text-[0.7rem] font-medium text-foreground">
                              {format(new Date(entry.started_at), 'MMM d, yyyy')}
                            </span>
                            <div className="text-[0.65rem] text-muted-foreground tabular-nums">
                              {(() => {
                                const start = new Date(entry.started_at);
                                if (!entry.ended_at) return format(start, 'hh:mm a');
                                const end = new Date(entry.ended_at);
                                const earlier = start <= end ? start : end;
                                const later = start <= end ? end : start;
                                return `${format(earlier, 'hh:mm a')} - ${format(later, 'hh:mm a')}`;
                              })()}
                            </div>
                          </div>
                        </TableCell>
                        {isManagerOrAbove && (
                          <TableCell className="py-2.5">
                            <div>
                              <span className="text-[0.7rem] font-medium text-foreground">{entry.user?.name || '—'}</span>
                              <div className="text-[0.6rem] text-muted-foreground">{entry.user?.email || ''}</div>
                            </div>
                          </TableCell>
                        )}
                        <TableCell className="py-2.5">
                          <Badge
                            variant="outline"
                            className={`text-[0.55rem] px-1.5 py-0 h-4 font-medium ${
                              entry.type === 'tracked'
                                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
                                : entry.type === 'manual'
                                ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20'
                                : 'bg-muted text-muted-foreground border-border'
                            }`}
                          >
                            {entry.type === 'idle' ? 'Idle' : entry.type === 'manual' ? 'Manual' : 'Tracked'}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-2.5">
                          {entry.project ? (
                            <div className="flex items-center gap-1.5">
                              <div
                                className="h-2 w-2 rounded-full shrink-0"
                                style={{ backgroundColor: entry.project.color || '#6366f1' }}
                              />
                              <span className="text-[0.7rem] font-medium text-foreground">{entry.project.name}</span>
                            </div>
                          ) : (
                            <span className="text-[0.65rem] text-muted-foreground">No project</span>
                          )}
                        </TableCell>
                        <TableCell className="text-[0.7rem] text-foreground py-2.5 max-w-[150px]">
                          {entry.task?.name ? (
                            <span className="block truncate" title={entry.task.name}>{entry.task.name}</span>
                          ) : (
                            <span className="text-muted-foreground text-[0.65rem]">No task</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right py-2.5">
                          {entry.ended_at ? (
                            <span className="text-[0.7rem] font-mono font-semibold text-foreground tabular-nums">{formatDuration(entry.duration_seconds)}</span>
                          ) : (
                            <span className="text-[0.7rem] font-mono font-semibold text-emerald-500 tabular-nums">{formatDuration(getDisplayDuration(entry))} <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse ml-0.5 align-middle" /></span>
                          )}
                        </TableCell>
                        <TableCell className="text-right py-2.5">
                          <div className="flex items-center justify-end gap-1.5">
                            <div className="w-10 h-1 bg-muted rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${getActivityColor(entry.activity_score).bar}`}
                                style={{ width: `${Math.min(entry.activity_score, 100)}%` }}
                              />
                            </div>
                            <span className={`text-[0.6rem] font-mono tabular-nums font-medium ${getActivityColor(entry.activity_score).text}`}>
                              {entry.activity_score}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center py-2.5">
                          <ApprovalStatusBadge
                            status={entry.approval_status ?? entry.status}
                            rejectionReason={entry.rejection_reason}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {meta && meta.last_page > 1 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-border/50">
                  <p className="text-[0.65rem] text-muted-foreground tabular-nums">
                    Showing {((meta.current_page - 1) * 20) + 1}&ndash;{Math.min(meta.current_page * 20, meta.total)} of {meta.total}
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
                      {Array.from({ length: meta.last_page }, (_, i) => i + 1)
                        .filter((p) => p === 1 || p === meta.last_page || Math.abs(p - meta.current_page) <= 1)
                        .reduce((acc, p, idx, arr) => {
                          if (idx > 0 && p - arr[idx - 1] > 1) acc.push(-1);
                          acc.push(p);
                          return acc;
                        }, [] as number[])
                        .map((p, idx) =>
                          p === -1 ? (
                            <PaginationItem key={`ellipsis-${idx}`}>
                              <PaginationEllipsis />
                            </PaginationItem>
                          ) : (
                            <PaginationItem key={p}>
                              <PaginationLink
                                isActive={p === meta.current_page}
                                onClick={() => setPage(p)}
                                className="cursor-pointer"
                              >
                                {p}
                              </PaginationLink>
                            </PaginationItem>
                          ),
                        )}
                      <PaginationItem>
                        <PaginationNext
                          onClick={() => setPage((p) => Math.min(meta.last_page, p + 1))}
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
