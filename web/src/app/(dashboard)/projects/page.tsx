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

interface Task {
  id: string;
  name: string;
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
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formColor, setFormColor] = useState('#3B82F6');
  const [formBillable, setFormBillable] = useState(false);
  const [formRate, setFormRate] = useState('');

  const { data: projects, isLoading } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: async () => {
      const res = await api.get('/projects');
      return res.data.projects || res.data.data || res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; color: string; billable: boolean; hourly_rate?: number }) => {
      return api.post('/projects', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      closeDialog();
      toast.success('Project created');
    },
    onError: () => toast.error('Failed to create project'),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name?: string; color?: string; billable?: boolean; hourly_rate?: number | null; is_archived?: boolean }) => {
      return api.put(`/projects/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
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
      toast.success('Project deleted');
    },
    onError: () => toast.error('Failed to delete project'),
  });

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingProject(null);
    setFormName('');
    setFormColor('#3B82F6');
    setFormBillable(false);
    setFormRate('');
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
          <h1 className="text-2xl font-bold text-white">Projects</h1>
          <p className="text-slate-400 text-sm mt-1">Manage your projects and tasks</p>
        </div>
        <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 text-white">
          <Plus className="mr-2 h-4 w-4" />
          New Project
        </Button>
      </div>

      {/* Projects Grid */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="border-slate-800 bg-slate-900/50">
              <CardContent className="p-6">
                <div className="h-32 bg-slate-800/50 rounded animate-pulse" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : !projects || projects.length === 0 ? (
        <Card className="border-slate-800 bg-slate-900/50">
          <CardContent className="py-16">
            <div className="text-center">
              <FolderOpen className="h-10 w-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 font-medium">No projects yet</p>
              <p className="text-sm text-slate-500 mt-1">
                Create your first project to start tracking time
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Card
              key={project.id}
              className={`border-slate-800 bg-slate-900/50 transition-all hover:border-slate-700 cursor-pointer ${
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
                      <CardTitle className="text-base text-white">{project.name}</CardTitle>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="inline-flex items-center justify-center rounded-md h-8 w-8 hover:bg-slate-800 text-slate-400"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
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
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(project.id); }}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <FolderOpen className="h-3.5 w-3.5" />
                    <span>{project.tasks?.length || 0} tasks</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-400">
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
                    <Badge className="bg-slate-800 text-slate-400 border-slate-700 text-xs">
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
                  <div className="mt-4 pt-3 border-t border-slate-800">
                    <p className="text-xs font-medium text-slate-400 mb-2">Tasks</p>
                    <div className="space-y-1">
                      {project.tasks.map((task) => (
                        <div key={task.id} className="text-sm text-slate-300 flex items-center gap-2">
                          <div className="h-1 w-1 rounded-full bg-slate-600" />
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
        <DialogContent className="bg-slate-900 border-slate-800">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle className="text-white">{editingProject ? 'Edit Project' : 'New Project'}</DialogTitle>
              <DialogDescription className="text-slate-400">
                {editingProject ? 'Update project details.' : 'Create a new project to track time against.'}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="project-name" className="text-slate-300">Name</Label>
                <Input
                  id="project-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Project name"
                  className="bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-slate-300">Color</Label>
                <div className="flex gap-2">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setFormColor(c)}
                      className={`h-8 w-8 rounded-full transition-all ${
                        formColor === c
                          ? 'ring-2 ring-offset-2 ring-offset-slate-900 ring-blue-500 scale-110'
                          : 'hover:scale-105'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-slate-300">Billable</Label>
                  <p className="text-xs text-slate-500">Track billable hours for this project</p>
                </div>
                <Switch
                  checked={formBillable}
                  onCheckedChange={setFormBillable}
                />
              </div>
              {formBillable && (
                <div className="grid gap-2">
                  <Label htmlFor="hourly-rate" className="text-slate-300">Hourly Rate ($)</Label>
                  <Input
                    id="hourly-rate"
                    type="number"
                    min="0"
                    step="0.01"
                    value={formRate}
                    onChange={(e) => setFormRate(e.target.value)}
                    placeholder="0.00"
                    className="bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500"
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog} className="border-slate-700 text-slate-300">
                Cancel
              </Button>
              <Button type="submit" disabled={isPending} className="bg-blue-600 hover:bg-blue-700 text-white">
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingProject ? 'Save Changes' : 'Create Project'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
