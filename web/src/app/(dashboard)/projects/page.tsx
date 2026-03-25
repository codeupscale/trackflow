'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FolderOpen,
  Plus,
  Loader2,
  MoreHorizontal,
  Archive,
  Pencil,
  Trash2,
  Clock,
  DollarSign,
  Users,
} from 'lucide-react';
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
  total_hours: number;
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
  const [formName, setFormName] = useState('');
  const [formColor, setFormColor] = useState('#3B82F6');
  const [formBillable, setFormBillable] = useState(false);
  const [formRate, setFormRate] = useState('');

  const canCreateProjects = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'manager';
  const canUpdateProjects = canCreateProjects;
  const canDeleteProjects = user?.role === 'owner' || user?.role === 'admin';
  const canManageMembers = canUpdateProjects; // backend uses ProjectPolicy::update

  const { data: projects, isLoading, isError: isProjectsError } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: async () => {
      const res = await api.get('/projects');
      return res.data.projects || res.data.data || res.data;
    },
  });

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
    api.get(`/projects/${project.id}/members`)
      .then((res) => {
        const members = (res.data?.members || []) as MemberUser[];
        setMemberIds(members.map((m) => m.id));
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
          <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 text-foreground">
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Button>
        )}
      </div>

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
                    <Clock className="h-3.5 w-3.5" />
                    <span>{(project.total_hours || 0).toFixed(1)}h</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-3">
                  {project.billable ? (
                    <Badge className="bg-green-500/10 text-green-400 border-green-500/20 text-xs">
                      <DollarSign className="h-3 w-3 mr-0.5" />
                      {project.hourly_rate ? `$${project.hourly_rate}/hr` : 'Billable'}
                    </Badge>
                  ) : (
                    <Badge className="bg-muted text-muted-foreground border-border text-xs">
                      Non-billable
                    </Badge>
                  )}
                  {project.is_archived && (
                    <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-xs">
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
                  className="bg-muted border-border text-white placeholder:text-muted-foreground"
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
                    className="bg-muted border-border text-white placeholder:text-muted-foreground"
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog} className="border-border text-foreground">
                Cancel
              </Button>
              <Button type="submit" disabled={isPending} className="bg-blue-600 hover:bg-blue-700 text-foreground">
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
          }
        }}
      >
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Project Members</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Assign team members to <span className="text-foreground">{membersProject?.name}</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-2">
            <div className="text-sm text-muted-foreground">
              {orgUsers ? `${orgUsers.length} users` : 'Loading users...'}
            </div>

            <div className="max-h-[320px] overflow-y-auto rounded-md border border-border bg-muted">
              <div className="divide-y divide-slate-800">
                {(orgUsers || []).map((u) => {
                  const checked = memberIds.includes(u.id);
                  return (
                    <label
                      key={u.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-muted cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="text-foreground truncate">{u.name}</div>
                        <div className="text-muted-foreground truncate">{u.email} • {u.role}</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...memberIds, u.id]
                            : memberIds.filter((id) => id !== u.id);
                          setMemberIds(next);
                        }}
                        className="h-4 w-4 accent-blue-600"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter>
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
              className="bg-blue-600 hover:bg-blue-700 text-foreground"
              disabled={!membersProject?.id || syncMembersMutation.isPending}
              onClick={() => {
                if (!membersProject?.id) return;
                syncMembersMutation.mutate({ projectId: membersProject.id, userIds: memberIds });
              }}
            >
              {syncMembersMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
