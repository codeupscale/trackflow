"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import {
    Bell,
    Camera,
    CalendarDays,
    Clock,
    Copy,
    CreditCard,
    Github,
    Globe,
    Linkedin,
    Loader2,
    Lock,
    Mail,
    Save,
    Settings,
    Shield,
    UserIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
    useReportSubscriptions,
    useUpsertReportSubscription,
    type ReportSubscription,
} from "@/hooks/settings/use-report-subscriptions";
import api from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { usePermissionStore } from "@/stores/permission-store";

interface OrgSettings {
    organization: {
        name: string;
        slug: string;
        plan: string;
        trial_ends_at: string | null;
        settings: {
            screenshot_interval: number;
            blur_screenshots: boolean;
            idle_timeout: number | null;
            keep_idle_time?: "prompt" | "always" | "never";
            idle_alert_auto_stop_min?: number;
            idle_alert_email_enabled?: boolean;
            idle_alert_email_cooldown_min?: number;
            screenshot_capture_immediate_after_idle?: boolean;
            screenshot_first_capture_delay_min?: number;
            idle_check_interval_sec?: number;
            capture_only_when_visible?: boolean;
            capture_multi_monitor?: boolean;
            track_urls?: boolean;
            require_project?: boolean;
            can_add_manual_time: boolean;
            weekly_limit_hours?: number | null;
            timezone: string;
        };
    };
}

interface ApiErrorResponse {
    message?: string;
    errors?: {
        current_password?: string[];
        password?: string[];
    };
}

const timezones = [
    "UTC",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Europe/Moscow",
    "Asia/Dubai",
    "Asia/Karachi",
    "Asia/Kolkata",
    "Asia/Shanghai",
    "Asia/Tokyo",
    "Australia/Sydney",
    "Pacific/Auckland",
];

function SectionRow({
    icon: Icon,
    iconColor,
    iconBg,
    title,
    description,
    children,
    last = false,
}: {
    icon: React.ElementType;
    iconColor: string;
    iconBg: string;
    title: string;
    description?: string;
    children: React.ReactNode;
    last?: boolean;
}) {
    return (
        <div className={`grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-x-10 gap-y-3 py-5 ${last ? "" : "border-b border-border/40"}`}>
            <div>
                <h3 className="text-[0.8rem] font-medium flex items-center gap-2">
                    <div className={`flex h-6 w-6 items-center justify-center rounded-md ${iconBg}`}>
                        <Icon className={`h-3 w-3 ${iconColor}`} />
                    </div>
                    {title}
                </h3>
                {description && (
                    <p className="text-[0.65rem] text-muted-foreground mt-1 leading-relaxed">
                        {description}
                    </p>
                )}
            </div>
            <div className="space-y-3">
                {children}
            </div>
        </div>
    );
}

export default function SettingsPage() {
    const { user } = useAuthStore();
    const queryClient = useQueryClient();
    const { hasPermission } = usePermissionStore();
    const isAdmin = hasPermission("settings.edit_org");
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
    const [passwordErrors, setPasswordErrors] = useState<{
        current_password?: string;
        password?: string;
        password_confirmation?: string;
    }>({});

    const { data, isLoading } = useQuery<OrgSettings>({
        queryKey: ["org-settings"],
        queryFn: async () => {
            const res = await api.get("/settings");
            return res.data;
        },
    });

    const settings = data?.organization?.settings;
    const defaults = useMemo(
        () => ({
            orgName: data?.organization?.name ?? "",
            timezone: settings?.timezone ?? "UTC",
            screenshotInterval: settings
                ? String(settings.screenshot_interval)
                : "5",
            screenshotBlur: settings?.blur_screenshots ?? false,
            idleTimeout:
                settings?.idle_timeout != null && settings.idle_timeout >= 1
                    ? String(settings.idle_timeout)
                    : "5",
            idleTimeoutCustom:
                settings?.idle_timeout != null &&
                settings.idle_timeout >= 1 &&
                ![5, 10, 20].includes(settings.idle_timeout)
                    ? String(settings.idle_timeout)
                    : "",
            keepIdleTime:
                settings?.keep_idle_time === "always"
                    ? "never"
                    : ((settings?.keep_idle_time as "prompt" | "never") ??
                      "prompt"),
            idleAlertAutoStopEnabled:
                (settings?.idle_alert_auto_stop_min ?? 10) > 0,
            idleAlertAutoStopMin:
                settings?.idle_alert_auto_stop_min != null &&
                settings.idle_alert_auto_stop_min > 0
                    ? String(settings.idle_alert_auto_stop_min)
                    : "10",
            idleAlertEmailEnabled: settings?.idle_alert_email_enabled ?? false,
            idleAlertEmailCooldownMin:
                settings?.idle_alert_email_cooldown_min != null
                    ? String(settings.idle_alert_email_cooldown_min)
                    : "60",
            screenshotImmediateAfterIdle:
                settings?.screenshot_capture_immediate_after_idle ?? true,
            screenshotFirstCaptureDelayMin:
                settings?.screenshot_first_capture_delay_min != null
                    ? String(settings.screenshot_first_capture_delay_min)
                    : "1",
            idleCheckIntervalSec:
                settings?.idle_check_interval_sec != null
                    ? String(settings.idle_check_interval_sec)
                    : "10",
            captureOnlyWhenVisible:
                settings?.capture_only_when_visible ?? false,
            captureMultiMonitor: settings?.capture_multi_monitor ?? false,
            trackUrls: settings?.track_urls ?? false,
            allowManualTime: settings?.can_add_manual_time ?? true,
            requireProject: settings?.require_project ?? false,
            weeklyLimitHours:
                settings?.weekly_limit_hours != null &&
                settings.weekly_limit_hours > 0
                    ? String(settings.weekly_limit_hours)
                    : "0",
        }),
        [data, settings],
    );

    const [orgName, setOrgName] = useState("");
    const [timezone, setTimezone] = useState("UTC");
    const [screenshotInterval, setScreenshotInterval] = useState("5");
    const [screenshotBlur, setScreenshotBlur] = useState(false);
    const [idleTimeout, setIdleTimeout] = useState("5");
    const [idleTimeoutCustom, setIdleTimeoutCustom] = useState("");
    const [keepIdleTime, setKeepIdleTime] = useState<"prompt" | "never">(
        "prompt",
    );
    const [idleAlertAutoStopEnabled, setIdleAlertAutoStopEnabled] =
        useState(true);
    const [idleAlertAutoStopMin, setIdleAlertAutoStopMin] = useState("10");
    const [idleAlertEmailEnabled, setIdleAlertEmailEnabled] = useState(false);
    const [idleAlertEmailCooldownMin, setIdleAlertEmailCooldownMin] =
        useState("60");
    const [screenshotImmediateAfterIdle, setScreenshotImmediateAfterIdle] =
        useState(true);
    const [screenshotFirstCaptureDelayMin, setScreenshotFirstCaptureDelayMin] =
        useState("1");
    const [idleCheckIntervalSec, setIdleCheckIntervalSec] = useState("10");
    const [captureOnlyWhenVisible, setCaptureOnlyWhenVisible] = useState(false);
    const [captureMultiMonitor, setCaptureMultiMonitor] = useState(false);
    const [trackUrls, setTrackUrls] = useState(false);
    const [allowManualTime, setAllowManualTime] = useState(true);
    const [requireProject, setRequireProject] = useState(false);
    const [weeklyLimitHours, setWeeklyLimitHours] = useState("0");
    const [initialized, setInitialized] = useState(false);
    const [userTimezone, setUserTimezone] = useState(user?.timezone ?? "UTC");
    const { fetchUser } = useAuthStore();

    useEffect(() => {
        if (!data || initialized) return;
        setOrgName(defaults.orgName);
        setTimezone(defaults.timezone);
        setUserTimezone(user?.timezone ?? defaults.timezone);
        setScreenshotInterval(defaults.screenshotInterval);
        setScreenshotBlur(defaults.screenshotBlur);
        setIdleTimeout(defaults.idleTimeout);
        setIdleTimeoutCustom(defaults.idleTimeoutCustom);
        setKeepIdleTime(defaults.keepIdleTime);
        setIdleAlertAutoStopEnabled(defaults.idleAlertAutoStopEnabled);
        setIdleAlertAutoStopMin(defaults.idleAlertAutoStopMin);
        setIdleAlertEmailEnabled(defaults.idleAlertEmailEnabled);
        setIdleAlertEmailCooldownMin(defaults.idleAlertEmailCooldownMin);
        setScreenshotImmediateAfterIdle(defaults.screenshotImmediateAfterIdle);
        setScreenshotFirstCaptureDelayMin(
            defaults.screenshotFirstCaptureDelayMin,
        );
        setIdleCheckIntervalSec(defaults.idleCheckIntervalSec);
        setCaptureOnlyWhenVisible(defaults.captureOnlyWhenVisible);
        setCaptureMultiMonitor(defaults.captureMultiMonitor);
        setTrackUrls(defaults.trackUrls);
        setAllowManualTime(defaults.allowManualTime);
        setRequireProject(defaults.requireProject);
        setWeeklyLimitHours(defaults.weeklyLimitHours);
        setInitialized(true);
    }, [data, defaults, initialized, user?.timezone]);

    const updateMutation = useMutation({
        mutationFn: async (settings: Record<string, unknown>) => {
            return api.put("/settings", settings);
        },
        onSuccess: async () => {
            queryClient.invalidateQueries({ queryKey: ["org-settings"] });
            await fetchUser();
            toast.success("Settings saved successfully");
        },
        onError: () => toast.error("Failed to save settings"),
    });

    const updateProfileMutation = useMutation({
        mutationFn: async (payload: { timezone: string }) => {
            const res = await api.patch("/auth/me", payload);
            return res.data;
        },
        onSuccess: (data, variables) => {
            const current = useAuthStore.getState().user;
            if (data?.user) {
                useAuthStore.getState().setUser(data.user);
            } else if (current) {
                useAuthStore
                    .getState()
                    .setUser({ ...current, timezone: variables.timezone });
            }
            toast.success("Your timezone has been updated");
        },
        onError: () => toast.error("Failed to update timezone"),
    });

    const fileRef = useRef<HTMLInputElement>(null);
    const [profileName, setProfileName] = useState(user?.name ?? "");
    const [profileJobTitle, setProfileJobTitle] = useState(
        user?.job_title ?? "",
    );
    const [profilePhone, setProfilePhone] = useState(user?.phone ?? "");
    const [profileTimezone, setProfileTimezone] = useState(
        user?.timezone ?? "UTC",
    );
    const [profileBio, setProfileBio] = useState(user?.bio ?? "");
    const [profileDob, setProfileDob] = useState(user?.date_of_birth ?? "");
    const [profileDoj, setProfileDoj] = useState(user?.date_of_joining ?? "");
    const [profileLinkedin, setProfileLinkedin] = useState(
        user?.linkedin_url ?? "",
    );
    const [profileGithub, setProfileGithub] = useState(user?.github_url ?? "");
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
    const [profileInitialized, setProfileInitialized] = useState(false);

    useEffect(() => {
        if (!user || profileInitialized) return;
        setProfileName(user.name ?? "");
        setProfileJobTitle(user.job_title ?? "");
        setProfilePhone(user.phone ?? "");
        setProfileTimezone(user.timezone ?? "UTC");
        setProfileBio(user.bio ?? "");
        setProfileDob(user.date_of_birth ?? "");
        setProfileDoj(user.date_of_joining ?? "");
        setProfileLinkedin(user.linkedin_url ?? "");
        setProfileGithub(user.github_url ?? "");
        setProfileInitialized(true);
    }, [user, profileInitialized]);

    const saveProfileMutation = useMutation({
        mutationFn: async (data: Record<string, unknown>) => {
            const res = await api.put("/profile", data);
            return res.data;
        },
        onSuccess: (data) => {
            if (data.user) {
                useAuthStore.getState().setUser(data.user);
            }
            toast.success("Profile updated successfully");
        },
        onError: () => toast.error("Failed to update profile"),
    });

    const uploadAvatarMutation = useMutation({
        mutationFn: async (file: File) => {
            const form = new FormData();
            form.append("avatar", file);
            const res = await api.post("/profile/avatar", form, {
                headers: { "Content-Type": "multipart/form-data" },
            });
            return res.data;
        },
        onSuccess: (data) => {
            const currentUser = useAuthStore.getState().user;
            if (currentUser) {
                useAuthStore
                    .getState()
                    .setUser({ ...currentUser, avatar_url: data.avatar_url });
            }
            setAvatarPreview(null);
            toast.success("Profile photo updated");
        },
        onError: () => {
            setAvatarPreview(null);
            toast.error("Failed to upload photo");
        },
    });

    const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            toast.error("File must be under 2MB");
            return;
        }
        const previewUrl = URL.createObjectURL(file);
        setAvatarPreview(previewUrl);
        uploadAvatarMutation.mutate(file);
        e.target.value = "";
    };

    const handleSaveProfile = () => {
        saveProfileMutation.mutate({
            name: profileName,
            job_title: profileJobTitle || null,
            phone: profilePhone || null,
            linkedin_url: profileLinkedin || null,
            github_url: profileGithub || null,
            date_of_birth: profileDob || null,
            date_of_joining: profileDoj || null,
            bio: profileBio || null,
            timezone: profileTimezone || null,
        });
    };

    const profileInitials =
        user?.name
            ?.split(" ")
            .map((n) => n[0])
            .join("")
            .toUpperCase()
            .slice(0, 2) || "??";

    const handleSave = () => {
        const rawIdle =
            idleTimeout === "custom" ? idleTimeoutCustom : idleTimeout;
        const idleVal = Math.min(
            30,
            Math.max(1, parseInt(String(rawIdle), 10) || 5),
        );
        const idleAutoStopMinVal = idleAlertAutoStopEnabled
            ? Math.min(
                  240,
                  Math.max(1, parseInt(String(idleAlertAutoStopMin), 10) || 10),
              )
            : 0;
        const idleEmailCooldownMinVal = Math.min(
            1440,
            Math.max(5, parseInt(String(idleAlertEmailCooldownMin), 10) || 60),
        );
        const firstDelayMinVal = Math.min(
            60,
            Math.max(
                0,
                parseInt(String(screenshotFirstCaptureDelayMin), 10) || 1,
            ),
        );
        const idleCheckSecVal = Math.min(
            60,
            Math.max(1, parseInt(String(idleCheckIntervalSec), 10) || 10),
        );
        const weeklyVal = parseInt(String(weeklyLimitHours), 10) || 0;
        updateMutation.mutate({
            name: orgName,
            settings: {
                timezone,
                screenshot_interval: parseInt(screenshotInterval),
                blur_screenshots: screenshotBlur,
                idle_timeout: idleVal,
                keep_idle_time: keepIdleTime,
                idle_alert_auto_stop_min: idleAutoStopMinVal,
                idle_alert_email_enabled: idleAlertEmailEnabled,
                idle_alert_email_cooldown_min: idleEmailCooldownMinVal,
                screenshot_capture_immediate_after_idle:
                    screenshotImmediateAfterIdle,
                screenshot_first_capture_delay_min: firstDelayMinVal,
                idle_check_interval_sec: idleCheckSecVal,
                capture_only_when_visible: captureOnlyWhenVisible,
                capture_multi_monitor: captureMultiMonitor,
                track_urls: trackUrls,
                can_add_manual_time: allowManualTime,
                require_project: requireProject,
                weekly_limit_hours: weeklyVal > 0 ? weeklyVal : null,
            },
        });
    };

    const handleSaveUserTimezone = () => {
        updateProfileMutation.mutate({ timezone: userTimezone });
    };

    const handleCopySlug = async () => {
        const slug = data?.organization.slug;
        if (!slug) return;
        try {
            await navigator.clipboard.writeText(slug);
            toast.success("Organization slug copied");
        } catch {
            toast.error("Could not copy — select the text and copy manually");
        }
    };

    const validatePasswordForm = (): boolean => {
        const errors: typeof passwordErrors = {};
        if (!currentPassword.trim()) {
            errors.current_password = "Current password is required.";
        }
        if (!newPassword) {
            errors.password = "New password is required.";
        } else if (newPassword.length < 8) {
            errors.password = "Password must be at least 8 characters.";
        }
        if (!newPasswordConfirm) {
            errors.password_confirmation = "Please confirm your new password.";
        } else if (newPassword && newPasswordConfirm !== newPassword) {
            errors.password_confirmation =
                "New password and confirmation do not match.";
        }
        setPasswordErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleChangePassword = () => {
        if (!validatePasswordForm()) return;
        changePasswordMutation.mutate({
            current_password: currentPassword,
            password: newPassword,
            password_confirmation: newPasswordConfirm,
        });
    };

    const changePasswordMutation = useMutation({
        mutationFn: async (payload: {
            current_password: string;
            password: string;
            password_confirmation: string;
        }) => {
            return api.post("/auth/change-password", payload);
        },
        onSuccess: (res) => {
            if (typeof window !== "undefined") {
                localStorage.setItem("access_token", res.data.access_token);
                localStorage.setItem("refresh_token", res.data.refresh_token);
            }
            setCurrentPassword("");
            setNewPassword("");
            setNewPasswordConfirm("");
            setPasswordErrors({});
            toast.success("Password updated");
        },
        onError: (err: unknown) => {
            const axiosErr = err as AxiosError<ApiErrorResponse> | undefined;
            const serverErrors = axiosErr?.response?.data?.errors;
            if (serverErrors) {
                setPasswordErrors({
                    current_password: serverErrors.current_password?.[0],
                    password: serverErrors.password?.[0],
                });
            }
            const msg =
                serverErrors?.current_password?.[0] ||
                serverErrors?.password?.[0] ||
                axiosErr?.message ||
                "Failed to update password";
            toast.error(msg);
        },
    });

    if (isLoading) {
        return (
            <div className="flex flex-col gap-4">
                <div>
                    <Skeleton className="h-5 w-28" />
                    <Skeleton className="h-3 w-52 mt-1.5" />
                </div>
                <Skeleton className="h-8 w-72 rounded-lg" />
                <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-36 w-full rounded-lg" />
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            {/* Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
                    <p className="text-xs text-muted-foreground">
                        Manage your profile and organization settings
                    </p>
                </div>
                {isAdmin && (
                    <Button
                        size="sm"
                        className="h-8 text-xs"
                        onClick={handleSave}
                        disabled={updateMutation.isPending}
                    >
                        {updateMutation.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        ) : (
                            <Save className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        Save Changes
                    </Button>
                )}
            </div>

            <Tabs defaultValue="profile">
                <TabsList>
                    <TabsTrigger value="profile">
                        <UserIcon className="h-3 w-3" />
                        Profile
                    </TabsTrigger>
                    <TabsTrigger value="general">
                        <Settings className="h-3 w-3" />
                        General
                    </TabsTrigger>
                    {isAdmin && (
                        <TabsTrigger value="tracking">
                            <Camera className="h-3 w-3" />
                            Tracking
                        </TabsTrigger>
                    )}
                    <TabsTrigger value="notifications">
                        <Bell className="h-3 w-3" />
                        Notifications
                    </TabsTrigger>
                </TabsList>

                {/* ═══════════════ Profile Tab ═══════════════ */}
                <TabsContent value="profile" className="mt-4">
                    <Card className="border-border">
                        <CardContent className="p-5 sm:p-6">
                            {/* Avatar header row */}
                            <div className="flex items-center gap-4 pb-5 border-b border-border/40">
                                <div
                                    className="relative group w-16 h-16 cursor-pointer shrink-0"
                                    onClick={() => fileRef.current?.click()}
                                >
                                    <Avatar className="w-16 h-16 border-2 border-border">
                                        <AvatarImage
                                            src={avatarPreview || user?.avatar_url || undefined}
                                            alt={user?.name || "User"}
                                        />
                                        <AvatarFallback className="bg-blue-600 text-white text-lg font-medium">
                                            {profileInitials}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className="absolute inset-0 bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center">
                                        <Camera className="w-4 h-4 text-white" />
                                        <span className="text-white text-[8px] font-medium mt-0.5">Change</span>
                                    </div>
                                    {uploadAvatarMutation.isPending && (
                                        <div className="absolute inset-0 bg-black/60 rounded-full flex items-center justify-center">
                                            <Loader2 className="w-5 h-5 text-white animate-spin" />
                                        </div>
                                    )}
                                </div>
                                <input
                                    ref={fileRef}
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp,image/gif"
                                    className="hidden"
                                    onChange={handleAvatarUpload}
                                />
                                <div className="flex flex-col gap-0.5 min-w-0">
                                    <h2 className="text-sm font-semibold text-foreground truncate">
                                        {user?.name}
                                    </h2>
                                    {user?.job_title && (
                                        <p className="text-[0.7rem] text-muted-foreground truncate">{user.job_title}</p>
                                    )}
                                    <p className="text-[0.7rem] text-muted-foreground truncate">{user?.email}</p>
                                </div>
                            </div>

                            {/* Personal Information */}
                            <SectionRow
                                icon={UserIcon}
                                iconColor="text-blue-500"
                                iconBg="bg-blue-500/10"
                                title="Personal Information"
                                description="Update your name, contact details, and timezone."
                            >
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="grid gap-1.5">
                                        <Label htmlFor="profile-name" className="text-xs">Full Name</Label>
                                        <Input
                                            id="profile-name"
                                            className="h-9 text-sm"
                                            value={profileName}
                                            onChange={(e) => setProfileName(e.target.value)}
                                        />
                                    </div>
                                    <div className="grid gap-1.5">
                                        <Label htmlFor="profile-job-title" className="text-xs">Job Title</Label>
                                        <Input
                                            id="profile-job-title"
                                            className="h-9 text-sm"
                                            placeholder="e.g. Senior Developer"
                                            value={profileJobTitle}
                                            onChange={(e) => setProfileJobTitle(e.target.value)}
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="grid gap-1.5">
                                        <Label htmlFor="profile-email" className="text-xs">Email</Label>
                                        <div className="relative" title="Email cannot be changed">
                                            <Input
                                                id="profile-email"
                                                value={user?.email ?? ""}
                                                disabled
                                                className="h-9 text-sm bg-muted/50 pr-9"
                                            />
                                            <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                        </div>
                                        <p className="text-[0.6rem] text-muted-foreground">Email cannot be changed</p>
                                    </div>
                                    <div className="grid gap-1.5">
                                        <Label htmlFor="profile-phone" className="text-xs">Phone Number</Label>
                                        <Input
                                            id="profile-phone"
                                            className="h-9 text-sm"
                                            placeholder="+1 (555) 000-0000"
                                            value={profilePhone}
                                            onChange={(e) => setProfilePhone(e.target.value)}
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="grid gap-1.5">
                                        <Label htmlFor="profile-tz" className="text-xs">Timezone</Label>
                                        <Select
                                            value={profileTimezone}
                                            onValueChange={(v) => v && setProfileTimezone(v)}
                                        >
                                            <SelectTrigger id="profile-tz" className="h-9 text-sm">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {timezones.map((tz) => (
                                                    <SelectItem key={tz} value={tz}>
                                                        {tz.replace(/_/g, " ")}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <div className="grid gap-1.5">
                                    <Label htmlFor="profile-bio" className="text-xs">Bio</Label>
                                    <Textarea
                                        id="profile-bio"
                                        placeholder="Tell us a little about yourself..."
                                        value={profileBio}
                                        onChange={(e) => {
                                            if (e.target.value.length <= 500) {
                                                setProfileBio(e.target.value);
                                            }
                                        }}
                                        className="text-sm min-h-[72px] resize-none"
                                        maxLength={500}
                                    />
                                    <p className="text-[0.6rem] text-muted-foreground text-right tabular-nums">
                                        {profileBio.length} / 500
                                    </p>
                                </div>
                            </SectionRow>

                            {/* Important Dates */}
                            <SectionRow
                                icon={CalendarDays}
                                iconColor="text-amber-500"
                                iconBg="bg-amber-500/10"
                                title="Important Dates"
                                description="Your date of birth and when you joined."
                            >
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs">Date of Birth</Label>
                                        <DatePicker
                                            value={profileDob}
                                            onChange={setProfileDob}
                                            placeholder="Select date of birth"
                                        />
                                    </div>
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs">Date of Joining</Label>
                                        <DatePicker
                                            value={profileDoj}
                                            onChange={setProfileDoj}
                                            placeholder="Select date of joining"
                                        />
                                    </div>
                                </div>
                            </SectionRow>

                            {/* Social Links */}
                            <SectionRow
                                icon={Globe}
                                iconColor="text-violet-500"
                                iconBg="bg-violet-500/10"
                                title="Social Links"
                                description="Add links to your professional profiles."
                                last
                            >
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="grid gap-1.5">
                                        <Label htmlFor="profile-linkedin" className="text-xs">LinkedIn</Label>
                                        <div className="relative">
                                            <Linkedin className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                            <Input
                                                id="profile-linkedin"
                                                className="h-9 text-sm pl-9"
                                                placeholder="https://linkedin.com/in/..."
                                                value={profileLinkedin}
                                                onChange={(e) => setProfileLinkedin(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                    <div className="grid gap-1.5">
                                        <Label htmlFor="profile-github" className="text-xs">GitHub</Label>
                                        <div className="relative">
                                            <Github className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                            <Input
                                                id="profile-github"
                                                className="h-9 text-sm pl-9"
                                                placeholder="https://github.com/..."
                                                value={profileGithub}
                                                onChange={(e) => setProfileGithub(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </SectionRow>

                            {/* Save Profile */}
                            <div className="flex justify-end pt-4">
                                <Button
                                    size="sm"
                                    className="h-8 text-xs"
                                    onClick={handleSaveProfile}
                                    disabled={saveProfileMutation.isPending}
                                >
                                    {saveProfileMutation.isPending ? (
                                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                    ) : (
                                        <Save className="h-3.5 w-3.5 mr-1.5" />
                                    )}
                                    Save Profile
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ═══════════════ General Tab ═══════════════ */}
                <TabsContent value="general" className="mt-4">
                    <Card className="border-border">
                        <CardContent className="p-5 sm:p-6">
                            {/* Your Timezone */}
                            <SectionRow
                                icon={Globe}
                                iconColor="text-blue-500"
                                iconBg="bg-blue-500/10"
                                title="Your Timezone"
                                description="Used for today's total, dashboard date filters, and reports."
                            >
                                <div className="flex gap-2 items-end">
                                    <div className="grid gap-1.5 flex-1 max-w-xs">
                                        <Label htmlFor="user-tz" className="text-xs">Timezone</Label>
                                        <Select
                                            value={userTimezone}
                                            onValueChange={(v) => v && setUserTimezone(v)}
                                        >
                                            <SelectTrigger id="user-tz" className="h-9 text-sm">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {timezones.map((tz) => (
                                                    <SelectItem key={tz} value={tz}>
                                                        {tz.replace(/_/g, " ")}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-9 text-xs shrink-0"
                                        onClick={handleSaveUserTimezone}
                                        disabled={
                                            updateProfileMutation.isPending ||
                                            userTimezone === (user?.timezone ?? "UTC")
                                        }
                                    >
                                        {updateProfileMutation.isPending ? (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                            <Save className="h-3.5 w-3.5 mr-1" />
                                        )}
                                        Save
                                    </Button>
                                </div>
                            </SectionRow>

                            {/* Security */}
                            <SectionRow
                                icon={Lock}
                                iconColor="text-red-500"
                                iconBg="bg-red-500/10"
                                title="Security"
                                description="Change your account password. You'll stay logged in after updating."
                            >
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                    <div className="grid gap-1.5">
                                        <Label htmlFor="current-password" className="text-xs">Current password</Label>
                                        <PasswordInput
                                            id="current-password"
                                            autoComplete="current-password"
                                            aria-describedby={passwordErrors.current_password ? "current-password-error" : undefined}
                                            aria-invalid={!!passwordErrors.current_password}
                                            value={currentPassword}
                                            onChange={(e) => {
                                                setCurrentPassword(e.target.value);
                                                if (passwordErrors.current_password) {
                                                    setPasswordErrors((prev) => ({ ...prev, current_password: undefined }));
                                                }
                                            }}
                                            className={`h-9 text-sm ${passwordErrors.current_password ? "border-destructive focus-visible:ring-destructive" : ""}`}
                                        />
                                        {passwordErrors.current_password && (
                                            <p id="current-password-error" className="text-xs text-destructive" role="alert">
                                                {passwordErrors.current_password}
                                            </p>
                                        )}
                                    </div>
                                    <div className="grid gap-1.5">
                                        <Label htmlFor="new-password" className="text-xs">New password</Label>
                                        <PasswordInput
                                            id="new-password"
                                            autoComplete="new-password"
                                            aria-describedby={`new-password-hint${passwordErrors.password ? " new-password-error" : ""}`}
                                            aria-invalid={!!passwordErrors.password}
                                            value={newPassword}
                                            onChange={(e) => {
                                                setNewPassword(e.target.value);
                                                if (passwordErrors.password) {
                                                    setPasswordErrors((prev) => ({ ...prev, password: undefined }));
                                                }
                                            }}
                                            className={`h-9 text-sm ${passwordErrors.password ? "border-destructive focus-visible:ring-destructive" : ""}`}
                                        />
                                        <p id="new-password-hint" className="text-[0.6rem] text-muted-foreground">
                                            Minimum 8 characters
                                        </p>
                                        {passwordErrors.password && (
                                            <p id="new-password-error" className="text-xs text-destructive" role="alert">
                                                {passwordErrors.password}
                                            </p>
                                        )}
                                    </div>
                                    <div className="grid gap-1.5">
                                        <Label htmlFor="new-password-confirm" className="text-xs">Confirm password</Label>
                                        <PasswordInput
                                            id="new-password-confirm"
                                            autoComplete="new-password"
                                            aria-describedby={passwordErrors.password_confirmation ? "confirm-password-error" : undefined}
                                            aria-invalid={!!passwordErrors.password_confirmation}
                                            value={newPasswordConfirm}
                                            onChange={(e) => {
                                                setNewPasswordConfirm(e.target.value);
                                                if (passwordErrors.password_confirmation) {
                                                    setPasswordErrors((prev) => ({ ...prev, password_confirmation: undefined }));
                                                }
                                            }}
                                            className={`h-9 text-sm ${passwordErrors.password_confirmation ? "border-destructive focus-visible:ring-destructive" : ""}`}
                                        />
                                        {passwordErrors.password_confirmation && (
                                            <p id="confirm-password-error" className="text-xs text-destructive" role="alert">
                                                {passwordErrors.password_confirmation}
                                            </p>
                                        )}
                                    </div>
                                </div>
                                <div>
                                    <Button
                                        size="sm"
                                        className="h-8 text-xs"
                                        onClick={handleChangePassword}
                                        disabled={changePasswordMutation.isPending}
                                    >
                                        {changePasswordMutation.isPending ? (
                                            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                        ) : (
                                            <Lock className="h-3.5 w-3.5 mr-1.5" />
                                        )}
                                        Update Password
                                    </Button>
                                </div>
                            </SectionRow>

                            {/* Organization */}
                            <SectionRow
                                icon={Settings}
                                iconColor="text-emerald-500"
                                iconBg="bg-emerald-500/10"
                                title="Organization"
                                description="General organization settings visible to all members."
                            >
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="grid gap-1.5">
                                        <Label htmlFor="org-name" className="text-xs">Organization Name</Label>
                                        <Input
                                            id="org-name"
                                            className="h-9 text-sm"
                                            value={orgName}
                                            onChange={(e) => setOrgName(e.target.value)}
                                            disabled={!isAdmin}
                                        />
                                    </div>
                                    <div className="grid gap-1.5">
                                        <Label htmlFor="org-tz" className="text-xs">Timezone</Label>
                                        <Select
                                            value={timezone}
                                            onValueChange={(v) => v && setTimezone(v)}
                                            disabled={!isAdmin}
                                        >
                                            <SelectTrigger id="org-tz" className="h-9 text-sm">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {timezones.map((tz) => (
                                                    <SelectItem key={tz} value={tz}>
                                                        {tz.replace(/_/g, " ")}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <div className="grid gap-1.5">
                                    <Label htmlFor="org-slug" className="text-xs">Organization Slug</Label>
                                    <div className="flex items-center gap-2 max-w-md">
                                        <Input
                                            id="org-slug"
                                            value={data?.organization.slug ?? ""}
                                            readOnly
                                            className="h-9 text-sm bg-muted/50 font-mono"
                                            onFocus={(e) => e.target.select()}
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-9 w-9 p-0 shrink-0"
                                            onClick={handleCopySlug}
                                            disabled={!data?.organization.slug}
                                            aria-label="Copy organization slug"
                                        >
                                            <Copy className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                    <p className="text-[0.6rem] text-muted-foreground">
                                        Public identifier — case sensitive. Copy rather than retyping.
                                    </p>
                                </div>

                                {isAdmin && (
                                    <>
                                        <div className="flex items-center justify-between gap-4 rounded-lg border border-border/50 p-3">
                                            <div className="min-w-0">
                                                <Label className="text-xs">Idle alert emails</Label>
                                                <p className="text-[0.6rem] text-muted-foreground">
                                                    Send an email when an employee remains idle
                                                </p>
                                            </div>
                                            <Switch
                                                checked={idleAlertEmailEnabled}
                                                onCheckedChange={setIdleAlertEmailEnabled}
                                                aria-label="Idle alert emails"
                                            />
                                        </div>
                                        {idleAlertEmailEnabled && (
                                            <div className="grid gap-1.5 max-w-[160px]">
                                                <Label htmlFor="idle-alert-email-cooldown" className="text-xs">
                                                    Cooldown (minutes)
                                                </Label>
                                                <Input
                                                    id="idle-alert-email-cooldown"
                                                    type="number"
                                                    min={5}
                                                    max={1440}
                                                    value={idleAlertEmailCooldownMin}
                                                    onChange={(e) => setIdleAlertEmailCooldownMin(e.target.value)}
                                                    className="h-9 text-sm"
                                                />
                                                <p className="text-[0.6rem] text-muted-foreground">
                                                    Min time between emails per employee
                                                </p>
                                            </div>
                                        )}
                                    </>
                                )}

                                <div className="flex items-center gap-3 text-xs text-muted-foreground rounded-lg bg-muted/40 px-3 py-2">
                                    <span>
                                        Plan:{" "}
                                        <strong className="text-foreground capitalize">
                                            {data?.organization.plan}
                                        </strong>
                                    </span>
                                    {data?.organization.trial_ends_at && (
                                        <>
                                            <span className="text-border">|</span>
                                            <span>
                                                Trial ends:{" "}
                                                {new Date(data.organization.trial_ends_at).toLocaleDateString()}
                                            </span>
                                        </>
                                    )}
                                </div>
                            </SectionRow>

                            {/* Billing */}
                            {isAdmin && (
                                <SectionRow
                                    icon={CreditCard}
                                    iconColor="text-violet-500"
                                    iconBg="bg-violet-500/10"
                                    title="Billing"
                                    description="Manage your subscription and payment methods."
                                    last
                                >
                                    <Link href="/settings/billing">
                                        <Button variant="outline" size="sm" className="h-8 text-xs">
                                            <CreditCard className="h-3.5 w-3.5 mr-1.5" />
                                            Manage Billing
                                        </Button>
                                    </Link>
                                </SectionRow>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ═══════════════ Tracking Tab ═══════════════ */}
                {isAdmin && (
                    <TabsContent value="tracking" className="mt-4">
                        <Card className="border-border">
                            <CardContent className="p-5 sm:p-6">
                                {/* Screenshots */}
                                <SectionRow
                                    icon={Camera}
                                    iconColor="text-blue-500"
                                    iconBg="bg-blue-500/10"
                                    title="Screenshots"
                                    description="Configure when and how screenshots are captured."
                                >
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div className="grid gap-1.5">
                                            <Label htmlFor="ss-interval" className="text-xs">Capture Interval</Label>
                                            <Select
                                                value={screenshotInterval}
                                                onValueChange={(v) => v && setScreenshotInterval(v)}
                                                disabled={!isAdmin}
                                            >
                                                <SelectTrigger id="ss-interval" className="h-9 text-sm">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="5">Every 5 minutes</SelectItem>
                                                    <SelectItem value="10">Every 10 minutes</SelectItem>
                                                    <SelectItem value="15">Every 15 minutes</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="grid gap-1.5">
                                            <Label htmlFor="ss-first-delay" className="text-xs">First capture delay</Label>
                                            <Input
                                                id="ss-first-delay"
                                                type="number"
                                                min={0}
                                                max={60}
                                                value={screenshotFirstCaptureDelayMin}
                                                onChange={(e) => setScreenshotFirstCaptureDelayMin(e.target.value)}
                                                disabled={!isAdmin}
                                                className="h-9 text-sm"
                                            />
                                            <p className="text-[0.6rem] text-muted-foreground">
                                                Minutes before first screenshot (0 = immediate)
                                            </p>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between gap-4 rounded-lg border border-border/50 p-3">
                                            <div className="min-w-0">
                                                <Label className="text-xs">Blur Screenshots</Label>
                                                <p className="text-[0.6rem] text-muted-foreground">Apply blur for privacy</p>
                                            </div>
                                            <Switch checked={screenshotBlur} onCheckedChange={setScreenshotBlur} disabled={!isAdmin} />
                                        </div>
                                        <div className="flex items-center justify-between gap-4 rounded-lg border border-border/50 p-3">
                                            <div className="min-w-0">
                                                <Label className="text-xs">Capture only when app visible</Label>
                                                <p className="text-[0.6rem] text-muted-foreground">Skip when desktop app is minimized</p>
                                            </div>
                                            <Switch checked={captureOnlyWhenVisible} onCheckedChange={setCaptureOnlyWhenVisible} disabled={!isAdmin} />
                                        </div>
                                        <div className="flex items-center justify-between gap-4 rounded-lg border border-border/50 p-3">
                                            <div className="min-w-0">
                                                <Label className="text-xs">Multi-monitor capture</Label>
                                                <p className="text-[0.6rem] text-muted-foreground">Capture all monitors into one image</p>
                                            </div>
                                            <Switch checked={captureMultiMonitor} onCheckedChange={setCaptureMultiMonitor} disabled={!isAdmin} />
                                        </div>
                                    </div>
                                </SectionRow>

                                {/* Time Tracking */}
                                <SectionRow
                                    icon={Clock}
                                    iconColor="text-emerald-500"
                                    iconBg="bg-emerald-500/10"
                                    title="Time Tracking"
                                    description="Configure idle detection and tracking behavior."
                                >
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div className="grid gap-1.5">
                                            <Label className="text-xs">Idle detection</Label>
                                            <Select
                                                value={
                                                    [5, 10, 20].includes(parseInt(idleTimeout, 10))
                                                        ? idleTimeout
                                                        : "custom"
                                                }
                                                onValueChange={(v) => {
                                                    if (v === "custom") setIdleTimeout(idleTimeoutCustom || "15");
                                                    else if (v) setIdleTimeout(v);
                                                }}
                                                disabled={!isAdmin}
                                            >
                                                <SelectTrigger className="h-9 text-sm">
                                                    <SelectValue placeholder="Idle timeout" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="5">5 minutes</SelectItem>
                                                    <SelectItem value="10">10 minutes</SelectItem>
                                                    <SelectItem value="20">20 minutes</SelectItem>
                                                    <SelectItem value="custom">Custom</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            {(idleTimeout === "custom" ||
                                                ![5, 10, 20].includes(parseInt(idleTimeout, 10))) && (
                                                <div className="flex items-center gap-2">
                                                    <Input
                                                        type="number"
                                                        min="1"
                                                        max="30"
                                                        value={idleTimeout === "custom" ? idleTimeoutCustom : idleTimeout}
                                                        onChange={(e) => {
                                                            const v = e.target.value;
                                                            setIdleTimeout("custom");
                                                            setIdleTimeoutCustom(v);
                                                        }}
                                                        disabled={!isAdmin}
                                                        className="w-24 h-9 text-sm"
                                                    />
                                                    <span className="text-xs text-muted-foreground">minutes</span>
                                                </div>
                                            )}
                                            <p className="text-[0.6rem] text-muted-foreground">
                                                Show idle alert after inactivity
                                            </p>
                                        </div>
                                        <div className="grid gap-1.5">
                                            <Label className="text-xs">When idle is detected</Label>
                                            <Select
                                                value={keepIdleTime}
                                                onValueChange={(v) => {
                                                    if (v) setKeepIdleTime(v as "prompt" | "never");
                                                }}
                                                disabled={!isAdmin}
                                            >
                                                <SelectTrigger className="h-9 text-sm">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="prompt">Prompt user</SelectItem>
                                                    <SelectItem value="never">Always discard</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <p className="text-[0.6rem] text-muted-foreground">
                                                Ask before discarding idle time, or discard silently
                                            </p>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between gap-4 rounded-lg border border-border/50 p-3">
                                            <div className="min-w-0">
                                                <Label className="text-xs">Idle alert auto-stop</Label>
                                                <p className="text-[0.6rem] text-muted-foreground">
                                                    Auto-stop timer if the idle popup gets no response
                                                </p>
                                            </div>
                                            <Switch checked={idleAlertAutoStopEnabled} onCheckedChange={setIdleAlertAutoStopEnabled} disabled={!isAdmin} />
                                        </div>
                                        {idleAlertAutoStopEnabled && (
                                            <div className="flex items-center gap-2 pl-3">
                                                <Input
                                                    type="number"
                                                    min="1"
                                                    max="240"
                                                    value={idleAlertAutoStopMin}
                                                    onChange={(e) => setIdleAlertAutoStopMin(e.target.value)}
                                                    disabled={!isAdmin}
                                                    className="w-24 h-9 text-sm"
                                                />
                                                <span className="text-[0.6rem] text-muted-foreground">
                                                    minutes (max 4 hours)
                                                </span>
                                            </div>
                                        )}
                                        <div className="flex items-center justify-between gap-4 rounded-lg border border-border/50 p-3">
                                            <div className="min-w-0">
                                                <Label className="text-xs">Screenshot on idle resume</Label>
                                                <p className="text-[0.6rem] text-muted-foreground">
                                                    Capture after idle alert is resolved
                                                </p>
                                            </div>
                                            <Switch checked={screenshotImmediateAfterIdle} onCheckedChange={setScreenshotImmediateAfterIdle} disabled={!isAdmin} />
                                        </div>
                                    </div>

                                    <div className="grid gap-1.5 max-w-[160px]">
                                        <Label className="text-xs">Idle check interval</Label>
                                        <Input
                                            type="number"
                                            min={1}
                                            max={60}
                                            value={idleCheckIntervalSec}
                                            onChange={(e) => setIdleCheckIntervalSec(e.target.value)}
                                            disabled={!isAdmin}
                                            className="h-9 text-sm"
                                        />
                                        <p className="text-[0.6rem] text-muted-foreground">Seconds between checks</p>
                                    </div>
                                </SectionRow>

                                {/* Policies */}
                                <SectionRow
                                    icon={Shield}
                                    iconColor="text-amber-500"
                                    iconBg="bg-amber-500/10"
                                    title="Policies"
                                    description="Rules that apply to all employees in the organization."
                                    last
                                >
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between gap-4 rounded-lg border border-border/50 p-3">
                                            <div className="min-w-0">
                                                <Label className="text-xs">Track browser URLs</Label>
                                                <p className="text-[0.6rem] text-muted-foreground">Record active URL with each screenshot</p>
                                            </div>
                                            <Switch checked={trackUrls} onCheckedChange={setTrackUrls} disabled={!isAdmin} aria-label="Track browser URLs" />
                                        </div>
                                        <div className="flex items-center justify-between gap-4 rounded-lg border border-border/50 p-3">
                                            <div className="min-w-0">
                                                <Label className="text-xs">Allow manual time entries</Label>
                                                <p className="text-[0.6rem] text-muted-foreground">Employees can add time entries manually</p>
                                            </div>
                                            <Switch checked={allowManualTime} onCheckedChange={setAllowManualTime} disabled={!isAdmin} aria-label="Allow manual time entries" />
                                        </div>
                                        <div className="flex items-center justify-between gap-4 rounded-lg border border-border/50 p-3">
                                            <div className="min-w-0">
                                                <Label className="text-xs">Require project selection</Label>
                                                <p className="text-[0.6rem] text-muted-foreground">Must select a project before starting timer</p>
                                            </div>
                                            <Switch checked={requireProject} onCheckedChange={setRequireProject} disabled={!isAdmin} aria-label="Require project selection" />
                                        </div>
                                    </div>
                                    <div className="grid gap-1.5 max-w-[160px]">
                                        <Label htmlFor="weekly-limit" className="text-xs">Weekly hour limit</Label>
                                        <Input
                                            id="weekly-limit"
                                            type="number"
                                            min={0}
                                            max={168}
                                            value={weeklyLimitHours}
                                            onChange={(e) => setWeeklyLimitHours(e.target.value)}
                                            disabled={!isAdmin}
                                            placeholder="0 = unlimited"
                                            className="h-9 text-sm"
                                            aria-label="Weekly hour limit"
                                        />
                                        <p className="text-[0.6rem] text-muted-foreground">
                                            Max hours per week. 0 = unlimited.
                                        </p>
                                    </div>
                                </SectionRow>
                            </CardContent>
                        </Card>
                    </TabsContent>
                )}

                {/* ═══════════════ Notifications Tab ═══════════════ */}
                <TabsContent value="notifications" className="mt-4">
                    <Card className="border-border">
                        <CardContent className="p-5 sm:p-6">
                            <EmailReportsCard />
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}

// ─── Email Reports Card (Notifications Tab) ────────────────────────

const DAY_OPTIONS = [
    { value: "1", label: "Monday" },
    { value: "2", label: "Tuesday" },
    { value: "3", label: "Wednesday" },
    { value: "4", label: "Thursday" },
    { value: "5", label: "Friday" },
    { value: "6", label: "Saturday" },
    { value: "0", label: "Sunday" },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
    value: `${String(i).padStart(2, "0")}:00`,
    label: `${String(i).padStart(2, "0")}:00`,
}));

const COMMON_TIMEZONES = [
    "UTC",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Europe/Moscow",
    "Asia/Dubai",
    "Asia/Karachi",
    "Asia/Kolkata",
    "Asia/Shanghai",
    "Asia/Tokyo",
    "Australia/Sydney",
    "Pacific/Auckland",
];

function EmailReportsCard() {
    const { data, isLoading, isError } = useReportSubscriptions();
    const upsertMutation = useUpsertReportSubscription();

    const existing = data?.data?.find(
        (s: ReportSubscription) => s.report_type === "weekly_summary",
    );

    const detectedTimezone =
        typeof window !== "undefined"
            ? Intl.DateTimeFormat().resolvedOptions().timeZone
            : "UTC";

    const [isActive, setIsActive] = useState(false);
    const [dayOfWeek, setDayOfWeek] = useState("1");
    const [sendTime, setSendTime] = useState("08:00");
    const [timezone, setTimezone] = useState(detectedTimezone);
    const [initialized, setInitialized] = useState(false);

    useEffect(() => {
        if (!data || initialized) return;
        if (existing) {
            setIsActive(existing.is_active);
            setDayOfWeek(String(existing.day_of_week));
            setSendTime(existing.send_time);
            setTimezone(existing.timezone);
        } else {
            setTimezone(detectedTimezone);
        }
        setInitialized(true);
    }, [data, existing, initialized, detectedTimezone]);

    const handleSave = useCallback(() => {
        upsertMutation.mutate({
            report_type: "weekly_summary",
            is_active: isActive,
            day_of_week: Number(dayOfWeek),
            send_time: sendTime,
            timezone,
        });
    }, [upsertMutation, isActive, dayOfWeek, sendTime, timezone]);

    if (isLoading) {
        return (
            <div className="space-y-3">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-52" />
                <Skeleton className="h-24 w-full rounded-lg" />
            </div>
        );
    }

    if (isError) {
        return (
            <div className="rounded-lg border border-destructive/50 p-4">
                <p className="text-xs text-destructive">Failed to load email report settings.</p>
            </div>
        );
    }

    return (
        <SectionRow
            icon={Mail}
            iconColor="text-blue-500"
            iconBg="bg-blue-500/10"
            title="Email Reports"
            description="Receive automated summaries of your tracked hours by email."
            last
        >
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border/50 p-3">
                <div className="min-w-0">
                    <span className="text-xs font-medium">Weekly Summary</span>
                    <p className="text-[0.6rem] text-muted-foreground">
                        Get a weekly overview of your tracked hours and activity
                    </p>
                </div>
                <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>

            {isActive && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="grid gap-1.5">
                        <Label htmlFor="email-day" className="text-xs">Day</Label>
                        <Select
                            value={dayOfWeek}
                            onValueChange={(v) => { if (v) setDayOfWeek(v); }}
                        >
                            <SelectTrigger className="h-9 text-sm" id="email-day">
                                <SelectValue placeholder="Select day" />
                            </SelectTrigger>
                            <SelectContent>
                                {DAY_OPTIONS.map((d) => (
                                    <SelectItem key={d.value} value={d.value}>
                                        {d.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor="email-time" className="text-xs">Time</Label>
                        <Select
                            value={sendTime}
                            onValueChange={(v) => { if (v) setSendTime(v); }}
                        >
                            <SelectTrigger className="h-9 text-sm" id="email-time">
                                <SelectValue placeholder="Select time" />
                            </SelectTrigger>
                            <SelectContent>
                                {HOUR_OPTIONS.map((h) => (
                                    <SelectItem key={h.value} value={h.value}>
                                        {h.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor="email-tz" className="text-xs">Timezone</Label>
                        <Select
                            value={timezone}
                            onValueChange={(v) => { if (v) setTimezone(v); }}
                        >
                            <SelectTrigger className="h-9 text-sm" id="email-tz">
                                <SelectValue placeholder="Select timezone" />
                            </SelectTrigger>
                            <SelectContent>
                                {COMMON_TIMEZONES.map((tz) => (
                                    <SelectItem key={tz} value={tz}>
                                        {tz}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            )}

            <div className="flex justify-end">
                <Button
                    size="sm"
                    className="h-8 text-xs"
                    onClick={handleSave}
                    disabled={upsertMutation.isPending}
                >
                    {upsertMutation.isPending && (
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    )}
                    Save Changes
                </Button>
            </div>
        </SectionRow>
    );
}
