'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings,
  Save,
  Loader2,
  CreditCard,
  Camera,
  Lock,
  Linkedin,
  Github,
} from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import type { AxiosError } from 'axios';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { DatePicker } from '@/components/ui/date-picker';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import api from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { User as UserIcon } from 'lucide-react';

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
      keep_idle_time?: 'prompt' | 'always' | 'never';
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
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
];

export default function SettingsPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === 'owner' || user?.role === 'admin';
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<{
    current_password?: string;
    password?: string;
    password_confirmation?: string;
  }>({});

  const { data, isLoading } = useQuery<OrgSettings>({
    queryKey: ['org-settings'],
    queryFn: async () => {
      const res = await api.get('/settings');
      return res.data;
    },
  });

  const settings = data?.organization?.settings;
  const defaults = useMemo(() => ({
    orgName: data?.organization?.name ?? '',
    timezone: settings?.timezone ?? 'UTC',
    screenshotInterval: settings ? String(settings.screenshot_interval) : '5',
    screenshotBlur: settings?.blur_screenshots ?? false,
    idleTimeout: settings?.idle_timeout != null && settings.idle_timeout > 0 ? String(settings.idle_timeout) : '0',
    idleTimeoutCustom: settings?.idle_timeout != null && settings.idle_timeout > 0 && ![5, 10, 20].includes(settings.idle_timeout) ? String(settings.idle_timeout) : '',
    keepIdleTime: (settings?.keep_idle_time as 'prompt' | 'always' | 'never') ?? 'prompt',
    idleAlertAutoStopMin: settings?.idle_alert_auto_stop_min != null ? String(settings.idle_alert_auto_stop_min) : '10',
    idleAlertEmailEnabled: settings?.idle_alert_email_enabled ?? false,
    idleAlertEmailCooldownMin: settings?.idle_alert_email_cooldown_min != null ? String(settings.idle_alert_email_cooldown_min) : '60',
    screenshotImmediateAfterIdle: settings?.screenshot_capture_immediate_after_idle ?? true,
    screenshotFirstCaptureDelayMin: settings?.screenshot_first_capture_delay_min != null ? String(settings.screenshot_first_capture_delay_min) : '1',
    idleCheckIntervalSec: settings?.idle_check_interval_sec != null ? String(settings.idle_check_interval_sec) : '10',
    captureOnlyWhenVisible: settings?.capture_only_when_visible ?? false,
    captureMultiMonitor: settings?.capture_multi_monitor ?? false,
    trackUrls: settings?.track_urls ?? false,
    allowManualTime: settings?.can_add_manual_time ?? true,
    requireProject: settings?.require_project ?? false,
    weeklyLimitHours: settings?.weekly_limit_hours != null && settings.weekly_limit_hours > 0 ? String(settings.weekly_limit_hours) : '0',
  }), [data, settings]);

  const [orgName, setOrgName] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [screenshotInterval, setScreenshotInterval] = useState('5');
  const [screenshotBlur, setScreenshotBlur] = useState(false);
  const [idleTimeout, setIdleTimeout] = useState('5');
  const [idleTimeoutCustom, setIdleTimeoutCustom] = useState('');
  const [keepIdleTime, setKeepIdleTime] = useState<'prompt' | 'always' | 'never'>('prompt');
  const [idleAlertAutoStopMin, setIdleAlertAutoStopMin] = useState('10');
  const [idleAlertEmailEnabled, setIdleAlertEmailEnabled] = useState(false);
  const [idleAlertEmailCooldownMin, setIdleAlertEmailCooldownMin] = useState('60');
  const [screenshotImmediateAfterIdle, setScreenshotImmediateAfterIdle] = useState(true);
  const [screenshotFirstCaptureDelayMin, setScreenshotFirstCaptureDelayMin] = useState('1');
  const [idleCheckIntervalSec, setIdleCheckIntervalSec] = useState('10');
  const [captureOnlyWhenVisible, setCaptureOnlyWhenVisible] = useState(false);
  const [captureMultiMonitor, setCaptureMultiMonitor] = useState(false);
  const [trackUrls, setTrackUrls] = useState(false);
  const [allowManualTime, setAllowManualTime] = useState(true);
  const [requireProject, setRequireProject] = useState(false);
  const [weeklyLimitHours, setWeeklyLimitHours] = useState('0');
  const [initialized, setInitialized] = useState(false);
  const [userTimezone, setUserTimezone] = useState(user?.timezone ?? 'UTC');
  const { fetchUser } = useAuthStore();

  // Sync form state from fetched data
  useEffect(() => {
    if (!data || initialized) return;
    // eslint-disable-next-line
    setOrgName(defaults.orgName);
    setTimezone(defaults.timezone);
    setUserTimezone(user?.timezone ?? defaults.timezone);
    setScreenshotInterval(defaults.screenshotInterval);
    setScreenshotBlur(defaults.screenshotBlur);
    setIdleTimeout(defaults.idleTimeout);
    setIdleTimeoutCustom(defaults.idleTimeoutCustom);
    setKeepIdleTime(defaults.keepIdleTime);
    setIdleAlertAutoStopMin(defaults.idleAlertAutoStopMin);
    setIdleAlertEmailEnabled(defaults.idleAlertEmailEnabled);
    setIdleAlertEmailCooldownMin(defaults.idleAlertEmailCooldownMin);
    setScreenshotImmediateAfterIdle(defaults.screenshotImmediateAfterIdle);
    setScreenshotFirstCaptureDelayMin(defaults.screenshotFirstCaptureDelayMin);
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
      return api.put('/settings', settings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-settings'] });
      toast.success('Settings saved successfully');
    },
    onError: () => toast.error('Failed to save settings'),
  });

  const updateProfileMutation = useMutation({
    mutationFn: async (payload: { timezone: string }) => {
      return api.patch('/auth/me', payload);
    },
    onSuccess: async () => {
      await fetchUser();
      toast.success('Your timezone has been updated');
    },
    onError: () => toast.error('Failed to update timezone'),
  });

  // ── Profile tab state ──
  const fileRef = useRef<HTMLInputElement>(null);
  const [profileName, setProfileName] = useState(user?.name ?? '');
  const [profileJobTitle, setProfileJobTitle] = useState(user?.job_title ?? '');
  const [profilePhone, setProfilePhone] = useState(user?.phone ?? '');
  const [profileTimezone, setProfileTimezone] = useState(user?.timezone ?? 'UTC');
  const [profileBio, setProfileBio] = useState(user?.bio ?? '');
  const [profileDob, setProfileDob] = useState(user?.date_of_birth ?? '');
  const [profileDoj, setProfileDoj] = useState(user?.date_of_joining ?? '');
  const [profileLinkedin, setProfileLinkedin] = useState(user?.linkedin_url ?? '');
  const [profileGithub, setProfileGithub] = useState(user?.github_url ?? '');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [profileInitialized, setProfileInitialized] = useState(false);

  useEffect(() => {
    if (!user || profileInitialized) return;
    setProfileName(user.name ?? '');
    setProfileJobTitle(user.job_title ?? '');
    setProfilePhone(user.phone ?? '');
    setProfileTimezone(user.timezone ?? 'UTC');
    setProfileBio(user.bio ?? '');
    setProfileDob(user.date_of_birth ?? '');
    setProfileDoj(user.date_of_joining ?? '');
    setProfileLinkedin(user.linkedin_url ?? '');
    setProfileGithub(user.github_url ?? '');
    setProfileInitialized(true);
  }, [user, profileInitialized]);

  const saveProfileMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await api.put('/profile', data);
      return res.data;
    },
    onSuccess: (data) => {
      if (data.user) {
        useAuthStore.getState().setUser(data.user);
      }
      toast.success('Profile updated successfully');
    },
    onError: () => toast.error('Failed to update profile'),
  });

  const uploadAvatarMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('avatar', file);
      const res = await api.post('/profile/avatar', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data;
    },
    onSuccess: (data) => {
      const currentUser = useAuthStore.getState().user;
      if (currentUser) {
        useAuthStore.getState().setUser({ ...currentUser, avatar_url: data.avatar_url });
      }
      setAvatarPreview(null);
      toast.success('Profile photo updated');
    },
    onError: () => {
      setAvatarPreview(null);
      toast.error('Failed to upload photo');
    },
  });

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error('File must be under 2MB');
      return;
    }
    // Show local preview immediately
    const previewUrl = URL.createObjectURL(file);
    setAvatarPreview(previewUrl);
    uploadAvatarMutation.mutate(file);
    // Reset input so the same file can be re-selected
    e.target.value = '';
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
      ?.split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || '??';

  const handleSave = () => {
    const rawIdle = idleTimeout === '0' ? 0 : (idleTimeout === 'custom' ? idleTimeoutCustom : idleTimeout);
    const idleVal = rawIdle === '' || rawIdle === '0' ? 0 : Math.min(30, Math.max(0, parseInt(String(rawIdle), 10) || 0));
    const idleAutoStopMinVal = Math.min(
      60,
      Math.max(1, parseInt(String(idleAlertAutoStopMin), 10) || 10)
    );
    const idleEmailCooldownMinVal = Math.min(
      1440,
      Math.max(5, parseInt(String(idleAlertEmailCooldownMin), 10) || 60)
    );
    const firstDelayMinVal = Math.min(60, Math.max(0, parseInt(String(screenshotFirstCaptureDelayMin), 10) || 1));
    const idleCheckSecVal = Math.min(60, Math.max(1, parseInt(String(idleCheckIntervalSec), 10) || 10));
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
        screenshot_capture_immediate_after_idle: screenshotImmediateAfterIdle,
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

  const validatePasswordForm = (): boolean => {
    const errors: typeof passwordErrors = {};
    if (!currentPassword.trim()) {
      errors.current_password = 'Current password is required.';
    }
    if (!newPassword) {
      errors.password = 'New password is required.';
    } else if (newPassword.length < 8) {
      errors.password = 'Password must be at least 8 characters.';
    }
    if (!newPasswordConfirm) {
      errors.password_confirmation = 'Please confirm your new password.';
    } else if (newPassword && newPasswordConfirm !== newPassword) {
      errors.password_confirmation = 'New password and confirmation do not match.';
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
    mutationFn: async (payload: { current_password: string; password: string; password_confirmation: string }) => {
      return api.post('/auth/change-password', payload);
    },
    onSuccess: (res) => {
      if (typeof window !== 'undefined') {
        localStorage.setItem('access_token', res.data.access_token);
        localStorage.setItem('refresh_token', res.data.refresh_token);
      }
      setCurrentPassword('');
      setNewPassword('');
      setNewPasswordConfirm('');
      setPasswordErrors({});
      toast.success('Password updated');
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
        'Failed to update password';
      toast.error(msg);
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Settings</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your organization settings</p>
        </div>
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-40 bg-muted/50 animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Settings</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your organization settings</p>
        </div>
        {isAdmin && (
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save Changes
          </Button>
        )}
      </div>

      <Tabs defaultValue="profile">
        <TabsList className="bg-muted/50">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="general">General</TabsTrigger>
          {isAdmin && <TabsTrigger value="tracking">Tracking</TabsTrigger>}
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile" className="space-y-6 mt-6">
          {/* Avatar + Name Header */}
          <Card className="border-border bg-card/50">
            <CardContent className="pt-6">
              <div className="flex items-center gap-6">
                {/* Avatar */}
                <div
                  className="relative group w-24 h-24 cursor-pointer shrink-0"
                  onClick={() => fileRef.current?.click()}
                >
                  <Avatar className="w-24 h-24 border-2 border-border">
                    <AvatarImage src={avatarPreview || user?.avatar_url || undefined} alt={user?.name || 'User'} />
                    <AvatarFallback className="bg-blue-600 text-white text-2xl font-medium">
                      {profileInitials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="absolute inset-0 bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1">
                    <Camera className="w-5 h-5 text-white" />
                    <span className="text-white text-[10px] font-medium">Change</span>
                  </div>
                  {uploadAvatarMutation.isPending && (
                    <div className="absolute inset-0 bg-black/60 rounded-full flex items-center justify-center">
                      <Loader2 className="w-6 h-6 text-white animate-spin" />
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
                <div className="flex flex-col gap-1">
                  <h2 className="text-xl font-semibold text-foreground">{user?.name}</h2>
                  {user?.job_title && (
                    <p className="text-sm text-muted-foreground">{user.job_title}</p>
                  )}
                  <p className="text-sm text-muted-foreground">{user?.email}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Personal Information */}
          <Card className="border-border bg-card/50">
            <CardHeader>
              <CardTitle className="text-foreground">Personal Information</CardTitle>
              <CardDescription className="text-muted-foreground">
                Update your personal details
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="profile-name">Full Name</Label>
                  <Input
                    id="profile-name"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    className="bg-background/50"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="profile-job-title">Job Title</Label>
                  <Input
                    id="profile-job-title"
                    placeholder="e.g. Senior Developer"
                    value={profileJobTitle}
                    onChange={(e) => setProfileJobTitle(e.target.value)}
                    className="bg-background/50"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="profile-email">Email</Label>
                  <div className="relative" title="Email cannot be changed">
                    <Input
                      id="profile-email"
                      value={user?.email ?? ''}
                      disabled
                      className="bg-muted/50 pr-9"
                    />
                    <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  </div>
                  <p className="text-xs text-muted-foreground">Email cannot be changed</p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="profile-phone">Phone Number</Label>
                  <Input
                    id="profile-phone"
                    placeholder="+1 (555) 000-0000"
                    value={profilePhone}
                    onChange={(e) => setProfilePhone(e.target.value)}
                    className="bg-background/50"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="profile-tz">Timezone</Label>
                  <Select value={profileTimezone} onValueChange={(v) => v && setProfileTimezone(v)}>
                    <SelectTrigger id="profile-tz" className="bg-background/50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {timezones.map((tz) => (
                        <SelectItem key={tz} value={tz}>{tz.replace(/_/g, ' ')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="profile-bio">Bio</Label>
                <Textarea
                  id="profile-bio"
                  placeholder="Tell us a little about yourself..."
                  value={profileBio}
                  onChange={(e) => {
                    if (e.target.value.length <= 500) {
                      setProfileBio(e.target.value);
                    }
                  }}
                  className="bg-background/50 min-h-[80px]"
                  maxLength={500}
                />
                <p className="text-xs text-muted-foreground text-right">
                  {profileBio.length} / 500
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Important Dates */}
          <Card className="border-border bg-card/50">
            <CardHeader>
              <CardTitle className="text-foreground">Important Dates</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Date of Birth</Label>
                  <DatePicker
                    value={profileDob}
                    onChange={setProfileDob}
                    placeholder="Select date of birth"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Date of Joining</Label>
                  <DatePicker
                    value={profileDoj}
                    onChange={setProfileDoj}
                    placeholder="Select date of joining"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Social Links */}
          <Card className="border-border bg-card/50">
            <CardHeader>
              <CardTitle className="text-foreground">Social Links</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="profile-linkedin">LinkedIn</Label>
                <div className="relative">
                  <Linkedin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="profile-linkedin"
                    placeholder="https://linkedin.com/in/your-profile"
                    value={profileLinkedin}
                    onChange={(e) => setProfileLinkedin(e.target.value)}
                    className="bg-background/50 pl-9"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="profile-github">GitHub</Label>
                <div className="relative">
                  <Github className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="profile-github"
                    placeholder="https://github.com/your-username"
                    value={profileGithub}
                    onChange={(e) => setProfileGithub(e.target.value)}
                    className="bg-background/50 pl-9"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Save Profile Button */}
          <div className="flex justify-end">
            <Button
              onClick={handleSaveProfile}
              disabled={saveProfileMutation.isPending}
            >
              {saveProfileMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save Profile
            </Button>
          </div>
        </TabsContent>

        {/* General Tab */}
        <TabsContent value="general" className="space-y-6 mt-6">
          {/* Your timezone — used for "today", dashboard dates, timer */}
          <Card className="border-border bg-card/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-foreground">
                <UserIcon className="h-5 w-5" />
                Your timezone
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                Used for today’s total, dashboard date filters, and reports
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 max-w-md">
                <Label htmlFor="user-tz">Timezone</Label>
                <div className="flex gap-2 items-center">
                  <Select value={userTimezone} onValueChange={(v) => v && setUserTimezone(v)}>
                    <SelectTrigger id="user-tz" className="bg-background/50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {timezones.map((tz) => (
                        <SelectItem key={tz} value={tz}>{tz.replace(/_/g, ' ')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={handleSaveUserTimezone}
                    disabled={updateProfileMutation.isPending || userTimezone === (user?.timezone ?? 'UTC')}
                    variant="outline"
                    className="bg-background/50"
                  >
                    {updateProfileMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-1" />
                    )}
                    Save
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Password */}
          <Card className="border-border bg-card/50">
            <CardHeader>
              <CardTitle className="text-foreground">Security</CardTitle>
              <CardDescription className="text-muted-foreground">
                Change your account password
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 max-w-md">
                <Label htmlFor="current-password">Current password</Label>
                <PasswordInput
                  id="current-password"
                  autoComplete="current-password"
                  aria-describedby={passwordErrors.current_password ? 'current-password-error' : undefined}
                  aria-invalid={!!passwordErrors.current_password}
                  value={currentPassword}
                  onChange={(e) => {
                    setCurrentPassword(e.target.value);
                    if (passwordErrors.current_password) {
                      setPasswordErrors((prev) => ({ ...prev, current_password: undefined }));
                    }
                  }}
                  className={`bg-background/50 ${passwordErrors.current_password ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                />
                {passwordErrors.current_password && (
                  <p id="current-password-error" className="text-sm text-destructive" role="alert">
                    {passwordErrors.current_password}
                  </p>
                )}
              </div>
              <div className="grid gap-2 max-w-md">
                <Label htmlFor="new-password">New password</Label>
                <PasswordInput
                  id="new-password"
                  autoComplete="new-password"
                  aria-describedby={`new-password-hint${passwordErrors.password ? ' new-password-error' : ''}`}
                  aria-invalid={!!passwordErrors.password}
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    if (passwordErrors.password) {
                      setPasswordErrors((prev) => ({ ...prev, password: undefined }));
                    }
                  }}
                  className={`bg-background/50 ${passwordErrors.password ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                />
                <p id="new-password-hint" className="text-xs text-muted-foreground">
                  Minimum 8 characters
                </p>
                {passwordErrors.password && (
                  <p id="new-password-error" className="text-sm text-destructive" role="alert">
                    {passwordErrors.password}
                  </p>
                )}
              </div>
              <div className="grid gap-2 max-w-md">
                <Label htmlFor="new-password-confirm">Confirm new password</Label>
                <PasswordInput
                  id="new-password-confirm"
                  autoComplete="new-password"
                  aria-describedby={passwordErrors.password_confirmation ? 'confirm-password-error' : undefined}
                  aria-invalid={!!passwordErrors.password_confirmation}
                  value={newPasswordConfirm}
                  onChange={(e) => {
                    setNewPasswordConfirm(e.target.value);
                    if (passwordErrors.password_confirmation) {
                      setPasswordErrors((prev) => ({ ...prev, password_confirmation: undefined }));
                    }
                  }}
                  className={`bg-background/50 ${passwordErrors.password_confirmation ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                />
                {passwordErrors.password_confirmation && (
                  <p id="confirm-password-error" className="text-sm text-destructive" role="alert">
                    {passwordErrors.password_confirmation}
                  </p>
                )}
              </div>

              <Button
                onClick={handleChangePassword}
                disabled={changePasswordMutation.isPending}
              >
                {changePasswordMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Update password
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border bg-card/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-foreground">
                <Settings className="h-5 w-5" />
                Organization
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                General organization settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 max-w-md">
                <Label htmlFor="org-name">Organization Name</Label>
                <Input
                  id="org-name"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  disabled={!isAdmin}
                  className="bg-background/50"
                />
              </div>
              <div className="grid gap-2 max-w-md">
                <Label htmlFor="org-tz" className="text-foreground">Timezone</Label>
                <Select value={timezone} onValueChange={(v) => v && setTimezone(v)} disabled={!isAdmin}>
                  <SelectTrigger id="org-tz" className="bg-muted border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {timezones.map((tz) => (
                      <SelectItem key={tz} value={tz}>{tz.replace(/_/g, ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {isAdmin && (
                <>
                  <Separator className="bg-muted" />
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-foreground">Idle alert emails</Label>
                      <p className="text-xs text-muted-foreground">
                        Sends an email when an employee remains idle. The scheduler runs every 5 minutes; cooldown prevents spam.
                      </p>
                    </div>
                    <Switch
                      checked={idleAlertEmailEnabled}
                      onCheckedChange={setIdleAlertEmailEnabled}
                      aria-label="Idle alert emails"
                    />
                  </div>
                  <div className="grid gap-2 max-w-xs">
                    <Label htmlFor="idle-alert-email-cooldown" className="text-foreground">Cooldown (minutes)</Label>
                    <Input
                      id="idle-alert-email-cooldown"
                      type="number"
                      min={5}
                      max={1440}
                      value={idleAlertEmailCooldownMin}
                      onChange={(e) => setIdleAlertEmailCooldownMin(e.target.value)}
                      disabled={!idleAlertEmailEnabled}
                      className="bg-muted border-border text-foreground w-28"
                    />
                    <p className="text-xs text-muted-foreground">
                      Minimum time between emails per employee. Recommended: 60+ minutes.
                    </p>
                  </div>
                </>
              )}

              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>
                  Plan: <strong className="text-foreground capitalize">{data?.organization.plan}</strong>
                </span>
                {data?.organization.trial_ends_at && (
                  <span>
                    | Trial ends: {new Date(data.organization.trial_ends_at).toLocaleDateString()}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Billing Link */}
          {isAdmin && (
            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <CreditCard className="h-5 w-5" />
                  Billing
                </CardTitle>
                <CardDescription className="text-muted-foreground">
                  Manage your subscription and billing
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/settings/billing">
                  <Button variant="outline" className="border-border text-foreground">
                    <CreditCard className="mr-2 h-4 w-4" />
                    Manage Billing
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Tracking Tab */}
        {isAdmin && <TabsContent value="tracking" className="space-y-6 mt-6">
          {/* Screenshot Settings */}
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-foreground">Screenshots</CardTitle>
              <CardDescription className="text-muted-foreground">
                Configure screenshot capture settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-2 max-w-xs">
                <Label htmlFor="ss-interval" className="text-foreground">Capture Interval</Label>
                <Select
                  value={screenshotInterval}
                  onValueChange={(v) => v && setScreenshotInterval(v)}
                  disabled={!isAdmin}
                >
                  <SelectTrigger id="ss-interval" className="bg-muted border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">Every 5 minutes</SelectItem>
                    <SelectItem value="10">Every 10 minutes</SelectItem>
                    <SelectItem value="15">Every 15 minutes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2 max-w-xs">
                <Label htmlFor="ss-first-delay" className="text-foreground">First capture delay</Label>
                <Input
                  id="ss-first-delay"
                  type="number"
                  min={0}
                  max={60}
                  value={screenshotFirstCaptureDelayMin}
                  onChange={(e) => setScreenshotFirstCaptureDelayMin(e.target.value)}
                  disabled={!isAdmin}
                  className="bg-muted border-border text-foreground w-28"
                />
                <p className="text-xs text-muted-foreground">Minutes before first screenshot when timer starts (0 = immediate)</p>
              </div>
              <Separator className="bg-muted" />
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-foreground">Blur Screenshots</Label>
                  <p className="text-xs text-muted-foreground">Apply blur to screenshots for privacy</p>
                </div>
                <Switch checked={screenshotBlur} onCheckedChange={setScreenshotBlur} disabled={!isAdmin} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-foreground">Capture only when app visible</Label>
                  <p className="text-xs text-muted-foreground">Skip screenshots when desktop app is minimized (reduces permission prompts)</p>
                </div>
                <Switch checked={captureOnlyWhenVisible} onCheckedChange={setCaptureOnlyWhenVisible} disabled={!isAdmin} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-foreground">Multi-monitor capture</Label>
                  <p className="text-xs text-muted-foreground">Capture all monitors and composite into one image</p>
                </div>
                <Switch checked={captureMultiMonitor} onCheckedChange={setCaptureMultiMonitor} disabled={!isAdmin} />
              </div>
            </CardContent>
          </Card>

          {/* Tracking Settings */}
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-foreground">Time Tracking</CardTitle>
              <CardDescription className="text-muted-foreground">
                Configure time tracking behavior
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-2 max-w-xs">
                <Label className="text-foreground">Idle detection</Label>
                <Select
                  value={idleTimeout === '0' ? '0' : [5, 10, 20].includes(parseInt(idleTimeout, 10)) ? idleTimeout : 'custom'}
                  onValueChange={(v) => {
                    if (v === '0') setIdleTimeout('0');
                    else if (v === 'custom') setIdleTimeout(idleTimeoutCustom || '15');
                    else if (v) setIdleTimeout(v);
                  }}
                  disabled={!isAdmin}
                >
                  <SelectTrigger className="bg-muted border-border">
                    <SelectValue placeholder="Idle timeout" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5 minutes</SelectItem>
                    <SelectItem value="10">10 minutes</SelectItem>
                    <SelectItem value="20">20 minutes</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                    <SelectItem value="0">Never (disabled)</SelectItem>
                  </SelectContent>
                </Select>
                {(idleTimeout === 'custom' || (idleTimeout !== '0' && ![5, 10, 20].includes(parseInt(idleTimeout, 10)))) && idleTimeout !== '0' && (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min="1"
                      max="30"
                      value={idleTimeout === 'custom' ? idleTimeoutCustom : idleTimeout}
                      onChange={(e) => {
                        const v = e.target.value;
                        setIdleTimeout('custom');
                        setIdleTimeoutCustom(v);
                      }}
                      disabled={!isAdmin}
                      className="w-24 bg-muted border-border text-foreground"
                    />
                    <span className="text-xs text-muted-foreground">minutes</span>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">Show idle alert after this many minutes of no activity (or disable)</p>
              </div>
              <div className="grid gap-2 max-w-xs">
                <Label className="text-foreground">When idle is detected</Label>
                <Select value={keepIdleTime} onValueChange={(v) => { if (v) setKeepIdleTime(v as 'prompt' | 'always' | 'never'); }} disabled={!isAdmin}>
                  <SelectTrigger className="bg-muted border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prompt">Prompt (ask Keep / Discard / Reassign / Stop)</SelectItem>
                    <SelectItem value="always">Always keep idle time</SelectItem>
                    <SelectItem value="never">Always discard idle time</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Whether to show the idle alert or auto-keep / auto-discard</p>
              </div>
              <div className="grid gap-2 max-w-xs">
                <Label className="text-foreground">Idle alert auto-stop</Label>
                <p className="text-xs text-muted-foreground">
                  If idle alert is shown in <strong>Prompt</strong> mode and user does not respond, auto-stop after this many minutes.
                </p>
                <Input
                  type="number"
                  min="1"
                  max="60"
                  value={idleAlertAutoStopMin}
                  onChange={(e) => setIdleAlertAutoStopMin(e.target.value)}
                  disabled={!isAdmin}
                  className="w-28 bg-muted border-border text-foreground"
                />
                <span className="text-xs text-muted-foreground">minutes</span>
              </div>
              <div className="grid gap-2 max-w-xs">
                <Label className="text-foreground">Idle check interval</Label>
                <Input
                  type="number"
                  min={1}
                  max={60}
                  value={idleCheckIntervalSec}
                  onChange={(e) => setIdleCheckIntervalSec(e.target.value)}
                  disabled={!isAdmin}
                  className="w-28 bg-muted border-border text-foreground"
                />
                <p className="text-xs text-muted-foreground">How often (seconds) the desktop app checks for idle activity</p>
              </div>
              <Separator className="bg-muted" />
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-foreground">Screenshot on idle resume</Label>
                  <p className="text-xs text-muted-foreground">Capture one screenshot immediately after idle alert is resolved/discarded.</p>
                </div>
                <Switch
                  checked={screenshotImmediateAfterIdle}
                  onCheckedChange={setScreenshotImmediateAfterIdle}
                  disabled={!isAdmin}
                />
              </div>
            </CardContent>
          </Card>

          {/* Policies */}
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-foreground">Policies</CardTitle>
              <CardDescription className="text-muted-foreground">
                Rules that apply to all employees in the organization
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-foreground">Track browser URLs</Label>
                  <p className="text-xs text-muted-foreground">Record the active browser URL alongside each screenshot</p>
                </div>
                <Switch
                  checked={trackUrls}
                  onCheckedChange={setTrackUrls}
                  disabled={!isAdmin}
                  aria-label="Track browser URLs"
                />
              </div>
              <Separator className="bg-muted" />
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-foreground">Allow manual time entries</Label>
                  <p className="text-xs text-muted-foreground">Allow employees to add time entries manually</p>
                </div>
                <Switch
                  checked={allowManualTime}
                  onCheckedChange={setAllowManualTime}
                  disabled={!isAdmin}
                  aria-label="Allow manual time entries"
                />
              </div>
              <Separator className="bg-muted" />
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-foreground">Require project selection</Label>
                  <p className="text-xs text-muted-foreground">Employees must select a project before starting the timer</p>
                </div>
                <Switch
                  checked={requireProject}
                  onCheckedChange={setRequireProject}
                  disabled={!isAdmin}
                  aria-label="Require project selection"
                />
              </div>
              <Separator className="bg-muted" />
              <div className="grid gap-2 max-w-xs">
                <Label htmlFor="weekly-limit" className="text-foreground">Weekly hour limit</Label>
                <Input
                  id="weekly-limit"
                  type="number"
                  min={0}
                  max={168}
                  value={weeklyLimitHours}
                  onChange={(e) => setWeeklyLimitHours(e.target.value)}
                  disabled={!isAdmin}
                  placeholder="0 = unlimited"
                  className="bg-muted border-border text-foreground w-28"
                  aria-label="Weekly hour limit"
                />
                <p className="text-xs text-muted-foreground">Maximum hours per week per employee. 0 = unlimited.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>}
      </Tabs>
    </div>
  );
}
