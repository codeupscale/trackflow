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
} from 'lucide-react';
import { SearchInput } from '@/components/ui/search-input';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import api from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';

interface Task {
  id: string;
  name: string;
}

interface MemberUser {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'manager' | 'employee';
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
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [membersDialogOpen, setMembersDialogOpen] = useState(false);
  const [membersProject, setMembersProject] = useState<Project | null>(null);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [initialMemberIds, setInitialMemberIds] = useState<string[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [formName, setFormName] = useState('');
  const [formColor, setFormColor] = useState('#3B82F6');
  const [formBillable, setFormBillable] = useState(false);
  const [formRate, setFormRate] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const PER_PAGE = 12;

  const canCreateProjects = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'manager';
  const canUpdateProjects = canCreateProjects;
  const canDeleteProjects = user?.role === 'owner' || user?.role === 'admin';
  const canManageMembers = canUpdateProjects;

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
    enabled: canManageMembers && membersDialogOpen,
    queryFn: async () => {
      const res = await api.get('/users', { params: { per_page: 200 } });
      // backend is apiResource paginate; normalize
      return res.data.data || res.data.users || res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; color: string; billable: boolean; hourly_rate?: number }) => {
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
    mutationFn: async ({ id, ...data }: { id: string; name?: string; color?: string; billable?: boolean; hourly_rate?: number | null; is_archived?: boolean }) => {
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
    setDialogOpen(true);
  };

  const openEdit = (project: Project) => {
    setEditingProject(project);
    setFormName(project.name);
    setFormColor(project.color);
    setFormBillable(project.billable);
    setFormRate(project.hourly_rate?.toString() || '');
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      name: formName,
      color: formColor,
      billable: formBillable,
      hourly_rate: formBillable && formRate ? parseFloat(formRate) : undefined,
    };
    if (editingProject) {
      updateMutation.mutate({ id: editingProject.id, ...data });
    } else {
      createMutation.mutate(data);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Projects</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your projects and tasks</p>
        </div>
        {canCreateProjects && (
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Button>
        )}
      </div>

      {/* Search */}
      <SearchInput
        value={searchQuery}
        onChange={handleSearch}
        placeholder="Search projects..."
      />

      {/* Projects Grid */}
      {isProjectsError ? (
        <Card className="border-border bg-card">
          <CardContent className="py-16">
            <div className="text-center">
              <FolderOpen className="h-10 w-10 text-red-500/60 mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">Failed to load projects</p>
              <p className="text-sm text-muted-foreground mt-1">
                Please try again.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="border-border bg-card">
              <CardContent className="p-6">
                <div className="h-32 bg-muted rounded animate-pulse" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : !projects || projects.length === 0 ? (
        <Card className="border-border bg-card">
          <CardContent className="py-16">
            <div className="text-center">
              <FolderOpen className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">
                {user?.role === 'employee' ? 'No projects assigned' : 'No projects yet'}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {user?.role === 'employee'
                  ? 'Ask your manager to assign you to a project.'
                  : 'Create your first project to start tracking time'}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Card
              key={project.id}
              className={`border-border bg-card transition-all hover:border-border cursor-pointer ${
                project.is_archived ? 'opacity-60' : ''
              }`}
              onClick={() =>
                setExpandedProject(expandedProject === project.id ? null : project.id)
              }
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="h-4 w-4 rounded-full shrink-0"
                      style={{ backgroundColor: project.color }}
                    />
                    <div>
                      <CardTitle className="text-base text-foreground">{project.name}</CardTitle>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="inline-flex items-center justify-center rounded-md h-8 w-8 hover:bg-muted text-muted-foreground"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {canManageMembers && (
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openMembers(project); }}>
                          <Users className="mr-2 h-4 w-4" />
                          Members
                        </DropdownMenuItem>
                      )}
                      {canUpdateProjects && (
                        <>
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEdit(project); }}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              updateMutation.mutate({ id: project.id, is_archived: !project.is_archived });
                            }}
                          >
                            <Archive className="mr-2 h-4 w-4" />
                            {project.is_archived ? 'Unarchive' : 'Archive'}
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
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <FolderOpen className="h-3.5 w-3.5" />
                    <span>{project.tasks?.length || 0} tasks</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                    <span>{String((project as unknown as { members_count?: number }).members_count ?? 0)} members</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-3">
                  {project.billable ? (
                    <Badge variant="default" className="text-xs">
                      <DollarSign className="h-3 w-3 mr-0.5" />
                      {project.hourly_rate ? `$${project.hourly_rate}/hr` : 'Billable'}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs">
                      Non-billable
                    </Badge>
                  )}
                  {project.is_archived && (
                    <Badge variant="outline" className="text-xs">
                      Archived
                    </Badge>
                  )}
                </div>

                {/* Expanded tasks */}
                {expandedProject === project.id && project.tasks && project.tasks.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-border">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Tasks</p>
                    <div className="space-y-1">
                      {project.tasks.map((task) => (
                        <div key={task.id} className="text-sm text-foreground flex items-center gap-2">
                          <div className="h-1 w-1 rounded-full bg-muted-foreground" />
                          {task.name}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
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
        <DialogContent className="bg-card border-border">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle className="text-foreground">{editingProject ? 'Edit Project' : 'New Project'}</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {editingProject ? 'Update project details.' : 'Create a new project to track time against.'}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="project-name" className="text-foreground">Name</Label>
                <Input
                  id="project-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Project name"
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-foreground">Color</Label>
                <div className="flex gap-2">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setFormColor(c)}
                      className={`h-8 w-8 rounded-full transition-all ${
                        formColor === c
                          ? 'ring-2 ring-offset-2 ring-offset-background ring-blue-500 scale-110'
                          : 'hover:scale-105'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-foreground">Billable</Label>
                  <p className="text-xs text-muted-foreground">Track billable hours for this project</p>
                </div>
                <Switch
                  checked={formBillable}
                  onCheckedChange={setFormBillable}
                />
              </div>
              {formBillable && (
                <div className="grid gap-2">
                  <Label htmlFor="hourly-rate" className="text-foreground">Hourly Rate ($)</Label>
                  <Input
                    id="hourly-rate"
                    type="number"
                    min="0"
                    step="0.01"
                    value={formRate}
                    onChange={(e) => setFormRate(e.target.value)}
                    placeholder="0.00"
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog} className="border-border text-foreground">
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
        <DialogContent className="bg-card border-border sm:max-w-md flex flex-col max-h-[90vh]">
          <DialogHeader className="shrink-0">
            <DialogTitle className="text-foreground">Project Members</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Assign team members to <span className="font-medium text-foreground">{membersProject?.name}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 min-h-0 flex-1">
            {/* Search */}
            <SearchInput
              value={memberSearch}
              onChange={setMemberSearch}
              placeholder="Search members..."
              className="shrink-0"
            />

            {/* Stats bar */}
            <div className="flex items-center justify-between text-xs text-muted-foreground shrink-0">
              <span>{memberIds.length} assigned of {orgUsers?.length ?? 0} members</span>
              {orgUsers && orgUsers.length > 0 && (
                <button
                  type="button"
                  className="text-primary hover:text-primary/80 font-medium transition-colors"
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
                  <span className="ml-2 text-sm text-muted-foreground">Loading members...</span>
                </div>
              ) : (() => {
                const q = memberSearch.toLowerCase().trim();
                const filtered = orgUsers.filter((u) =>
                  !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.role.includes(q)
                );
                // Sort alphabetically only — stable, no jumping when checking/unchecking
                const sorted = [...filtered].sort((a, b) => a.name.localeCompare(b.name));

                if (sorted.length === 0) {
                  return (
                    <div className="py-8 text-center text-sm text-muted-foreground">
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
                      className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors border-b border-border last:border-b-0 ${
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
                        <div className="text-sm font-medium text-foreground truncate">{u.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{u.email}</div>
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
              onClick={() => setMembersDialogOpen(false)}
              className="border-border text-foreground"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!membersProject?.id || syncMembersMutation.isPending || (
                memberIds.length === initialMemberIds.length &&
                memberIds.every((id) => initialMemberIds.includes(id))
              )}
              onClick={() => {
                if (!membersProject?.id) return;
                syncMembersMutation.mutate({ projectId: membersProject.id, userIds: memberIds });
              }}
            >
              {syncMembersMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
