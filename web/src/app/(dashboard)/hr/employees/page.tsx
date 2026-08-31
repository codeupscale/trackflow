'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Building2,
  Briefcase,
  ChevronDown,
  ChevronUp,
  Copy,
  Filter,
  LayoutGrid,
  List,
  Loader2,
  Mail,
  MapPin,
  RefreshCw,
  Search,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';

import api from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { usePermissionStore } from '@/stores/permission-store';
import { useEmployees, type UseEmployeesParams } from '@/hooks/hr/use-employees';

import type { EmployeeListItem } from '@/lib/validations/employee';
import {
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_TYPES,
  employmentStatusLabels,
  employmentTypeLabels,
} from '@/lib/validations/employee';

import { EmptyState } from '@/components/common/EmptyState';
import { DepartmentSelect } from '@/components/hr/DepartmentSelect';
import { EmployeeDetailModal, RoleBadge } from '@/components/hr/EmployeeDetailModal';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectGroup,
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { cn, formatDate } from '@/lib/utils';

const INVITE_ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  org_manager: 'Org Manager',
  hr_manager: 'HR Manager',
  finance_manager: 'Finance Manager',
  employee: 'Employee',
};

function formatRoleLabel(role: string): string {
  return INVITE_ROLE_LABELS[role] ?? role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

interface Invitation {
  id: string;
  name: string | null;
  email: string;
  role: string;
  token: string;
  expires_at: string;
  created_at: string;
  creator?: { id: string; name: string; email: string };
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

const avatarColors = [
  'from-blue-500 to-blue-600',
  'from-violet-500 to-violet-600',
  'from-emerald-500 to-emerald-600',
  'from-orange-500 to-orange-600',
  'from-rose-500 to-rose-600',
  'from-cyan-500 to-cyan-600',
  'from-amber-500 to-amber-600',
  'from-indigo-500 to-indigo-600',
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

const employmentStatusDotColors: Record<string, string> = {
  active: 'bg-emerald-500',
  probation: 'bg-amber-500',
  notice_period: 'bg-yellow-500',
  terminated: 'bg-red-500',
  resigned: 'bg-gray-400',
};

function EmploymentStatusDot({ status }: { status: string }) {
  const dotColor = employmentStatusDotColors[status] ?? 'bg-gray-400';
  const label = employmentStatusLabels[status as keyof typeof employmentStatusLabels] ?? status;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('size-1.5 rounded-full shrink-0', dotColor)} />
      <span className="text-[0.65rem] text-muted-foreground capitalize">{label}</span>
    </span>
  );
}

export default function EmployeesPage() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { hasPermission, hasPermissionWithScope } = usePermissionStore();

  const isManagerOrAdmin = hasPermissionWithScope('employees.view_directory', 'project');
  const canInvite = hasPermission('team.invite');

  useEffect(() => {
    if (user && !isManagerOrAdmin) {
      setSelectedEmployeeId(user.id);
      setModalOpen(true);
    }
  }, [user, isManagerOrAdmin]);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [employmentStatus, setEmploymentStatus] = useState<string>('all');
  const [employmentType, setEmploymentType] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [showFilters, setShowFilters] = useState(false);

  // Employee detail modal
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Invite state
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('employee');
  const [inviteErrors, setInviteErrors] = useState<{ name?: string; email?: string; role?: string }>({});
  const [invitesExpanded, setInvitesExpanded] = useState(false);

  const { data: invitationsData, isLoading: invitesLoading } = useQuery<{ data: Invitation[] }>({
    queryKey: ['invitations'],
    queryFn: async () => { const res = await api.get('/invitations', { params: { per_page: 50 } }); return res.data; },
    enabled: canInvite,
  });
  const invitations = invitationsData?.data ?? [];

  const inviteMutation = useMutation({
    mutationFn: async (data: { name: string; email: string; role: string }) => { await api.post('/invitations', data); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      setInviteOpen(false);
      setInviteName('');
      setInviteEmail('');
      setInviteRole('employee');
      setInviteErrors({});
      toast.success('Invitation sent successfully');
    },
    onError: (err: unknown) => {
      const axiosErr = err as { response?: { data?: { message?: string; errors?: Record<string, string[]> }; status?: number } };
      if (axiosErr.response?.status === 403) { toast.error("You don't have permission to send invitations."); return; }
      const errors = axiosErr.response?.data?.errors;
      if (errors) setInviteErrors({ name: errors.name?.[0], email: errors.email?.[0], role: errors.role?.[0] });
      toast.error(axiosErr.response?.data?.message || 'Failed to send invitation');
    },
  });

  const resendMutation = useMutation({
    mutationFn: async (id: string) => { await api.post(`/invitations/${id}/resend`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['invitations'] }); toast.success('Invitation resent'); },
    onError: () => { toast.error('Failed to resend invitation'); },
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/invitations/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['invitations'] }); toast.success('Invitation revoked'); },
    onError: () => { toast.error('Failed to revoke invitation'); },
  });

  const copyInviteLink = async (token: string) => {
    const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/invitations/accept?token=${token}`;
    try { await navigator.clipboard.writeText(url); toast.success('Invite link copied'); } catch { toast.error('Failed to copy link'); }
  };

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteName.trim() || !inviteEmail.trim()) return;
    setInviteErrors({});
    inviteMutation.mutate({ name: inviteName.trim(), email: inviteEmail.trim(), role: inviteRole });
  };

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 300);
  };

  const params: UseEmployeesParams = useMemo(
    () => ({
      page,
      per_page: 12,
      search: debouncedSearch || undefined,
      department_id: departmentId ?? undefined,
      employment_status: employmentStatus !== 'all' ? employmentStatus : undefined,
      employment_type: employmentType !== 'all' ? employmentType : undefined,
    }),
    [page, debouncedSearch, departmentId, employmentStatus, employmentType]
  );

  const { data, isLoading, isError } = useEmployees(params);

  const employees = data?.data ?? [];
  const meta = data?.meta;
  const totalPages = meta?.last_page ?? 1;

  const handleFilterChange = () => {
    setPage(1);
  };

  const activeFilterCount = [
    departmentId != null,
    employmentStatus !== 'all',
    employmentType !== 'all',
  ].filter(Boolean).length;

  const clearFilters = () => {
    setDepartmentId(null);
    setEmploymentStatus('all');
    setEmploymentType('all');
    setPage(1);
  };

  const activeCount = employees.filter((e) => e.employment_status === 'active').length;

  if (!user || !isManagerOrAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="size-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
          {!user ? 'Loading...' : 'Redirecting...'}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">Employee Directory</h1>
          <p className="text-muted-foreground text-xs mt-0.5">
            {meta?.total !== undefined
              ? `${meta.total} employee${meta.total !== 1 ? 's' : ''} in your organization`
              : 'Manage your organization\'s employees'}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {canInvite && (
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => setInviteOpen(true)}
            >
              <UserPlus className="h-3.5 w-3.5" />
              Invite Employee
            </Button>
          )}
          <Button
            variant={viewMode === 'list' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setViewMode('list')}
            aria-label="List view"
            aria-pressed={viewMode === 'list'}
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setViewMode('grid')}
            aria-label="Grid view"
            aria-pressed={viewMode === 'grid'}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-border">
          <CardContent className="p-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 shrink-0">
                <Users className="h-4 w-4 text-blue-500" />
              </div>
              <div className="min-w-0">
                <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Total</p>
                <p className="text-base font-bold text-foreground tabular-nums leading-tight">{meta?.total ?? employees.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 shrink-0">
                <UserCheck className="h-4 w-4 text-emerald-500" />
              </div>
              <div className="min-w-0">
                <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Active</p>
                <p className="text-base font-bold text-foreground tabular-nums leading-tight">{activeCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 shrink-0">
                <Building2 className="h-4 w-4 text-violet-500" />
              </div>
              <div className="min-w-0">
                <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Departments</p>
                <p className="text-base font-bold text-foreground tabular-nums leading-tight">{new Set(employees.map((e) => e.department?.id).filter(Boolean)).size}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 shrink-0">
                <Briefcase className="h-4 w-4 text-amber-500" />
              </div>
              <div className="min-w-0">
                <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Positions</p>
                <p className="text-base font-bold text-foreground tabular-nums leading-tight">{new Set(employees.map((e) => e.position?.id).filter(Boolean)).size}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter Bar */}
      <Card className="border-border">
        <CardContent className="p-3">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, or ID..."
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-8 h-8 text-xs"
                aria-label="Search employees"
              />
            </div>

            <div className="h-5 w-px bg-border mx-0.5 hidden sm:block" />

            {/* Filter Toggle */}
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
          </div>

          {/* Expandable Filters */}
          {showFilters && (
            <div className="flex items-end gap-3 flex-wrap mt-3 pt-3 border-t border-border/50">
              <div className="grid gap-1">
                <label className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Department</label>
                <div className="w-[170px]">
                  <DepartmentSelect
                    value={departmentId}
                    onChange={(v) => {
                      setDepartmentId(v);
                      handleFilterChange();
                    }}
                    placeholder="All Departments"
                  />
                </div>
              </div>

              <div className="grid gap-1">
                <label className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Status</label>
                <Select
                  value={employmentStatus}
                  onValueChange={(v) => {
                    setEmploymentStatus(v ?? 'all');
                    handleFilterChange();
                  }}
                >
                  <SelectTrigger className="w-[140px] h-8 text-xs" aria-label="Filter by status">
                    <SelectValue placeholder="All Statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">All Statuses</SelectItem>
                      {EMPLOYMENT_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {employmentStatusLabels[s]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1">
                <label className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Type</label>
                <Select
                  value={employmentType}
                  onValueChange={(v) => {
                    setEmploymentType(v ?? 'all');
                    handleFilterChange();
                  }}
                >
                  <SelectTrigger className="w-[130px] h-8 text-xs" aria-label="Filter by type">
                    <SelectValue placeholder="All Types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">All Types</SelectItem>
                      {EMPLOYMENT_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {employmentTypeLabels[t]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Content */}
      {isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-16">
            <div className="flex flex-col items-center text-center gap-3">
              <Users className="size-10 text-destructive/60" />
              <p className="text-muted-foreground font-medium">Failed to load employees</p>
              <p className="text-sm text-muted-foreground">Please try again later.</p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        viewMode === 'grid' ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Skeleton className="size-10 rounded-full shrink-0" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-28" />
                      <Skeleton className="h-3 w-36" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0">
                  <Skeleton className="size-8 rounded-full shrink-0" />
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-24 ml-auto" />
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-5 w-14" />
                </div>
              ))}
            </CardContent>
          </Card>
        )
      ) : employees.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No employees found"
          description={
            debouncedSearch || departmentId || employmentStatus !== 'all' || employmentType !== 'all'
              ? 'Try adjusting your filters to find what you\'re looking for.'
              : 'Employee profiles will appear here once team members are added.'
          }
        />
      ) : viewMode === 'grid' ? (
        /* ── Grid View ── */
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {employees.map((emp) => (
            <div key={emp.id} className="block group cursor-pointer" onClick={() => { setSelectedEmployeeId(emp.id); setModalOpen(true); }}>
              <Card className="transition-all group-hover:border-primary/30 group-hover:shadow-sm h-full">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Avatar className="size-10 shrink-0 ring-2 ring-background">
                      <AvatarImage src={emp.avatar_url ?? undefined} alt={emp.name} />
                      <AvatarFallback className={`bg-gradient-to-br ${getAvatarColor(emp.name)} text-white text-xs font-bold`}>
                        {getInitials(emp.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-semibold text-foreground truncate leading-tight">{emp.name}</p>
                            <RoleBadge role={emp.role} />
                          </div>
                          <p className="text-[0.65rem] text-muted-foreground truncate mt-0.5">{emp.email}</p>
                        </div>
                        <EmploymentStatusDot status={emp.employment_status} />
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-border/50 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[0.65rem] text-muted-foreground">
                      <Building2 className="h-3 w-3 shrink-0" />
                      <span className="truncate">{emp.department?.name ?? 'No department'}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[0.65rem] text-muted-foreground">
                      <Briefcase className="h-3 w-3 shrink-0" />
                      <span className="truncate">{emp.position?.title ?? emp.job_title ?? 'No position'}</span>
                    </div>
                    {emp.shift && (
                      <div className="flex items-center gap-1.5 text-[0.65rem] text-muted-foreground">
                        <span
                          className="size-2 rounded-full shrink-0"
                          style={{ backgroundColor: emp.shift.color ?? '#6366f1' }}
                        />
                        <span className="truncate">{emp.shift.name}</span>
                      </div>
                    )}
                    {emp.work_location && (
                      <div className="flex items-center gap-1.5 text-[0.65rem] text-muted-foreground">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="truncate">{emp.work_location}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      ) : (
        /* ── List View ── */
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-border">
                    <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground w-[220px]">Employee</TableHead>
                    <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground w-[100px]">Role</TableHead>
                    <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground w-[140px]">Department</TableHead>
                    <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground w-[140px]">Position</TableHead>
                    <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground w-[130px]">Shift</TableHead>
                    <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground w-[90px]">Type</TableHead>
                    <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground w-[80px]">Status</TableHead>
                    <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground w-[100px]">Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employees.map((emp) => (
                    <TableRow
                      key={emp.id}
                      className="border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => { setSelectedEmployeeId(emp.id); setModalOpen(true); }}
                    >
                      <TableCell className="py-2">
                        <div className="flex items-center gap-2.5">
                          <Avatar className="size-8 shrink-0">
                            <AvatarImage src={emp.avatar_url ?? undefined} alt={emp.name} />
                            <AvatarFallback className={`bg-gradient-to-br ${getAvatarColor(emp.name)} text-white text-[0.6rem] font-bold`}>
                              {getInitials(emp.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="text-[0.7rem] font-medium text-foreground truncate leading-tight">{emp.name}</p>
                            <p className="text-[0.6rem] text-muted-foreground truncate">{emp.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-2">
                        <RoleBadge role={emp.role} />
                      </TableCell>
                      <TableCell className="py-2">
                        {emp.department ? (
                          <span className="text-[0.7rem] text-foreground">{emp.department.name}</span>
                        ) : (
                          <span className="text-[0.65rem] text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="py-2">
                        {emp.position?.title || emp.job_title ? (
                          <span className="text-[0.7rem] text-foreground">{emp.position?.title ?? emp.job_title}</span>
                        ) : (
                          <span className="text-[0.65rem] text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="py-2">
                        {emp.shift ? (
                          <span className="inline-flex items-center gap-1.5 min-w-0">
                            <span
                              className="size-2 rounded-full shrink-0"
                              style={{ backgroundColor: emp.shift.color ?? '#6366f1' }}
                            />
                            <span className="text-[0.7rem] text-foreground truncate">{emp.shift.name}</span>
                          </span>
                        ) : (
                          <span className="text-[0.65rem] text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="py-2">
                        <Badge variant="outline" className="text-[0.55rem] px-1.5 py-0 h-4 font-medium">
                          {employmentTypeLabels[emp.employment_type] ?? emp.employment_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2">
                        <EmploymentStatusDot status={emp.employment_status} />
                      </TableCell>
                      <TableCell className="text-[0.7rem] text-muted-foreground py-2 tabular-nums">
                        {formatDate(emp.date_of_joining)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {!isLoading && !isError && employees.length > 0 && totalPages > 1 && (
        <Card className="border-border">
          <CardContent className="p-3">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <p className="text-[0.65rem] text-muted-foreground tabular-nums">
                Showing {meta?.from ?? 0}&ndash;{meta?.to ?? 0} of {meta?.total ?? 0} employees
              </p>
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      aria-disabled={page === 1}
                      className={page === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                    .reduce((acc, p, idx, arr) => {
                      if (idx > 0 && p - arr[idx - 1] > 1) acc.push(-1);
                      acc.push(p);
                      return acc;
                    }, [] as number[])
                    .map((p, idx) =>
                      p === -1 ? (
                        <PaginationItem key={`e-${idx}`}>
                          <PaginationEllipsis />
                        </PaginationItem>
                      ) : (
                        <PaginationItem key={p}>
                          <PaginationLink
                            isActive={p === page}
                            onClick={() => setPage(p)}
                            className="cursor-pointer"
                          >
                            {p}
                          </PaginationLink>
                        </PaginationItem>
                      )
                    )}
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      aria-disabled={page === totalPages}
                      className={page === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending Invitations */}
      {canInvite && (
        <Card className="border-border">
          <button
            className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-muted/30 transition-colors rounded-t-lg"
            onClick={() => setInvitesExpanded(!invitesExpanded)}
          >
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Pending Invitations</span>
              {invitations.length > 0 && (
                <Badge variant="secondary" className="h-5 px-1.5 text-[0.6rem]">
                  {invitations.length}
                </Badge>
              )}
            </div>
            {invitesExpanded
              ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
              : <ChevronDown className="h-4 w-4 text-muted-foreground" />
            }
          </button>
          {invitesExpanded && (
            <div className="border-t border-border/50 px-4 py-3">
              {invitesLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : invitations.length === 0 ? (
                <p className="text-xs text-muted-foreground">No pending invitations.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[140px]">Name</TableHead>
                      <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[200px]">Email</TableHead>
                      <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[90px]">Role</TableHead>
                      <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[110px]">Invited By</TableHead>
                      <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[90px]">Expires</TableHead>
                      <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[160px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invitations.map((inv) => (
                      <TableRow key={inv.id} className="border-border/50 hover:bg-muted/30">
                        <TableCell className="text-[0.7rem] font-medium py-2">{inv.name || '--'}</TableCell>
                        <TableCell className="text-[0.7rem] py-2">{inv.email}</TableCell>
                        <TableCell className="py-2">
                          <Badge variant="outline" className="text-[0.6rem] px-1.5 py-0">
                            {formatRoleLabel(inv.role)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-[0.7rem] text-muted-foreground py-2">
                          {inv.creator?.name || '--'}
                        </TableCell>
                        <TableCell className="text-[0.7rem] text-muted-foreground py-2">
                          {formatDate(inv.expires_at)}
                        </TableCell>
                        <TableCell className="text-right py-2">
                          <div className="inline-flex items-center gap-1">
                            <Button variant="ghost" size="sm" className="h-6 px-2 text-[0.6rem]" onClick={() => copyInviteLink(inv.token)}>
                              <Copy className="h-3 w-3 mr-1" />
                              Copy
                            </Button>
                            <Button variant="ghost" size="sm" className="h-6 px-2 text-[0.6rem]" disabled={resendMutation.isPending} onClick={() => resendMutation.mutate(inv.id)}>
                              <RefreshCw className="h-3 w-3 mr-1" />
                              Resend
                            </Button>
                            <Button variant="ghost" size="sm" className="h-6 px-2 text-[0.6rem] text-destructive hover:text-destructive" disabled={revokeMutation.isPending} onClick={() => revokeMutation.mutate(inv.id)}>
                              <Trash2 className="h-3 w-3 mr-1" />
                              Revoke
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Employee Detail Modal */}
      <EmployeeDetailModal
        employeeId={selectedEmployeeId}
        open={modalOpen}
        onOpenChange={(open) => { setModalOpen(open); if (!open) setSelectedEmployeeId(null); }}
      />

      {/* Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={(open) => { setInviteOpen(open); if (!open) setInviteErrors({}); }}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleInvite}>
            <DialogHeader>
              <DialogTitle className="text-base">Invite Employee</DialogTitle>
              <DialogDescription className="text-xs">
                Send an invitation email to onboard a new employee.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-4">
              <div className="grid gap-1.5">
                <Label htmlFor="invite-name" className="text-xs">Full name</Label>
                <Input
                  id="invite-name"
                  type="text"
                  placeholder="e.g. John Doe"
                  value={inviteName}
                  onChange={(e) => { setInviteName(e.target.value); if (inviteErrors.name) setInviteErrors((prev) => ({ ...prev, name: undefined })); }}
                  aria-invalid={!!inviteErrors.name}
                  className={`h-8 text-sm ${inviteErrors.name ? 'border-destructive' : ''}`}
                  required
                />
                {inviteErrors.name && <p className="text-[0.65rem] text-destructive">{inviteErrors.name}</p>}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="invite-email" className="text-xs">Email address</Label>
                <div className="relative">
                  <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    id="invite-email"
                    type="email"
                    placeholder="colleague@company.com"
                    value={inviteEmail}
                    onChange={(e) => { setInviteEmail(e.target.value); if (inviteErrors.email) setInviteErrors((prev) => ({ ...prev, email: undefined })); }}
                    aria-invalid={!!inviteErrors.email}
                    className={`h-8 pl-8 text-sm ${inviteErrors.email ? 'border-destructive' : ''}`}
                    required
                  />
                </div>
                {inviteErrors.email && <p className="text-[0.65rem] text-destructive">{inviteErrors.email}</p>}
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Role</Label>
                <Select
                  value={inviteRole}
                  onValueChange={(val) => { setInviteRole(val ?? 'employee'); if (inviteErrors.role) setInviteErrors((prev) => ({ ...prev, role: undefined })); }}
                >
                  <SelectTrigger className={`h-8 w-full text-sm ${inviteErrors.role ? 'border-destructive' : ''}`} aria-invalid={!!inviteErrors.role}>
                    <span data-slot="select-value" className="flex flex-1 text-left">{formatRoleLabel(inviteRole)}</span>
                  </SelectTrigger>
                  <SelectContent>
                    {user?.role === 'owner' && <SelectItem value="owner">Owner</SelectItem>}
                    <SelectItem value="org_manager">Org Manager</SelectItem>
                    <SelectItem value="hr_manager">HR Manager</SelectItem>
                    <SelectItem value="finance_manager">Finance Manager</SelectItem>
                    <SelectItem value="employee">Employee</SelectItem>
                  </SelectContent>
                </Select>
                {inviteErrors.role && <p className="text-[0.65rem] text-destructive">{inviteErrors.role}</p>}
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setInviteOpen(false)} disabled={inviteMutation.isPending}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={inviteMutation.isPending}>
                {inviteMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                Send Invitation
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
