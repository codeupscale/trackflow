'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FolderOpen,
  Plus,
  Loader2,
  MoreHorizontal,
  Archive,
  Pencil,
  Trash2,
  Users,
  Search,
  DollarSign,
  ChevronsUpDown,
  Shield,
  ArchiveRestore,
  CircleDot,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import api from '@/lib/api';
import type { UserRole } from '@/lib/roles';
import { useAuthStore } from '@/stores/auth-store';
import { usePermissionStore } from '@/stores/permission-store';

interface Task {
  id: string;
  name: string;
}

interface MemberUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar_url?: string | null;
}

interface Project {
  id: string;
  name: string;
  color: string;
  billable: boolean;
  hourly_rate: number | null;
  is_archived: boolean;
  tasks: Task[];
  created_at: string;
  manager_id: string | null;
  manager?: {
    id: string;
    name: string;
    email: string;
  } | null;
}

const COLORS = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
  '#EC4899', '#06B6D4', '#F97316',
];

export default function ProjectsPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [membersDialogOpen, setMembersDialogOpen] = useState(false);
  const [membersProject, setMembersProject] = useState<Project | null>(null);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [initialMemberIds, setInitialMemberIds] = useState<string[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [formName, setFormName] = useState('');
  const [formColor, setFormColor] = useState('#3B82F6');
  const [formBillable, setFormBillable] = useState(false);
  const [formRate, setFormRate] = useState('');
  const [formManagerId, setFormManagerId] = useState<string | null>(null);
  const [formMemberIds, setFormMemberIds] = useState<string[]>([]);
  const [managerComboboxOpen, setManagerComboboxOpen] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const PER_PAGE = 12;

  const { hasPermission } = usePermissionStore();
  const canCreateProjects = hasPermission('projects.create');
  const canUpdateProjects = canCreateProjects;
  const canDeleteProjects = hasPermission('projects.delete');
  const canManageMembers = hasPermission('projects.manage_members');
  const isOwner = user?.role === 'owner';

  // Debounce search to avoid hammering backend
  const debounceTimer = useState<NodeJS.Timeout | null>(null);
  const handleSearch = useCallback((value: string) => {
    setSearchQuery(value);
    if (debounceTimer[0]) clearTimeout(debounceTimer[0]);
    debounceTimer[0] = setTimeout(() => {
      setDebouncedSearch(value);
      setCurrentPage(1);
    }, 300);
  }, [debounceTimer]);

  // Server-side search + pagination
  const { data: paginatedData, isLoading, isError: isProjectsError } = useQuery({
    queryKey: ['projects', currentPage, debouncedSearch],
    queryFn: async () => {
      const params: Record<string, string | number> = { per_page: PER_PAGE, page: currentPage };
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
      const res = await api.get('/projects', { params });
      return res.data;
    },
  });

  const projects: Project[] = paginatedData?.data || [];
  const totalPages = paginatedData?.last_page || 1;
  const totalCount = paginatedData?.total || 0;
  const from = paginatedData?.from || 0;
  const to = paginatedData?.to || 0;

  const { data: orgUsers } = useQuery<MemberUser[]>({
    queryKey: ['org-users'],
    enabled: canManageMembers && (membersDialogOpen || dialogOpen),
    queryFn: async () => {
      const res = await api.get('/users', { params: { per_page: 200 } });
      // backend is apiResource paginate; normalize
      return res.data.data || res.data.users || res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      return api.post('/projects', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      // BUG-008: Also invalidate 'projects-list' used by time page and other components
      queryClient.invalidateQueries({ queryKey: ['projects-list'] });
      closeDialog();
      toast.success('Project created');
    },
    onError: (err: unknown) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const message = (err as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
        ?? (err as { message?: string })?.message;
      if (status === 403) {
        toast.error('You don\'t have permission to create projects.');
      } else {
        toast.error(message || 'Failed to create project');
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; [key: string]: unknown }) => {
      return api.put(`/projects/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['projects-list'] });
      closeDialog();
      toast.success('Project updated');
    },
    onError: () => toast.error('Failed to update project'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return api.delete(`/projects/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['projects-list'] });
      toast.success('Project deleted');
    },
    onError: () => toast.error('Failed to delete project'),
  });

  const syncMembersMutation = useMutation({
    mutationFn: async ({ projectId, userIds }: { projectId: string; userIds: string[] }) => {
      return api.put(`/projects/${projectId}/members`, { user_ids: userIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Project members updated');
      setMembersDialogOpen(false);
      setMembersProject(null);
      setMemberIds([]);
    },
    onError: (err: unknown) => {
      toast.error((err as { message?: string })?.message || 'Failed to update members');
    },
  });

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingProject(null);
    setFormName('');
    setFormColor('#3B82F6');
    setFormBillable(false);
    setFormRate('');
    setFormManagerId(null);
    setFormMemberIds([]);
  };

  const openMembers = (project: Project) => {
    setMembersProject(project);
    setMembersDialogOpen(true);
    setMemberIds([]);
    setInitialMemberIds([]);
    setMemberSearch('');
    api.get(`/projects/${project.id}/members`)
      .then((res) => {
        const members = (res.data?.members || []) as MemberUser[];
        const ids = members.map((m) => m.id);
        setMemberIds(ids);
        setInitialMemberIds(ids);
      })
      .catch((err: unknown) => {
        toast.error((err as { message?: string })?.message || 'Failed to load project members');
      });
  };

  const openCreate = () => {
    setEditingProject(null);
    setFormName('');
    setFormColor('#3B82F6');
    setFormBillable(false);
    setFormRate('');
    setFormManagerId(null);
    setFormMemberIds([]);
    setDialogOpen(true);
  };

  const openEdit = (project: Project) => {
    setEditingProject(project);
    setFormName(project.name);
    setFormColor(project.color);
    setFormBillable(project.billable);
    setFormRate(project.hourly_rate?.toString() || '');
    setFormManagerId(project.manager_id);
    // Load current members for editing
    setFormMemberIds([]);
    api.get(`/projects/${project.id}/members`)
      .then((res) => {
        const members = (res.data?.members || []) as MemberUser[];
        setFormMemberIds(members.map((m) => m.id));
      })
      .catch(() => {});
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: Record<string, unknown> = {
      name: formName,
      color: formColor,
      billable: formBillable,
      hourly_rate: formBillable && formRate ? parseFloat(formRate) : undefined,
      manager_id: formManagerId || null,
      member_ids: formMemberIds.length > 0 ? formMemberIds : undefined,
    };
    if (editingProject) {
      updateMutation.mutate({ id: editingProject.id, ...data });
    } else {
      createMutation.mutate(data);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  // Derive stats from loaded projects
  const activeCount = projects.filter((p) => !p.is_archived).length;
  const archivedCount = projects.filter((p) => p.is_archived).length;
  const billableCount = projects.filter((p) => p.billable).length;

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Projects</h1>
          <p className="text-xs text-muted-foreground">
            Manage your projects and tasks
          </p>
        </div>
        {canCreateProjects && (
          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={openCreate}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            New Project
          </Button>
        )}
      </div>

      {/* Stats Strip */}
      <div className={`grid grid-cols-2 ${isOwner ? 'sm:grid-cols-4' : 'sm:grid-cols-3'} gap-3`}>
        {[
          { label: 'Total Projects', value: totalCount, icon: FolderOpen, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Active', value: activeCount, icon: CircleDot, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          { label: 'Archived', value: archivedCount, icon: Archive, color: 'text-red-500', bg: 'bg-red-500/10' },
          ...(isOwner ? [{ label: 'Billable', value: billableCount, icon: DollarSign, color: 'text-amber-500', bg: 'bg-amber-500/10' }] : []),
        ].map((s) => (
          <Card key={s.label} className="border-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-2.5">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${s.bg} shrink-0`}>
                  <s.icon className={`h-4 w-4 ${s.color}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">{s.label}</p>
                  <p className="text-base font-bold text-foreground tabular-nums leading-tight">{isLoading ? '--' : s.value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search projects..."
          className="h-8 pl-8 text-xs"
        />
      </div>

      {/* Projects Table */}
      {isProjectsError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-16">
            <div className="flex flex-col items-center text-center gap-3">
              <FolderOpen className="size-10 text-destructive/60" />
              <p className="text-muted-foreground font-medium">Failed to load projects</p>
              <p className="text-xs text-muted-foreground">Please try again later.</p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-col">
              <div className="flex items-center gap-4 px-4 py-2 border-b border-border/50">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-3 w-20" />
                ))}
              </div>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0">
                  <Skeleton className="h-3 w-3 rounded-full" />
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3.5 w-20" />
                  <Skeleton className="h-3.5 w-16" />
                  <Skeleton className="h-3.5 w-14" />
                  <Skeleton className="h-3.5 w-10" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : !projects || projects.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center gap-2">
              <FolderOpen className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">
                {!canCreateProjects ? 'No projects assigned' : 'No projects yet'}
              </p>
              <p className="text-xs text-muted-foreground">
                {!canCreateProjects
                  ? 'Ask your manager to assign you to a project.'
                  : 'Create your first project to start tracking time'}
              </p>
              {canCreateProjects && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 text-xs"
                  onClick={openCreate}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Create Project
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2">Name</TableHead>
                      <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2 w-[100px]">Status</TableHead>
                      {isOwner && (
                        <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2 w-[120px]">Billing</TableHead>
                      )}
                      <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2 w-[90px] text-center">Members</TableHead>
                      <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2 w-[140px]">Manager</TableHead>
                      <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2 w-[50px]">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projects.map((project) => (
                      <TableRow
                        key={project.id}
                        className={`border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors ${
                          project.is_archived ? 'opacity-60' : ''
                        }`}
                      >
                        <TableCell className="px-4 py-2">
                          <div className="flex items-center gap-2.5">
                            <div
                              className="h-3 w-3 rounded-full shrink-0"
                              style={{ backgroundColor: project.color }}
                            />
                            <span className="text-[0.75rem] font-medium text-foreground truncate max-w-[200px]">
                              {project.name}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="px-4 py-2">
                          {project.is_archived ? (
                            <span className="inline-flex items-center gap-1.5 text-[0.65rem] text-red-600 dark:text-red-400">
                              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
                              Archived
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-[0.65rem] text-emerald-600 dark:text-emerald-400">
                              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              Active
                            </span>
                          )}
                        </TableCell>
                        {isOwner && (
                          <TableCell className="px-4 py-2">
                            {project.billable ? (
                              <span className="text-[0.75rem] text-foreground">
                                {project.hourly_rate ? `$${project.hourly_rate}/hr` : 'Billable'}
                              </span>
                            ) : (
                              <span className="text-[0.75rem] text-muted-foreground">
                                Non-billable
                              </span>
                            )}
                          </TableCell>
                        )}
                        <TableCell className="px-4 py-2 text-[0.75rem] text-muted-foreground tabular-nums text-center">
                          {String((project as unknown as { members_count?: number }).members_count ?? 0)}
                        </TableCell>
                        <TableCell className="px-4 py-2 text-[0.75rem] text-muted-foreground truncate max-w-[120px]">
                          {project.manager?.name || '--'}
                        </TableCell>
                        <TableCell className="px-4 py-2">
                          {(canManageMembers || canUpdateProjects || canDeleteProjects) && (
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                className="inline-flex items-center justify-center rounded-md size-7 hover:bg-muted text-muted-foreground"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {canManageMembers && (
                                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openMembers(project); }}>
                                    <Users className="mr-2 h-3.5 w-3.5" />
                                    Members
                                  </DropdownMenuItem>
                                )}
                                {canUpdateProjects && (
                                  <>
                                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEdit(project); }}>
                                      <Pencil className="mr-2 h-3.5 w-3.5" />
                                      Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        updateMutation.mutate({ id: project.id, is_archived: !project.is_archived });
                                      }}
                                    >
                                      {project.is_archived ? (
                                        <>
                                          <ArchiveRestore className="mr-2 h-3.5 w-3.5" />
                                          Unarchive
                                        </>
                                      ) : (
                                        <>
                                          <Archive className="mr-2 h-3.5 w-3.5" />
                                          Archive
                                        </>
                                      )}
                                    </DropdownMenuItem>
                                  </>
                                )}
                                {canDeleteProjects && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      variant="destructive"
                                      onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(project.id); }}
                                    >
                                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                                      Delete
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

        </>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-[0.65rem] text-muted-foreground">
            Showing {from}&ndash;{to} of {totalCount} projects
          </p>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  aria-disabled={currentPage === 1}
                  className={currentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                />
              </PaginationItem>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
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
                        isActive={p === currentPage}
                        onClick={() => setCurrentPage(p)}
                        className="cursor-pointer"
                      >
                        {p}
                      </PaginationLink>
                    </PaginationItem>
                  ),
                )}
              <PaginationItem>
                <PaginationNext
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  aria-disabled={currentPage === totalPages}
                  className={currentPage === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                  <FolderOpen className="h-3.5 w-3.5 text-primary" />
                </div>
                <div>
                  <DialogTitle className="text-base">{editingProject ? 'Edit Project' : 'New Project'}</DialogTitle>
                  <DialogDescription className="text-xs">
                    {editingProject ? 'Update project details.' : 'Create a new project to track time against.'}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-4">
              <div className="grid gap-1.5">
                <Label htmlFor="project-name" className="text-xs">Name</Label>
                <Input
                  id="project-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Project name"
                  className="h-9 text-sm"
                  required
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Color</Label>
                <div className="flex gap-2">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setFormColor(c)}
                      className={`h-7 w-7 rounded-full transition-all ${
                        formColor === c
                          ? 'ring-2 ring-offset-2 ring-offset-background ring-primary scale-110'
                          : 'hover:scale-105'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              {isOwner && (
                <>
                  <div className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div>
                      <Label className="text-xs">Billable</Label>
                      <p className="text-[0.65rem] text-muted-foreground">Track billable hours for this project</p>
                    </div>
                    <Switch
                      checked={formBillable}
                      onCheckedChange={setFormBillable}
                    />
                  </div>
                  {formBillable && (
                    <div className="grid gap-1.5">
                      <Label htmlFor="hourly-rate" className="text-xs">Hourly Rate ($)</Label>
                      <Input
                        id="hourly-rate"
                        type="number"
                        min="0"
                        step="0.01"
                        value={formRate}
                        onChange={(e) => setFormRate(e.target.value)}
                        placeholder="0.00"
                        className="h-9 text-sm"
                      />
                    </div>
                  )}
                </>
              )}

              {/* Manager */}
              {canManageMembers && (
                <div className="grid gap-1.5">
                  <Label className="text-xs">Manager</Label>
                  <Popover open={managerComboboxOpen} onOpenChange={setManagerComboboxOpen}>
                    <PopoverTrigger
                      render={
                        <Button
                          variant="outline"
                          className="w-full justify-between font-normal h-9 text-sm"
                        />
                      }
                    >
                      <span className="truncate">
                        {formManagerId
                          ? orgUsers?.find((u) => u.id === formManagerId)?.name ?? 'Select manager...'
                          : 'No manager'}
                      </span>
                      <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                    </PopoverTrigger>
                    <PopoverContent className="w-[300px] p-0">
                      <Command>
                        <CommandInput placeholder="Search members..." />
                        <CommandList>
                          <CommandEmpty>No members found.</CommandEmpty>
                          <CommandGroup>
                            <CommandItem
                              value="none"
                              data-checked={!formManagerId ? true : undefined}
                              onSelect={() => {
                                setFormManagerId(null);
                                setManagerComboboxOpen(false);
                              }}
                            >
                              No manager
                            </CommandItem>
                            {orgUsers
                              ?.filter((u) => u.role !== 'employee')
                              .map((u) => (
                                <CommandItem
                                  key={u.id}
                                  value={u.name}
                                  data-checked={formManagerId === u.id ? true : undefined}
                                  onSelect={() => {
                                    setFormManagerId(u.id);
                                    setManagerComboboxOpen(false);
                                  }}
                                >
                                  <div className="flex flex-col">
                                    <span className="text-sm">{u.name}</span>
                                    <span className="text-xs text-muted-foreground">{u.email}</span>
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

              {/* Members Multi-select */}
              {canManageMembers && (
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Members</Label>
                    <span className="text-[0.65rem] text-muted-foreground">{formMemberIds.length} selected</span>
                  </div>
                  <div className="rounded-lg border border-border max-h-[180px] overflow-y-auto">
                    {!orgUsers ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        <span className="ml-2 text-xs text-muted-foreground">Loading...</span>
                      </div>
                    ) : (
                      [...orgUsers].sort((a, b) => a.name.localeCompare(b.name)).map((u) => {
                        const checked = formMemberIds.includes(u.id);
                        return (
                          <label
                            key={u.id}
                            className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors border-b border-border/50 last:border-b-0 ${
                              checked ? 'bg-primary/8 hover:bg-primary/12' : 'hover:bg-muted/50'
                            }`}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(val) => {
                                setFormMemberIds(
                                  val
                                    ? [...formMemberIds, u.id]
                                    : formMemberIds.filter((id) => id !== u.id)
                                );
                              }}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="text-[0.75rem] font-medium text-foreground truncate">{u.name}</div>
                              <div className="text-[0.65rem] text-muted-foreground truncate">{u.email}</div>
                            </div>
                            <Badge
                              variant={u.role === 'owner' ? 'default' : 'secondary'}
                              className="text-[10px] shrink-0"
                            >
                              {u.role}
                            </Badge>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" size="sm" onClick={closeDialog}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isPending}>
                {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                {editingProject ? 'Save Changes' : 'Create Project'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Members Dialog */}
      <Dialog
        open={membersDialogOpen}
        onOpenChange={(open) => {
          setMembersDialogOpen(open);
          if (!open) {
            setMembersProject(null);
            setMemberIds([]);
            setMemberSearch('');
          }
        }}
      >
        <DialogContent className="sm:max-w-md flex flex-col max-h-[90vh]">
          <DialogHeader className="shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                <Users className="h-3.5 w-3.5 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-base">Project Members</DialogTitle>
                <DialogDescription className="text-xs">
                  Assign team members to <span className="font-medium text-foreground">{membersProject?.name}</span>
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="flex flex-col gap-3 min-h-0 flex-1">
            {/* Search */}
            <div className="relative shrink-0">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Search members..."
                className="h-8 pl-8 text-xs"
              />
            </div>

            {/* Stats bar */}
            <div className="flex items-center justify-between text-xs text-muted-foreground shrink-0">
              <span>{memberIds.length} assigned of {orgUsers?.length ?? 0} members</span>
              {orgUsers && orgUsers.length > 0 && (
                <button
                  type="button"
                  className="text-primary hover:text-primary/80 font-medium transition-colors text-xs"
                  onClick={() => {
                    const filtered = (orgUsers || []).filter((u) => {
                      if (!memberSearch.trim()) return true;
                      const q = memberSearch.toLowerCase();
                      return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
                    });
                    const allFilteredSelected = filtered.every((u) => memberIds.includes(u.id));
                    if (allFilteredSelected) {
                      setMemberIds(memberIds.filter((id) => !filtered.some((u) => u.id === id)));
                    } else {
                      const newIds = new Set([...memberIds, ...filtered.map((u) => u.id)]);
                      setMemberIds([...newIds]);
                    }
                  }}
                >
                  {(() => {
                    const filtered = (orgUsers || []).filter((u) => {
                      if (!memberSearch.trim()) return true;
                      const q = memberSearch.toLowerCase();
                      return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
                    });
                    return filtered.every((u) => memberIds.includes(u.id)) ? 'Deselect all' : 'Select all';
                  })()}
                </button>
              )}
            </div>

            {/* Members list */}
            <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-border">
              {!orgUsers ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-xs text-muted-foreground">Loading members...</span>
                </div>
              ) : (() => {
                const q = memberSearch.toLowerCase().trim();
                const filtered = orgUsers.filter((u) =>
                  !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.role.includes(q)
                );
                // Sort alphabetically only -- stable, no jumping when checking/unchecking
                const sorted = [...filtered].sort((a, b) => a.name.localeCompare(b.name));

                if (sorted.length === 0) {
                  return (
                    <div className="py-8 text-center text-xs text-muted-foreground">
                      No members match &ldquo;{memberSearch}&rdquo;
                    </div>
                  );
                }

                return sorted.map((u) => {
                  const checked = memberIds.includes(u.id);
                  const initials = u.name
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2);
                  return (
                    <label
                      key={u.id}
                      className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors border-b border-border/50 last:border-b-0 ${
                        checked ? 'bg-primary/8 hover:bg-primary/12' : 'hover:bg-muted/50'
                      }`}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(val) => {
                          setMemberIds(
                            val
                              ? [...memberIds, u.id]
                              : memberIds.filter((id) => id !== u.id)
                          );
                        }}
                        aria-label={`Select ${u.name}`}
                      />
                      <div
                        className={`size-8 rounded-full flex items-center justify-center text-xs font-medium shrink-0 ${
                          checked ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {initials}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[0.75rem] font-medium text-foreground truncate">{u.name}</div>
                        <div className="text-[0.65rem] text-muted-foreground truncate">{u.email}</div>
                      </div>
                      <Badge
                        variant={u.role === 'owner' ? 'default' : 'secondary'}
                        className="text-[10px] shrink-0"
                      >
                        {u.role}
                      </Badge>
                    </label>
                  );
                });
              })()}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0 shrink-0 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setMembersDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!membersProject?.id || syncMembersMutation.isPending || (
                memberIds.length === initialMemberIds.length &&
                memberIds.every((id) => initialMemberIds.includes(id))
              )}
              onClick={() => {
                if (!membersProject?.id) return;
                syncMembersMutation.mutate({ projectId: membersProject.id, userIds: memberIds });
              }}
            >
              {syncMembersMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {(() => {
                const added = memberIds.filter((id) => !initialMemberIds.includes(id)).length;
                const removed = initialMemberIds.filter((id) => !memberIds.includes(id)).length;
                if (added === 0 && removed === 0) return 'No changes';
                const parts = [];
                if (added > 0) parts.push(`+${added}`);
                if (removed > 0) parts.push(`-${removed}`);
                return `Save (${parts.join(', ')})`;
              })()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
