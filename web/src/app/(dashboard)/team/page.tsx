'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users,
  UserPlus,
  Mail,
  Loader2,
  Shield,
  MoreHorizontal,
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import api from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'manager' | 'employee';
  is_active: boolean;
  avatar_url: string | null;
  last_active_at: string | null;
  created_at: string;
}

interface BillingUsage {
  seats_used: number;
  seats_limit: number;
  plan: string;
}

const roleBadgeClass: Record<string, string> = {
  owner: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  admin: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  manager: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  employee: 'bg-slate-700/50 text-slate-300 border-slate-600',
};

export default function TeamPage() {
  const queryClient = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('employee');

  const { data: members, isLoading } = useQuery<TeamMember[]>({
    queryKey: ['team-members'],
    queryFn: async () => {
      const res = await api.get('/users');
      return res.data.data || res.data;
    },
  });

  const { data: usage } = useQuery<BillingUsage>({
    queryKey: ['billing-usage'],
    queryFn: async () => {
      const res = await api.get('/billing/usage');
      return res.data;
    },
  });

  const inviteMutation = useMutation({
    mutationFn: async (data: { email: string; role: string }) => {
      await api.post('/users/invite', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-members'] });
      queryClient.invalidateQueries({ queryKey: ['billing-usage'] });
      setInviteOpen(false);
      setInviteEmail('');
      setInviteRole('employee');
      toast.success('Invitation sent successfully');
    },
    onError: (err: unknown) => {
      const axiosError = err as { response?: { data?: { message?: string } } };
      toast.error(axiosError.response?.data?.message || 'Failed to send invitation');
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      await api.put(`/users/${userId}`, { role });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-members'] });
      toast.success('Role updated successfully');
    },
    onError: () => {
      toast.error('Failed to update role');
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ userId, isActive }: { userId: string; isActive: boolean }) => {
      await api.put(`/users/${userId}`, { is_active: isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-members'] });
      queryClient.invalidateQueries({ queryKey: ['billing-usage'] });
      toast.success('Member status updated');
    },
    onError: () => {
      toast.error('Failed to update member status');
    },
  });

  const activeMembers = members?.filter((m) => m.is_active).length || 0;
  const totalMembers = members?.length || 0;

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    inviteMutation.mutate({ email: inviteEmail.trim(), role: inviteRole });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Team</h1>
          <p className="text-slate-400 text-sm mt-1">
            Manage your team members and roles
          </p>
        </div>
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger>
            <Button className="bg-blue-600 hover:bg-blue-700 text-white">
              <UserPlus className="mr-2 h-4 w-4" />
              Invite Member
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-slate-900 border-slate-800">
            <form onSubmit={handleInvite}>
              <DialogHeader>
                <DialogTitle className="text-white">Invite Team Member</DialogTitle>
                <DialogDescription className="text-slate-400">
                  Send an invitation email to a new team member.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="invite-email" className="text-slate-300">Email address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <Input
                      id="invite-email"
                      type="email"
                      placeholder="colleague@company.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      className="pl-10 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500"
                      required
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label className="text-slate-300">Role</Label>
                  <Select value={inviteRole} onValueChange={(val) => setInviteRole(val ?? 'employee')}>
                    <SelectTrigger className="w-full bg-slate-800/50 border-slate-700">
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="employee">Employee</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="submit"
                  disabled={inviteMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {inviteMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Mail className="mr-2 h-4 w-4" />
                  )}
                  Send Invitation
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-slate-800 bg-slate-900/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Total Members</CardTitle>
            <Users className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">
              {isLoading ? (
                <div className="h-8 w-12 bg-slate-800/50 animate-pulse rounded" />
              ) : (
                totalMembers
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-800 bg-slate-900/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Active</CardTitle>
            <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">
              {isLoading ? (
                <div className="h-8 w-12 bg-slate-800/50 animate-pulse rounded" />
              ) : (
                activeMembers
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-800 bg-slate-900/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Seat Usage</CardTitle>
            <Shield className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">
              {!usage ? (
                <div className="h-8 w-20 bg-slate-800/50 animate-pulse rounded" />
              ) : (
                <span>
                  {usage.seats_used}
                  <span className="text-sm font-normal text-slate-500">
                    /{usage.seats_limit}
                  </span>
                </span>
              )}
            </div>
            {usage && (
              <div className="mt-2 h-1.5 bg-slate-800 rounded-full">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all"
                  style={{ width: `${Math.min((usage.seats_used / usage.seats_limit) * 100, 100)}%` }}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Team Table */}
      <Card className="border-slate-800 bg-slate-900/50">
        <CardHeader>
          <CardTitle className="text-white">Members</CardTitle>
          <CardDescription className="text-slate-400">
            All members of your organization
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-14 bg-slate-800/50 rounded animate-pulse" />
              ))}
            </div>
          ) : !members || members.length === 0 ? (
            <div className="text-center py-12">
              <Users className="h-10 w-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 font-medium">No team members</p>
              <p className="text-sm text-slate-500 mt-1">
                Invite your first team member to get started
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="text-slate-400">Member</TableHead>
                  <TableHead className="text-slate-400">Role</TableHead>
                  <TableHead className="text-slate-400">Status</TableHead>
                  <TableHead className="text-slate-400">Last Active</TableHead>
                  <TableHead className="text-slate-400 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => {
                  const initials = member.name
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2);

                  return (
                    <TableRow key={member.id} className="border-slate-800">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8 border border-slate-700">
                            <AvatarImage
                              src={member.avatar_url || undefined}
                              alt={member.name}
                            />
                            <AvatarFallback className="bg-slate-700 text-white text-xs">
                              {initials}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-sm font-medium text-white">{member.name}</p>
                            <p className="text-xs text-slate-500">{member.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-xs capitalize ${roleBadgeClass[member.role] || ''}`}>
                          {member.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={
                            member.is_active
                              ? 'bg-green-500/10 text-green-400 border-green-500/20'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full mr-1.5 inline-block ${
                              member.is_active ? 'bg-green-400' : 'bg-slate-500'
                            }`}
                          />
                          {member.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-slate-400">
                          {member.last_active_at
                            ? formatDate(member.last_active_at)
                            : 'Never'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {member.role !== 'owner' && (
                          <DropdownMenu>
                            <DropdownMenuTrigger className="inline-flex items-center justify-center rounded-md h-8 w-8 hover:bg-slate-800 text-slate-400">
                              <MoreHorizontal className="h-4 w-4" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Change Role</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              {['admin', 'manager', 'employee'].map((role) => (
                                <DropdownMenuItem
                                  key={role}
                                  disabled={member.role === role}
                                  onClick={() =>
                                    updateRoleMutation.mutate({
                                      userId: member.id,
                                      role,
                                    })
                                  }
                                >
                                  <span className="capitalize">{role}</span>
                                  {member.role === role && (
                                    <Badge variant="secondary" className="ml-auto text-xs">
                                      Current
                                    </Badge>
                                  )}
                                </DropdownMenuItem>
                              ))}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant={member.is_active ? 'destructive' : 'default'}
                                onClick={() =>
                                  toggleActiveMutation.mutate({
                                    userId: member.id,
                                    isActive: !member.is_active,
                                  })
                                }
                              >
                                {member.is_active ? 'Deactivate' : 'Activate'}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
