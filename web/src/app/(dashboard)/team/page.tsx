"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Users,
    UserPlus,
    Mail,
    Loader2,
    MoreHorizontal,
    Copy,
    RefreshCw,
    Trash2,
    Search,
    SlidersHorizontal,
    X,
    CheckCircle2,
    XCircle,
    ChevronDown,
    ChevronUp,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PasswordInput } from "@/components/ui/password-input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import api from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { usePermissionStore } from "@/stores/permission-store";
import { useRoles, useAssignRole } from "@/hooks/use-roles";

interface TeamMember {
    id: string;
    name: string;
    email: string;
    role: string;
    is_active: boolean;
    avatar_url: string | null;
    last_active_at: string | null;
    created_at: string;
}

interface BillingUsage {
    used: number;
    limit: number | "unlimited";
    plan: string;
    overage: number;
    trial_ends_at: string | null;
}

interface Invitation {
    id: string;
    email: string;
    role: string;
    token: string;
    expires_at: string;
    created_at: string;
    creator?: {
        id: string;
        name: string;
        email: string;
    };
}

type LaravelPaginator<T> = {
    data: T[];
    current_page: number;
    last_page: number;
    total: number;
    per_page: number;
    from: number | null;
    to: number | null;
};

const parsePositiveInt = (value: string | null, fallback: number) => {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const avatarColors = [
    "bg-blue-600", "bg-emerald-600", "bg-violet-600", "bg-amber-600",
    "bg-rose-600", "bg-cyan-600", "bg-indigo-600", "bg-teal-600",
];

function getAvatarColor(name: string) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return avatarColors[Math.abs(hash) % avatarColors.length];
}

type ApiValidationErrorResponse = {
    message?: string;
    errors?: Record<string, string[]>;
};

const resetPasswordEndpoint = (userId: string) =>
    `/users/${userId}/password-reset`;

export default function TeamPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user } = useAuthStore();
    const { hasPermission } = usePermissionStore();
    const queryClient = useQueryClient();
    const [inviteOpen, setInviteOpen] = useState(false);
    const [inviteEmail, setInviteEmail] = useState("");
    const [inviteRole, setInviteRole] = useState<string>("employee");
    const [inviteErrors, setInviteErrors] = useState<{
        email?: string;
        role?: string;
    }>({});
    const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
    const [resetPasswordMember, setResetPasswordMember] =
        useState<TeamMember | null>(null);
    const [generateRandomPassword, setGenerateRandomPassword] = useState(true);
    const [newPassword, setNewPassword] = useState("");
    const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
    const [generatedPassword, setGeneratedPassword] = useState<string | null>(
        null,
    );
    const [resetPasswordErrors, setResetPasswordErrors] = useState<{
        password?: string;
        password_confirmation?: string;
        generate?: string;
    }>({});

    const [searchInput, setSearchInput] = useState("");
    const [memberSearch, setMemberSearch] = useState("");
    const [roleFilter, setRoleFilter] = useState<string>("all");
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const [showFilters, setShowFilters] = useState(false);
    const [invitesExpanded, setInvitesExpanded] = useState(false);

    useEffect(() => {
        const t = setTimeout(() => setMemberSearch(searchInput), 300);
        return () => clearTimeout(t);
    }, [searchInput]);

    useEffect(() => {
        if (user && !hasPermission('team.view_members')) {
            toast.error("You don't have access to the Team page.");
            router.replace("/dashboard");
        }
    }, [user, hasPermission, router]);

    const canManageInvites = hasPermission('team.invite');
    const canChangeRole = hasPermission('team.change_role');
    const { data: orgRoles } = useRoles();
    const assignRoleMutation = useAssignRole();

    const membersPage = parsePositiveInt(searchParams.get("members_page"), 1);
    const membersPerPage = parsePositiveInt(
        searchParams.get("members_per_page"),
        15,
    );
    const invitesPage = parsePositiveInt(searchParams.get("invites_page"), 1);
    const invitesPerPage = parsePositiveInt(
        searchParams.get("invites_per_page"),
        50,
    );

    const setSearchParam = (key: string, value: string) => {
        const next = new URLSearchParams(searchParams.toString());
        next.set(key, value);
        router.replace(`/team?${next.toString()}`);
    };

    useEffect(() => {
        const next = new URLSearchParams(searchParams.toString());
        if (next.get("members_page") && next.get("members_page") !== "1") {
            next.set("members_page", "1");
            router.replace(`/team?${next.toString()}`);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [memberSearch, roleFilter, statusFilter]);

    const {
        data: membersResponse,
        isLoading,
        isError: membersIsError,
    } = useQuery<LaravelPaginator<TeamMember>>({
        queryKey: [
            "team-members",
            { page: membersPage, per_page: membersPerPage, search: memberSearch, role: roleFilter, status: statusFilter },
        ],
        queryFn: async () => {
            const params: Record<string, string | number> = {
                page: membersPage,
                per_page: membersPerPage,
            };
            if (memberSearch) params.search = memberSearch;
            if (roleFilter !== "all") params.role = roleFilter;
            if (statusFilter !== "all") params.status = statusFilter;
            const res = await api.get("/users", { params });
            const raw = res.data;
            if (raw.meta) {
                return {
                    data: raw.data || raw.users || [],
                    current_page: raw.meta.current_page,
                    last_page: raw.meta.last_page,
                    total: raw.meta.total,
                    per_page: raw.meta.per_page,
                    from: raw.from ?? ((raw.meta.current_page - 1) * raw.meta.per_page + 1),
                    to: raw.to ?? Math.min(raw.meta.current_page * raw.meta.per_page, raw.meta.total),
                } as LaravelPaginator<TeamMember>;
            }
            return raw;
        },
        enabled: hasPermission('team.view_members'),
    });

    const { data: usage } = useQuery<BillingUsage>({
        queryKey: ["billing-usage"],
        queryFn: async () => {
            const res = await api.get("/billing/usage");
            return res.data;
        },
        enabled: hasPermission('team.view_members'),
    });

    const {
        data: invitationsResponse,
        isLoading: invitesLoading,
        isError: invitesIsError,
        error: invitesError,
    } = useQuery<LaravelPaginator<Invitation>>({
        queryKey: [
            "invitations",
            { page: invitesPage, per_page: invitesPerPage },
        ],
        queryFn: async () => {
            const res = await api.get("/invitations", {
                params: { page: invitesPage, per_page: invitesPerPage },
            });
            return res.data;
        },
        retry: false,
        enabled: canManageInvites,
    });

    const inviteMutation = useMutation({
        mutationFn: async (data: { email: string; role: string }) => {
            await api.post("/invitations", data);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["team-members"] });
            queryClient.invalidateQueries({ queryKey: ["billing-usage"] });
            queryClient.invalidateQueries({ queryKey: ["invitations"] });
            setInviteOpen(false);
            setInviteEmail("");
            setInviteRole("employee");
            setInviteErrors({});
            toast.success("Invitation sent successfully");
        },
        onError: (err: unknown) => {
            const axiosErr = err as {
                message?: string;
                response?: {
                    data?: ApiValidationErrorResponse;
                    status?: number;
                };
            };
            const status = axiosErr.response?.status;
            if (status === 403) {
                toast.error("You don't have permission to send invitations.");
                return;
            }
            const errors = axiosErr.response?.data?.errors;
            if (errors) {
                setInviteErrors({
                    email: errors.email?.[0],
                    role: errors.role?.[0],
                });
            }
            toast.error(
                axiosErr.response?.data?.message ||
                    axiosErr.message ||
                    "Failed to send invitation",
            );
        },
    });

    const updateRoleMutation = useMutation({
        mutationFn: async ({
            userId,
            role,
        }: {
            userId: string;
            role: string;
        }) => {
            await api.put(`/users/${userId}`, { role });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["team-members"] });
            toast.success("Role updated successfully");
        },
        onError: () => {
            toast.error("Failed to update role");
        },
    });

    const toggleActiveMutation = useMutation({
        mutationFn: async ({
            userId,
            isActive,
        }: {
            userId: string;
            isActive: boolean;
        }) => {
            await api.put(`/users/${userId}`, { is_active: isActive });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["team-members"] });
            queryClient.invalidateQueries({ queryKey: ["billing-usage"] });
            toast.success("Member status updated");
        },
        onError: () => {
            toast.error("Failed to update member status");
        },
    });

    const resendInviteMutation = useMutation({
        mutationFn: async (id: string) => {
            await api.post(`/invitations/${id}/resend`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["invitations"] });
            toast.success("Invitation resent");
        },
        onError: (err: unknown) => {
            const axiosError = err as {
                response?: { data?: { message?: string } };
            };
            toast.error(
                axiosError.response?.data?.message ||
                    "Failed to resend invitation",
            );
        },
    });

    const revokeInviteMutation = useMutation({
        mutationFn: async (id: string) => {
            await api.delete(`/invitations/${id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["invitations"] });
            toast.success("Invitation revoked");
        },
        onError: (err: unknown) => {
            const axiosError = err as {
                response?: { data?: { message?: string } };
            };
            toast.error(
                axiosError.response?.data?.message ||
                    "Failed to revoke invitation",
            );
        },
    });

    const inviteBaseUrl = useMemo(() => {
        if (typeof window === "undefined") return "";
        return window.location.origin;
    }, []);

    const copyInviteLink = async (token: string) => {
        const url = `${inviteBaseUrl}/invitations/accept?token=${token}`;
        try {
            await navigator.clipboard.writeText(url);
            toast.success("Invite link copied");
        } catch {
            toast.error("Failed to copy link");
        }
    };

    const resetPasswordMutation = useMutation({
        mutationFn: async (payload: {
            userId: string;
            body: Record<string, unknown>;
        }) => {
            const res = await api.post(
                resetPasswordEndpoint(payload.userId),
                payload.body,
            );
            return res.data as unknown;
        },
        onSuccess: (data) => {
            const maybeGenerated =
                (data as { generated_password?: string })?.generated_password ??
                (data as { password?: string })?.password ??
                (data as { data?: { generated_password?: string } })?.data
                    ?.generated_password ??
                null;

            queryClient.invalidateQueries({ queryKey: ["team-members"] });

            if (generateRandomPassword) {
                setGeneratedPassword(maybeGenerated);
                toast.success("Password reset. Copy the new password.");
            } else {
                toast.success("Password updated successfully");
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
                "Failed to reset password";
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
        setNewPassword("");
        setNewPasswordConfirm("");
        setGenerateRandomPassword(true);
        setResetPasswordOpen(true);
    };

    const copyGeneratedPassword = async () => {
        if (!generatedPassword) return;
        try {
            await navigator.clipboard.writeText(generatedPassword);
            toast.success("Password copied");
        } catch {
            toast.error("Failed to copy password");
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
                    password: "Password must be at least 8 characters.",
                }));
                return;
            }
            if (newPassword !== newPasswordConfirm) {
                setResetPasswordErrors((prev) => ({
                    ...prev,
                    password_confirmation: "Passwords do not match.",
                }));
                return;
            }
        }
        resetPasswordMutation.mutate({
            userId: resetPasswordMember.id,
            body: generateRandomPassword
                ? { generate: true }
                : {
                      password: newPassword,
                      password_confirmation: newPasswordConfirm,
                  },
        });
    };

    if (user && !hasPermission('team.view_members')) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const members = membersResponse?.data ?? [];
    const invitations = invitationsResponse?.data ?? [];
    const activeMembers = members.filter((m) => m.is_active).length;
    const inactiveMembers = members.filter((m) => !m.is_active).length;
    const totalMembers = membersResponse?.total ?? members.length;

    const activeFilterCount =
        (roleFilter !== "all" ? 1 : 0) + (statusFilter !== "all" ? 1 : 0);

    const clearFilters = () => {
        setSearchInput("");
        setRoleFilter("all");
        setStatusFilter("all");
    };

    const handleInvite = (e: React.FormEvent) => {
        e.preventDefault();
        if (!inviteEmail.trim()) return;
        setInviteErrors({});
        inviteMutation.mutate({ email: inviteEmail.trim(), role: inviteRole });
    };

    const seatLimitReached =
        !!usage &&
        usage.limit !== "unlimited" &&
        typeof usage.limit === "number" &&
        usage.used >= usage.limit;

    const seatDisplay = !usage
        ? "--"
        : usage.limit === "unlimited"
            ? `${usage.used}`
            : `${usage.used}/${usage.limit}`;

    return (
        <div className="flex flex-col gap-3">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-lg font-semibold tracking-tight">Team</h1>
                    <p className="text-xs text-muted-foreground">
                        Manage your team members and roles
                    </p>
                </div>
                {canManageInvites && (
                    <Button
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => {
                            setInviteErrors({});
                            setInviteOpen(true);
                        }}
                        disabled={seatLimitReached}
                    >
                        <UserPlus className="h-3.5 w-3.5 mr-1" />
                        {seatLimitReached ? "Seat limit reached" : "Invite Member"}
                    </Button>
                )}
            </div>

            {/* Stats Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                    { label: "Total", value: totalMembers, icon: Users, color: "text-blue-500", bg: "bg-blue-500/10" },
                    { label: "Active", value: activeMembers, icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10" },
                    { label: "Pending Invites", value: invitations.length, icon: Mail, color: "text-amber-500", bg: "bg-amber-500/10" },
                    { label: "Deactivated", value: inactiveMembers, icon: XCircle, color: "text-red-500", bg: "bg-red-500/10" },
                ].map((s) => (
                    <Card key={s.label} className="border-border">
                        <CardContent className="p-3">
                            <div className="flex items-center gap-2.5">
                                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${s.bg} shrink-0`}>
                                    <s.icon className={`h-4 w-4 ${s.color}`} />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">{s.label}</p>
                                    <p className="text-base font-bold text-foreground tabular-nums leading-tight">{isLoading ? "--" : s.value}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Pending Invitations */}
            {canManageInvites && (
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
                            ) : invitesIsError ? (
                                <p className="text-xs text-destructive">
                                    {(invitesError as { message?: string })?.message || "Failed to load invitations."}
                                </p>
                            ) : invitations.length === 0 ? (
                                <p className="text-xs text-muted-foreground">No pending invitations.</p>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow className="hover:bg-transparent">
                                            <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[240px]">Email</TableHead>
                                            <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[90px]">Role</TableHead>
                                            <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[110px]">Invited By</TableHead>
                                            <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[90px]">Expires</TableHead>
                                            <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[160px] text-right">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {invitations.map((inv) => (
                                            <TableRow key={inv.id} className="border-border/50 hover:bg-muted/30">
                                                <TableCell className="text-[0.7rem] py-2">{inv.email}</TableCell>
                                                <TableCell className="py-2">
                                                    <Badge variant="outline" className="text-[0.6rem] px-1.5 py-0">
                                                        {inv.role}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-[0.7rem] text-muted-foreground py-2">
                                                    {inv.creator?.name || "--"}
                                                </TableCell>
                                                <TableCell className="text-[0.7rem] text-muted-foreground py-2">
                                                    {formatDate(inv.expires_at)}
                                                </TableCell>
                                                <TableCell className="text-right py-2">
                                                    <div className="inline-flex items-center gap-1">
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-6 px-2 text-[0.6rem]"
                                                            onClick={() => copyInviteLink(inv.token)}
                                                        >
                                                            <Copy className="h-3 w-3 mr-1" />
                                                            Copy
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-6 px-2 text-[0.6rem]"
                                                            disabled={resendInviteMutation.isPending}
                                                            onClick={() => resendInviteMutation.mutate(inv.id)}
                                                        >
                                                            <RefreshCw className="h-3 w-3 mr-1" />
                                                            Resend
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-6 px-2 text-[0.6rem] text-destructive hover:text-destructive"
                                                            disabled={revokeInviteMutation.isPending}
                                                            onClick={() => revokeInviteMutation.mutate(inv.id)}
                                                        >
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

            {/* Filter Bar */}
            <div className="flex items-center gap-2">
                <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                        placeholder="Search by name or email..."
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        className="h-8 pl-8 text-xs"
                    />
                </div>

                <Button
                    variant={showFilters ? "secondary" : "outline"}
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={() => setShowFilters(!showFilters)}
                >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    Filters
                    {activeFilterCount > 0 && (
                        <Badge variant="secondary" className="h-4 px-1 text-[0.6rem] rounded-full ml-0.5">
                            {activeFilterCount}
                        </Badge>
                    )}
                </Button>

                {activeFilterCount > 0 && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs gap-1 text-muted-foreground"
                        onClick={clearFilters}
                    >
                        <X className="h-3 w-3" />
                        Clear
                    </Button>
                )}
            </div>

            {/* Collapsible Filters */}
            {showFilters && (
                <div className="flex items-center gap-3">
                    <Select value={roleFilter} onValueChange={(val) => setRoleFilter(val ?? "all")}>
                        <SelectTrigger className="h-8 w-[160px] text-xs">
                            <SelectValue placeholder="All Roles" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Roles</SelectItem>
                            {orgRoles
                                ?.slice()
                                .sort((a, b) => b.priority - a.priority)
                                .map((r) => (
                                    <SelectItem key={r.id} value={r.name}>
                                        {r.display_name}
                                    </SelectItem>
                                ))}
                        </SelectContent>
                    </Select>
                    <Select value={statusFilter} onValueChange={(val) => setStatusFilter(val ?? "all")}>
                        <SelectTrigger className="h-8 w-[140px] text-xs">
                            <SelectValue placeholder="All Status" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Status</SelectItem>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="inactive">Inactive</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            )}

            {/* Members Table */}
            {isLoading ? (
                <Card>
                    <CardContent className="p-0">
                        <div className="flex flex-col">
                            <div className="flex items-center gap-4 px-4 py-2 border-b border-border/50">
                                {Array.from({ length: 5 }).map((_, i) => (
                                    <Skeleton key={i} className="h-3 w-20" />
                                ))}
                            </div>
                            {Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0">
                                    <Skeleton className="h-7 w-7 rounded-full" />
                                    <Skeleton className="h-3.5 w-32" />
                                    <Skeleton className="h-5 w-16" />
                                    <Skeleton className="h-5 w-14" />
                                    <Skeleton className="h-3.5 w-20" />
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            ) : membersIsError ? (
                <Card className="border-destructive/50">
                    <CardContent className="py-10">
                        <div className="flex flex-col items-center text-center gap-3">
                            <Users className="size-10 text-destructive/60" />
                            <p className="text-muted-foreground font-medium">Failed to load members</p>
                            <p className="text-sm text-muted-foreground">Please try again later.</p>
                        </div>
                    </CardContent>
                </Card>
            ) : members.length === 0 ? (
                <Card>
                    <CardContent className="py-8">
                        <div className="flex flex-col items-center text-center gap-2">
                            {searchInput || roleFilter !== "all" || statusFilter !== "all" ? (
                                <>
                                    <Search className="h-8 w-8 text-muted-foreground/40" />
                                    <p className="text-sm text-muted-foreground font-medium">No results found</p>
                                    <p className="text-xs text-muted-foreground">Try adjusting your search or filters</p>
                                    <Button variant="ghost" size="sm" className="mt-1 text-xs" onClick={clearFilters}>
                                        Clear filters
                                    </Button>
                                </>
                            ) : (
                                <>
                                    <Users className="h-8 w-8 text-muted-foreground/40" />
                                    <p className="text-sm text-muted-foreground font-medium">No team members</p>
                                    <p className="text-xs text-muted-foreground">Invite your first team member to get started</p>
                                </>
                            )}
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <>
                    <Card>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader>
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[280px]">Member</TableHead>
                                        <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[110px]">Role</TableHead>
                                        <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[80px]">Status</TableHead>
                                        <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[100px]">Last Active</TableHead>
                                        <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-10">
                                            <span className="sr-only">Actions</span>
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {members.map((member) => {
                                        const initials = member.name
                                            .split(" ")
                                            .map((n) => n[0])
                                            .join("")
                                            .toUpperCase()
                                            .slice(0, 2);

                                        return (
                                            <TableRow key={member.id} className="border-border/50 hover:bg-muted/30">
                                                <TableCell className="py-2">
                                                    <div className="flex items-center gap-2.5">
                                                        <Avatar className="h-7 w-7">
                                                            <AvatarImage
                                                                src={member.avatar_url || undefined}
                                                                alt={member.name}
                                                            />
                                                            <AvatarFallback className={`${getAvatarColor(member.name)} text-white text-[0.55rem] font-medium`}>
                                                                {initials}
                                                            </AvatarFallback>
                                                        </Avatar>
                                                        <div className="min-w-0">
                                                            <p className="text-[0.7rem] font-medium truncate">{member.name}</p>
                                                            <p className="text-[0.6rem] text-muted-foreground truncate">{member.email}</p>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="py-2">
                                                    <Badge variant="outline" className="text-[0.6rem] px-1.5 py-0">
                                                        {orgRoles?.find((r) => r.name === member.role)?.display_name ?? member.role}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="py-2">
                                                    {member.is_active ? (
                                                        <span className="inline-flex items-center gap-1 text-[0.6rem] text-emerald-600 dark:text-emerald-400">
                                                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                                            Active
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 text-[0.6rem] text-red-600 dark:text-red-400">
                                                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
                                                            Deactivated
                                                        </span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-[0.7rem] text-muted-foreground py-2">
                                                    {member.last_active_at ? formatDate(member.last_active_at) : "Never"}
                                                </TableCell>
                                                <TableCell className="py-2">
                                                    {member.role !== "owner" && (
                                                        <DropdownMenu>
                                                            <DropdownMenuTrigger className="inline-flex items-center justify-center rounded-md size-7 hover:bg-muted text-muted-foreground">
                                                                <MoreHorizontal className="h-3.5 w-3.5" />
                                                            </DropdownMenuTrigger>
                                                            <DropdownMenuContent align="end">
                                                                {canChangeRole && orgRoles && orgRoles.length > 0 && (
                                                                    <>
                                                                        <DropdownMenuLabel className="text-xs">
                                                                            Change Role
                                                                        </DropdownMenuLabel>
                                                                        <DropdownMenuSeparator />
                                                                        {orgRoles
                                                                            .filter((r) =>
                                                                                r.priority < 100 ||
                                                                                (r.priority >= 100 && user?.role === "owner")
                                                                            )
                                                                            .sort((a, b) => b.priority - a.priority)
                                                                            .map((r) => (
                                                                                <DropdownMenuItem
                                                                                    key={r.id}
                                                                                    disabled={
                                                                                        member.role === r.name ||
                                                                                        assignRoleMutation.isPending
                                                                                    }
                                                                                    onClick={() =>
                                                                                        assignRoleMutation.mutate({
                                                                                            userId: member.id,
                                                                                            role_id: r.id,
                                                                                        })
                                                                                    }
                                                                                >
                                                                                    <span>{r.display_name}</span>
                                                                                    {member.role === r.name && (
                                                                                        <Badge
                                                                                            variant="secondary"
                                                                                            className="ml-auto text-[0.55rem]"
                                                                                        >
                                                                                            Current
                                                                                        </Badge>
                                                                                    )}
                                                                                </DropdownMenuItem>
                                                                            ))}
                                                                        <DropdownMenuSeparator />
                                                                    </>
                                                                )}
                                                                <DropdownMenuItem onClick={() => openResetPassword(member)}>
                                                                    Reset password
                                                                </DropdownMenuItem>
                                                                <DropdownMenuSeparator />
                                                                <DropdownMenuItem
                                                                    variant={member.is_active ? "destructive" : "default"}
                                                                    onClick={() =>
                                                                        toggleActiveMutation.mutate({
                                                                            userId: member.id,
                                                                            isActive: !member.is_active,
                                                                        })
                                                                    }
                                                                >
                                                                    {member.is_active ? "Deactivate" : "Activate"}
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
                        </CardContent>
                    </Card>

                    {membersResponse && membersResponse.last_page > 1 && (
                        <div className="flex items-center justify-between">
                            <p className="text-[0.65rem] text-muted-foreground">
                                Showing {membersResponse.from ?? 0}&ndash;{membersResponse.to ?? 0} of{" "}
                                {membersResponse.total}
                            </p>
                            <Pagination>
                                <PaginationContent>
                                    <PaginationItem>
                                        <PaginationPrevious
                                            onClick={() =>
                                                setSearchParam("members_page", String(Math.max(1, membersPage - 1)))
                                            }
                                            aria-disabled={membersPage <= 1}
                                            className={membersPage <= 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                                        />
                                    </PaginationItem>
                                    {Array.from({ length: membersResponse.last_page }, (_, i) => i + 1)
                                        .filter((p) => p === 1 || p === membersResponse.last_page || Math.abs(p - membersResponse.current_page) <= 1)
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
                                                        isActive={p === membersResponse.current_page}
                                                        onClick={() => setSearchParam("members_page", String(p))}
                                                        className="cursor-pointer"
                                                    >
                                                        {p}
                                                    </PaginationLink>
                                                </PaginationItem>
                                            ),
                                        )}
                                    <PaginationItem>
                                        <PaginationNext
                                            onClick={() =>
                                                setSearchParam("members_page", String(membersPage + 1))
                                            }
                                            aria-disabled={membersPage >= membersResponse.last_page}
                                            className={membersPage >= membersResponse.last_page ? "pointer-events-none opacity-50" : "cursor-pointer"}
                                        />
                                    </PaginationItem>
                                </PaginationContent>
                            </Pagination>
                        </div>
                    )}
                </>
            )}

            {/* Invite Dialog */}
            <Dialog
                open={inviteOpen}
                onOpenChange={(open) => {
                    setInviteOpen(open);
                    if (!open) setInviteErrors({});
                }}
            >
                <DialogContent className="sm:max-w-md">
                    <form onSubmit={handleInvite}>
                        <DialogHeader>
                            <DialogTitle className="text-base">Invite Team Member</DialogTitle>
                            <DialogDescription className="text-xs">
                                Send an invitation email to a new team member.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="flex flex-col gap-3 py-4">
                            <div className="grid gap-1.5">
                                <Label htmlFor="invite-email" className="text-xs">Email address</Label>
                                <div className="relative">
                                    <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                    <Input
                                        id="invite-email"
                                        type="email"
                                        placeholder="colleague@company.com"
                                        value={inviteEmail}
                                        onChange={(e) => {
                                            setInviteEmail(e.target.value);
                                            if (inviteErrors.email) {
                                                setInviteErrors((prev) => ({ ...prev, email: undefined }));
                                            }
                                        }}
                                        aria-invalid={!!inviteErrors.email}
                                        className={`h-8 pl-8 text-sm ${inviteErrors.email ? "border-destructive" : ""}`}
                                        required
                                    />
                                </div>
                                {inviteErrors.email && (
                                    <p className="text-[0.65rem] text-destructive" role="alert">{inviteErrors.email}</p>
                                )}
                            </div>
                            <div className="grid gap-1.5">
                                <Label className="text-xs">Role</Label>
                                <Select
                                    value={inviteRole}
                                    onValueChange={(val) => {
                                        setInviteRole(val ?? "employee");
                                        if (inviteErrors.role) {
                                            setInviteErrors((prev) => ({ ...prev, role: undefined }));
                                        }
                                    }}
                                >
                                    <SelectTrigger
                                        className={`h-8 w-full text-sm ${inviteErrors.role ? "border-destructive" : ""}`}
                                        aria-invalid={!!inviteErrors.role}
                                    >
                                        <SelectValue placeholder="Select role" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {orgRoles
                                            ? orgRoles
                                                .filter((r) =>
                                                    r.priority < 100 ||
                                                    (r.priority >= 100 && user?.role === "owner")
                                                )
                                                .sort((a, b) => b.priority - a.priority)
                                                .map((r) => (
                                                    <SelectItem key={r.id} value={r.name}>
                                                        {r.display_name}
                                                    </SelectItem>
                                                ))
                                            : (
                                                <SelectItem value="" disabled>
                                                    Loading roles...
                                                </SelectItem>
                                            )}
                                    </SelectContent>
                                </Select>
                                {inviteErrors.role && (
                                    <p className="text-[0.65rem] text-destructive" role="alert">{inviteErrors.role}</p>
                                )}
                            </div>
                        </div>
                        <DialogFooter className="gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setInviteOpen(false)}
                                disabled={inviteMutation.isPending}
                            >
                                Cancel
                            </Button>
                            <Button type="submit" size="sm" disabled={inviteMutation.isPending}>
                                {inviteMutation.isPending && (
                                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                )}
                                Send Invitation
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Reset Password Dialog */}
            <Dialog
                open={resetPasswordOpen}
                onOpenChange={(open) => {
                    setResetPasswordOpen(open);
                    if (!open) {
                        setResetPasswordMember(null);
                        setResetPasswordErrors({});
                        setGeneratedPassword(null);
                        setNewPassword("");
                        setNewPasswordConfirm("");
                        setGenerateRandomPassword(true);
                    }
                }}
            >
                <DialogContent className="sm:max-w-md">
                    <form onSubmit={submitResetPassword} className="flex flex-col gap-4">
                        <DialogHeader>
                            <DialogTitle className="text-base">Reset Password</DialogTitle>
                            <DialogDescription className="text-xs">
                                Set a new password for{" "}
                                <span className="font-medium text-foreground">
                                    {resetPasswordMember?.name || "this member"}
                                </span>
                                {resetPasswordMember?.email ? ` (${resetPasswordMember.email})` : ""}.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="flex items-center justify-between rounded-lg border border-border p-3">
                            <div>
                                <p className="text-xs font-medium">Generate random password</p>
                                <p className="text-[0.65rem] text-muted-foreground">
                                    Secure password shown once
                                </p>
                                {resetPasswordErrors.generate && (
                                    <p className="text-[0.65rem] text-destructive mt-1" role="alert">
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
                            />
                        </div>

                        {generateRandomPassword ? (
                            <div className="grid gap-1.5">
                                <Label className="text-xs">Generated password</Label>
                                {generatedPassword ? (
                                    <div className="flex gap-2">
                                        <Input value={generatedPassword} readOnly className="h-8 text-sm" />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-8"
                                            onClick={copyGeneratedPassword}
                                        >
                                            <Copy className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                ) : (
                                    <p className="text-[0.65rem] text-muted-foreground">
                                        Click &quot;Reset password&quot; to generate.
                                    </p>
                                )}
                            </div>
                        ) : (
                            <>
                                <div className="grid gap-1.5">
                                    <Label htmlFor="member-new-password" className="text-xs">New password</Label>
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
                                        className={`h-8 text-sm ${resetPasswordErrors.password ? "border-destructive" : ""}`}
                                    />
                                    {resetPasswordErrors.password && (
                                        <p className="text-[0.65rem] text-destructive" role="alert">
                                            {resetPasswordErrors.password}
                                        </p>
                                    )}
                                    <p className="text-[0.6rem] text-muted-foreground">Minimum 8 characters</p>
                                </div>
                                <div className="grid gap-1.5">
                                    <Label htmlFor="member-new-password-confirm" className="text-xs">Confirm password</Label>
                                    <PasswordInput
                                        id="member-new-password-confirm"
                                        autoComplete="new-password"
                                        value={newPasswordConfirm}
                                        onChange={(e) => {
                                            setNewPasswordConfirm(e.target.value);
                                            if (resetPasswordErrors.password_confirmation) {
                                                setResetPasswordErrors((prev) => ({
                                                    ...prev,
                                                    password_confirmation: undefined,
                                                }));
                                            }
                                        }}
                                        aria-invalid={!!resetPasswordErrors.password_confirmation}
                                        className={`h-8 text-sm ${resetPasswordErrors.password_confirmation ? "border-destructive" : ""}`}
                                    />
                                    {resetPasswordErrors.password_confirmation && (
                                        <p className="text-[0.65rem] text-destructive" role="alert">
                                            {resetPasswordErrors.password_confirmation}
                                        </p>
                                    )}
                                </div>
                            </>
                        )}

                        <DialogFooter className="gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setResetPasswordOpen(false)}
                                disabled={resetPasswordMutation.isPending}
                            >
                                Cancel
                            </Button>
                            <Button type="submit" size="sm" disabled={resetPasswordMutation.isPending}>
                                {resetPasswordMutation.isPending && (
                                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
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
