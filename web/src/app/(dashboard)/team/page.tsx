'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users,
  UserPlus,
  Mail,
  Loader2,
  Shield,
  MoreHorizontal,
  Copy,
  RefreshCw,
  Trash2,
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
import { PasswordInput } from '@/components/ui/password-input';
import { Switch } from '@/components/ui/switch';
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
import { useAuthStore } from '@/stores/auth-store';

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
  used: number;
  limit: number | 'unlimited';
  plan: string;
  overage: number;
  trial_ends_at: string | null;
}

interface Invitation {
  id: string;
  email: string;
  role: 'admin' | 'manager' | 'employee';
  token: string;
  expires_at: string;
  created_at: string;
  creator?: {
    id: string;
    name: string;
    email: string;
  };
}

type PaginationMeta = {
  current_page: number;
  last_page: number;
  total: number;
  per_page: number;
};

type PaginatedResponse<T> = {
  data: T[];
  meta: PaginationMeta;
  // Backward-compat key returned by backend for older builds
  invitations?: T[];
};

const roleBadgeClass: Record<string, string> = {
  owner: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  admin: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  manager: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  employee: 'bg-muted/50 text-muted-foreground border-border',
};

type ApiValidationErrorResponse = {
  message?: string;
  errors?: Record<string, string[]>;
};

const resetPasswordEndpoint = (userId: string) => `/users/${userId}/password-reset`;

export default function TeamPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('employee');
  const [membersPage, setMembersPage] = useState(1);
  const [membersPerPage] = useState(20);
  const [invitesPage, setInvitesPage] = useState(1);
  const [invitesPerPage] = useState(20);
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [resetPasswordMember, setResetPasswordMember] = useState<TeamMember | null>(null);
  const [generateRandomPassword, setGenerateRandomPassword] = useState(true);
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);
  const [resetPasswordErrors, setResetPasswordErrors] = useState<{
    password?: string;
    password_confirmation?: string;
    generate?: string;
  }>({});

  // Team is for owner/admin/manager only; redirect employees so they don't hit 403
  useEffect(() => {
    if (user?.role === 'employee') {
      toast.error('You don\'t have access to the Team page.');
      router.replace('/dashboard');
    }
  }, [user?.role, router]);

  const { data: membersResponse, isLoading } = useQuery<PaginatedResponse<TeamMember>>({
    queryKey: ['team-members', membersPage, membersPerPage],
    queryFn: async () => {
      const res = await api.get('/users', { params: { page: membersPage, per_page: membersPerPage } });
      return res.data;
    },
    enabled: user?.role !== 'employee',
  });

  const { data: usage } = useQuery<BillingUsage>({
    queryKey: ['billing-usage'],
    queryFn: async () => {
      const res = await api.get('/billing/usage');
      return res.data;
    },
    enabled: user?.role !== 'employee',
  });

  const { data: invitationsResponse, isLoading: invitesLoading } = useQuery<PaginatedResponse<Invitation>>({
    queryKey: ['invitations', invitesPage, invitesPerPage],
    queryFn: async () => {
      const res = await api.get('/invitations', { params: { page: invitesPage, per_page: invitesPerPage } });
      return res.data;
    },
    retry: false,
    enabled: user?.role !== 'employee',
  });

  const inviteMutation = useMutation({
    mutationFn: async (data: { email: string; role: string }) => {
      await api.post('/invitations', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-members'] });
      queryClient.invalidateQueries({ queryKey: ['billing-usage'] });
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
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

  const resendInviteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/invitations/${id}/resend`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
      toast.success('Invitation resent');
    },
    onError: (err: unknown) => {
      const axiosError = err as { response?: { data?: { message?: string } } };
      toast.error(axiosError.response?.data?.message || 'Failed to resend invitation');
    },
  });

  const revokeInviteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/invitations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
      toast.success('Invitation revoked');
    },
    onError: (err: unknown) => {
      const axiosError = err as { response?: { data?: { message?: string } } };
      toast.error(axiosError.response?.data?.message || 'Failed to revoke invitation');
    },
  });

  const inviteBaseUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return window.location.origin;
  }, []);

  const copyInviteLink = async (token: string) => {
    const url = `${inviteBaseUrl}/invitations/accept?token=${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Invite link copied');
    } catch {
      toast.error('Failed to copy link');
    }
  };

  const resetPasswordMutation = useMutation({
    mutationFn: async (payload: { userId: string; body: Record<string, unknown> }) => {
      const res = await api.post(resetPasswordEndpoint(payload.userId), payload.body);
      return res.data as unknown;
    },
    onSuccess: (data) => {
      const maybeGenerated =
        (data as { generated_password?: string })?.generated_password ??
        (data as { password?: string })?.password ??
        (data as { data?: { generated_password?: string } })?.data?.generated_password ??
        null;

      queryClient.invalidateQueries({ queryKey: ['team-members'] });

      if (generateRandomPassword) {
        setGeneratedPassword(maybeGenerated);
        toast.success('Password reset. Copy the new password.');
      } else {
        toast.success('Password updated successfully');
        setResetPasswordOpen(false);
      }
    },
    onError: (err: unknown) => {
      const axiosErr = err as {
        message?: string;
        response?: { data?: ApiValidationErrorResponse };
      };

      const message =
        axiosErr.response?.data?.message ||
        axiosErr.message ||
        'Failed to reset password';

      const errors = axiosErr.response?.data?.errors;
      if (errors) {
        setResetPasswordErrors({
          password: errors.password?.[0],
          password_confirmation: errors.password_confirmation?.[0],
          generate: errors.generate?.[0],
        });
      }

      toast.error(message);
    },
  });

  const openResetPassword = (member: TeamMember) => {
    setResetPasswordMember(member);
    setResetPasswordErrors({});
    setGeneratedPassword(null);
    setNewPassword('');
    setNewPasswordConfirm('');
    setGenerateRandomPassword(true);
    setResetPasswordOpen(true);
  };

  const copyGeneratedPassword = async () => {
    if (!generatedPassword) return;
    try {
      await navigator.clipboard.writeText(generatedPassword);
      toast.success('Password copied');
    } catch {
      toast.error('Failed to copy password');
    }
  };

  const submitResetPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPasswordMember) return;

    setResetPasswordErrors({});
    setGeneratedPassword(null);

    if (!generateRandomPassword) {
      if (!newPassword || newPassword.length < 8) {
        setResetPasswordErrors((prev) => ({
          ...prev,
          password: 'Password must be at least 8 characters.',
        }));
        return;
      }
      if (newPassword !== newPasswordConfirm) {
        setResetPasswordErrors((prev) => ({
          ...prev,
          password_confirmation: 'Passwords do not match.',
        }));
        return;
      }
    }

    resetPasswordMutation.mutate({
      userId: resetPasswordMember.id,
      body: generateRandomPassword
        ? { generate: true }
        : { password: newPassword, password_confirmation: newPasswordConfirm },
    });
  };

  if (user?.role === 'employee') {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const members = membersResponse?.data ?? [];
  const membersMeta = membersResponse?.meta;
  const invitations = invitationsResponse?.data ?? invitationsResponse?.invitations ?? [];
  const invitesMeta = invitationsResponse?.meta;

  const activeMembers = members.filter((m) => m.is_active).length;
  const totalMembers = membersMeta?.total ?? members.length;

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    inviteMutation.mutate({ email: inviteEmail.trim(), role: inviteRole });
  };

  const canInvite = user?.role === 'owner' || user?.role === 'admin';
  const seatLimitReached =
    !!usage &&
    usage.limit !== 'unlimited' &&
    typeof usage.limit === 'number' &&
    usage.used >= usage.limit;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Team</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage your team members and roles
          </p>
        </div>
        {canInvite && (
          <Button
            onClick={() => setInviteOpen(true)}
            disabled={seatLimitReached}
            className="bg-blue-600 hover:bg-blue-700 text-foreground disabled:opacity-60"
          >
            <UserPlus className="mr-2 h-4 w-4" />
            {seatLimitReached ? 'Seat limit reached' : 'Invite Member'}
          </Button>
        )}
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogContent className="bg-card border-border">
            <form onSubmit={handleInvite}>
              <DialogHeader>
                <DialogTitle className="text-foreground">Invite Team Member</DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  Send an invitation email to a new team member.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="invite-email" className="text-foreground">Email address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="invite-email"
                      type="email"
                      placeholder="colleague@company.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      className="pl-10 bg-muted border-border text-white placeholder:text-muted-foreground"
                      required
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label className="text-foreground">Role</Label>
                  <Select value={inviteRole} onValueChange={(val) => setInviteRole(val ?? 'employee')}>
                    <SelectTrigger className="w-full bg-muted border-border">
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
                  className="bg-blue-600 hover:bg-blue-700 text-foreground"
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
        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Members</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {isLoading ? (
                <div className="h-8 w-12 bg-muted animate-pulse rounded" />
              ) : (
                totalMembers
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active</CardTitle>
            <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {isLoading ? (
                <div className="h-8 w-12 bg-muted animate-pulse rounded" />
              ) : (
                activeMembers
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Seat Usage</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {!usage ? (
                <div className="h-8 w-20 bg-muted animate-pulse rounded" />
              ) : usage.limit === 'unlimited' ? (
                <span>
                  {usage.used}
                  <span className="text-sm font-normal text-muted-foreground ml-1">
                    members (Unlimited)
                  </span>
                </span>
              ) : (
                <span>
                  {usage.used}
                  <span className="text-sm font-normal text-muted-foreground">
                    /{usage.limit} seats used
                  </span>
                </span>
              )}
            </div>
            {usage && usage.limit !== 'unlimited' && typeof usage.limit === 'number' && usage.limit > 0 && (
              <div className="mt-2 h-1.5 bg-muted rounded-full">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all"
                  style={{ width: `${Math.min((usage.used / usage.limit) * 100, 100)}%` }}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Team Table */}
      {/* Pending invitations */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-foreground">Pending invitations</CardTitle>
          <CardDescription className="text-muted-foreground">
            Invites that haven&apos;t been accepted yet (expire after 7 days)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invitesLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-12 bg-muted rounded animate-pulse" />
              ))}
            </div>
          ) : invitations.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No pending invitations.
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground">Email</TableHead>
                    <TableHead className="text-muted-foreground">Role</TableHead>
                    <TableHead className="text-muted-foreground">Invited by</TableHead>
                    <TableHead className="text-muted-foreground">Expires</TableHead>
                    <TableHead className="text-muted-foreground text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitations.map((inv) => (
                    <TableRow key={inv.id} className="border-border">
                      <TableCell className="text-sm text-foreground">{inv.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={roleBadgeClass[inv.role]}>
                          {inv.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {inv.creator?.name || '--'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(inv.expires_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-border text-foreground"
                            onClick={() => copyInviteLink(inv.token)}
                          >
                            <Copy className="h-4 w-4 mr-1" />
                            Copy link
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-border text-foreground"
                            disabled={resendInviteMutation.isPending}
                            onClick={() => resendInviteMutation.mutate(inv.id)}
                          >
                            <RefreshCw className="h-4 w-4 mr-1" />
                            Resend
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                            disabled={revokeInviteMutation.isPending}
                            onClick={() => revokeInviteMutation.mutate(inv.id)}
                          >
                            <Trash2 className="h-4 w-4 mr-1" />
                            Revoke
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {invitesMeta && invitesMeta.last_page > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-border text-foreground"
                    disabled={invitesPage <= 1}
                    onClick={() => setInvitesPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <div className="text-sm text-muted-foreground">
                    Page {invitesMeta.current_page} of {invitesMeta.last_page}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-border text-foreground"
                    disabled={invitesPage >= invitesMeta.last_page}
                    onClick={() => setInvitesPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-foreground">Members</CardTitle>
          <CardDescription className="text-muted-foreground">
            All members of your organization
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-14 bg-muted rounded animate-pulse" />
              ))}
            </div>
          ) : !members || members.length === 0 ? (
            <div className="text-center py-12">
              <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">No team members</p>
              <p className="text-sm text-muted-foreground mt-1">
                Invite your first team member to get started
              </p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground">Member</TableHead>
                    <TableHead className="text-muted-foreground">Role</TableHead>
                    <TableHead className="text-muted-foreground">Status</TableHead>
                    <TableHead className="text-muted-foreground">Last Active</TableHead>
                    <TableHead className="text-muted-foreground text-right">Actions</TableHead>
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
                    <TableRow key={member.id} className="border-border">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8 border border-border">
                            <AvatarImage
                              src={member.avatar_url || undefined}
                              alt={member.name}
                            />
                            <AvatarFallback className="bg-muted text-white text-xs">
                              {initials}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-sm font-medium text-foreground">{member.name}</p>
                            <p className="text-xs text-muted-foreground">{member.email}</p>
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
                              : 'bg-muted text-muted-foreground border-border'
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
                        <span className="text-sm text-muted-foreground">
                          {member.last_active_at
                            ? formatDate(member.last_active_at)
                            : 'Never'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {member.role !== 'owner' && (
                          <DropdownMenu>
                            <DropdownMenuTrigger className="inline-flex items-center justify-center rounded-md h-8 w-8 hover:bg-muted text-muted-foreground">
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
                                onClick={() => openResetPassword(member)}
                              >
                                Reset password
                              </DropdownMenuItem>
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
              {membersMeta && membersMeta.last_page > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-border text-foreground"
                    disabled={membersPage <= 1}
                    onClick={() => setMembersPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <div className="text-sm text-muted-foreground">
                    Page {membersMeta.current_page} of {membersMeta.last_page}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-border text-foreground"
                    disabled={membersPage >= membersMeta.last_page}
                    onClick={() => setMembersPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={resetPasswordOpen}
        onOpenChange={(open) => {
          setResetPasswordOpen(open);
          if (!open) {
            setResetPasswordMember(null);
            setResetPasswordErrors({});
            setGeneratedPassword(null);
            setNewPassword('');
            setNewPasswordConfirm('');
            setGenerateRandomPassword(true);
          }
        }}
      >
        <DialogContent className="bg-card border-border">
          <form onSubmit={submitResetPassword} className="space-y-4">
            <DialogHeader>
              <DialogTitle className="text-foreground">Reset password</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                Set a new password for{' '}
                <span className="text-foreground font-medium">
                  {resetPasswordMember?.name || 'this member'}
                </span>
                {resetPasswordMember?.email ? ` (${resetPasswordMember.email})` : ''}.
              </DialogDescription>
            </DialogHeader>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted p-3">
              <div>
                <p className="text-sm font-medium text-foreground">Generate random password</p>
                <p className="text-xs text-muted-foreground">
                  We’ll generate a secure password and show it once.
                </p>
                {resetPasswordErrors.generate && (
                  <p className="text-xs text-destructive mt-1" role="alert">
                    {resetPasswordErrors.generate}
                  </p>
                )}
              </div>
              <Switch
                checked={generateRandomPassword}
                onCheckedChange={(v) => {
                  setGenerateRandomPassword(v);
                  setResetPasswordErrors({});
                  setGeneratedPassword(null);
                }}
                aria-label="Generate random password"
              />
            </div>

            {generateRandomPassword ? (
              <div className="space-y-2">
                <Label className="text-foreground">Generated password</Label>
                {generatedPassword ? (
                  <div className="flex gap-2">
                    <Input
                      value={generatedPassword}
                      readOnly
                      className="bg-muted border-border text-foreground"
                      aria-label="Generated password"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="bg-muted border-border"
                      onClick={copyGeneratedPassword}
                      aria-label="Copy generated password"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Click “Reset password” to generate a new password.
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="member-new-password" className="text-foreground">New password</Label>
                  <PasswordInput
                    id="member-new-password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      if (resetPasswordErrors.password) {
                        setResetPasswordErrors((prev) => ({ ...prev, password: undefined }));
                      }
                    }}
                    aria-invalid={!!resetPasswordErrors.password}
                    className={`bg-muted border-border text-white ${resetPasswordErrors.password ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                  />
                  {resetPasswordErrors.password && (
                    <p className="text-xs text-destructive" role="alert">
                      {resetPasswordErrors.password}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">Minimum 8 characters</p>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="member-new-password-confirm" className="text-foreground">Confirm new password</Label>
                  <PasswordInput
                    id="member-new-password-confirm"
                    autoComplete="new-password"
                    value={newPasswordConfirm}
                    onChange={(e) => {
                      setNewPasswordConfirm(e.target.value);
                      if (resetPasswordErrors.password_confirmation) {
                        setResetPasswordErrors((prev) => ({ ...prev, password_confirmation: undefined }));
                      }
                    }}
                    aria-invalid={!!resetPasswordErrors.password_confirmation}
                    className={`bg-muted border-border text-white ${resetPasswordErrors.password_confirmation ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                  />
                  {resetPasswordErrors.password_confirmation && (
                    <p className="text-xs text-destructive" role="alert">
                      {resetPasswordErrors.password_confirmation}
                    </p>
                  )}
                </div>
              </>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                className="bg-muted border-border"
                onClick={() => setResetPasswordOpen(false)}
                disabled={resetPasswordMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={resetPasswordMutation.isPending}>
                {resetPasswordMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Reset password
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
