'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings,
  Save,
  Loader2,
  CreditCard,
} from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import type { AxiosError } from 'axios';

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
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
      toast.success('Password updated');
    },
    onError: (err: unknown) => {
      const axiosErr = err as AxiosError<ApiErrorResponse> | undefined;
      const msg =
        axiosErr?.response?.data?.errors?.current_password?.[0] ||
        axiosErr?.response?.data?.errors?.password?.[0] ||
        axiosErr?.message ||
        'Failed to update password';
      toast.error(msg);
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="text-slate-400 text-sm mt-1">Manage your organization settings</p>
        </div>
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-40 bg-slate-800/50 animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="text-slate-400 text-sm mt-1">Manage your organization settings</p>
        </div>
        {isAdmin && (
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="bg-blue-600 hover:bg-blue-700 text-white"
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

      <Tabs defaultValue="general">
        <TabsList className="bg-slate-800/50">
          <TabsTrigger value="general">General</TabsTrigger>
          {isAdmin && <TabsTrigger value="tracking">Tracking</TabsTrigger>}
        </TabsList>

        {/* General Tab */}
        <TabsContent value="general" className="space-y-6 mt-6">
          {/* Your timezone — used for "today", dashboard dates, timer */}
          <Card className="border-slate-800 bg-slate-900/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <UserIcon className="h-5 w-5" />
                Your timezone
              </CardTitle>
              <CardDescription className="text-slate-400">
                Used for today’s total, dashboard date filters, and reports
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 max-w-md">
                <Label htmlFor="user-tz" className="text-slate-300">Timezone</Label>
                <div className="flex gap-2 items-center">
                  <Select value={userTimezone} onValueChange={(v) => v && setUserTimezone(v)}>
                    <SelectTrigger id="user-tz" className="bg-slate-800/50 border-slate-700">
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
                    className="border-slate-700 text-slate-300"
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
          <Card className="border-slate-800 bg-slate-900/50">
            <CardHeader>
              <CardTitle className="text-white">Security</CardTitle>
              <CardDescription className="text-slate-400">
                Change your account password
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 max-w-md">
                <Label htmlFor="current-password" className="text-slate-300">Current password</Label>
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="bg-slate-800/50 border-slate-700 text-white"
                />
              </div>
              <div className="grid gap-2 max-w-md">
                <Label htmlFor="new-password" className="text-slate-300">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="bg-slate-800/50 border-slate-700 text-white"
                />
              </div>
              <div className="grid gap-2 max-w-md">
                <Label htmlFor="new-password-confirm" className="text-slate-300">Confirm new password</Label>
                <Input
                  id="new-password-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={newPasswordConfirm}
                  onChange={(e) => setNewPasswordConfirm(e.target.value)}
                  className="bg-slate-800/50 border-slate-700 text-white"
                />
              </div>

              <Button
                onClick={() => {
                  changePasswordMutation.mutate({
                    current_password: currentPassword,
                    password: newPassword,
                    password_confirmation: newPasswordConfirm,
                  });
                }}
                disabled={
                  changePasswordMutation.isPending ||
                  !currentPassword ||
                  !newPassword ||
                  newPassword !== newPasswordConfirm
                }
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {changePasswordMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Update password
              </Button>
              {newPassword && newPasswordConfirm && newPassword !== newPasswordConfirm && (
                <p className="text-sm text-red-400">New password and confirmation do not match.</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-800 bg-slate-900/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <Settings className="h-5 w-5" />
                Organization
              </CardTitle>
              <CardDescription className="text-slate-400">
                General organization settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 max-w-md">
                <Label htmlFor="org-name" className="text-slate-300">Organization Name</Label>
                <Input
                  id="org-name"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  disabled={!isAdmin}
                  className="bg-slate-800/50 border-slate-700 text-white"
                />
              </div>
              <div className="grid gap-2 max-w-md">
                <Label htmlFor="org-tz" className="text-slate-300">Timezone</Label>
                <Select value={timezone} onValueChange={(v) => v && setTimezone(v)} disabled={!isAdmin}>
                  <SelectTrigger id="org-tz" className="bg-slate-800/50 border-slate-700">
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
                  <Separator className="bg-slate-800" />
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-slate-300">Idle alert emails</Label>
                      <p className="text-xs text-slate-500">
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
                    <Label htmlFor="idle-alert-email-cooldown" className="text-slate-300">Cooldown (minutes)</Label>
                    <Input
                      id="idle-alert-email-cooldown"
                      type="number"
                      min={5}
                      max={1440}
                      value={idleAlertEmailCooldownMin}
                      onChange={(e) => setIdleAlertEmailCooldownMin(e.target.value)}
                      disabled={!idleAlertEmailEnabled}
                      className="bg-slate-800/50 border-slate-700 text-white w-28"
                    />
                    <p className="text-xs text-slate-500">
                      Minimum time between emails per employee. Recommended: 60+ minutes.
                    </p>
                  </div>
                </>
              )}

              <div className="flex items-center gap-2 text-sm text-slate-400">
                <span>
                  Plan: <strong className="text-white capitalize">{data?.organization.plan}</strong>
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
            <Card className="border-slate-800 bg-slate-900/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <CreditCard className="h-5 w-5" />
                  Billing
                </CardTitle>
                <CardDescription className="text-slate-400">
                  Manage your subscription and billing
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/settings/billing">
                  <Button variant="outline" className="border-slate-700 text-slate-300">
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
          <Card className="border-slate-800 bg-slate-900/50">
            <CardHeader>
              <CardTitle className="text-white">Screenshots</CardTitle>
              <CardDescription className="text-slate-400">
                Configure screenshot capture settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-2 max-w-xs">
                <Label htmlFor="ss-interval" className="text-slate-300">Capture Interval</Label>
                <Select
                  value={screenshotInterval}
                  onValueChange={(v) => v && setScreenshotInterval(v)}
                  disabled={!isAdmin}
                >
                  <SelectTrigger id="ss-interval" className="bg-slate-800/50 border-slate-700">
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
                <Label htmlFor="ss-first-delay" className="text-slate-300">First capture delay</Label>
                <Input
                  id="ss-first-delay"
                  type="number"
                  min={0}
                  max={60}
                  value={screenshotFirstCaptureDelayMin}
                  onChange={(e) => setScreenshotFirstCaptureDelayMin(e.target.value)}
                  disabled={!isAdmin}
                  className="bg-slate-800/50 border-slate-700 text-white w-28"
                />
                <p className="text-xs text-slate-500">Minutes before first screenshot when timer starts (0 = immediate)</p>
              </div>
              <Separator className="bg-slate-800" />
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-slate-300">Blur Screenshots</Label>
                  <p className="text-xs text-slate-500">Apply blur to screenshots for privacy</p>
                </div>
                <Switch checked={screenshotBlur} onCheckedChange={setScreenshotBlur} disabled={!isAdmin} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-slate-300">Capture only when app visible</Label>
                  <p className="text-xs text-slate-500">Skip screenshots when desktop app is minimized (reduces permission prompts)</p>
                </div>
                <Switch checked={captureOnlyWhenVisible} onCheckedChange={setCaptureOnlyWhenVisible} disabled={!isAdmin} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-slate-300">Multi-monitor capture</Label>
                  <p className="text-xs text-slate-500">Capture all monitors and composite into one image</p>
                </div>
                <Switch checked={captureMultiMonitor} onCheckedChange={setCaptureMultiMonitor} disabled={!isAdmin} />
              </div>
            </CardContent>
          </Card>

          {/* Tracking Settings */}
          <Card className="border-slate-800 bg-slate-900/50">
            <CardHeader>
              <CardTitle className="text-white">Time Tracking</CardTitle>
              <CardDescription className="text-slate-400">
                Configure time tracking behavior
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-2 max-w-xs">
                <Label className="text-slate-300">Idle detection</Label>
                <Select
                  value={idleTimeout === '0' ? '0' : [5, 10, 20].includes(parseInt(idleTimeout, 10)) ? idleTimeout : 'custom'}
                  onValueChange={(v) => {
                    if (v === '0') setIdleTimeout('0');
                    else if (v === 'custom') setIdleTimeout(idleTimeoutCustom || '15');
                    else if (v) setIdleTimeout(v);
                  }}
                  disabled={!isAdmin}
                >
                  <SelectTrigger className="bg-slate-800/50 border-slate-700">
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
                      className="w-24 bg-slate-800/50 border-slate-700 text-white"
                    />
                    <span className="text-xs text-slate-500">minutes</span>
                  </div>
                )}
                <p className="text-xs text-slate-500">Show idle alert after this many minutes of no activity (or disable)</p>
              </div>
              <div className="grid gap-2 max-w-xs">
                <Label className="text-slate-300">When idle is detected</Label>
                <Select value={keepIdleTime} onValueChange={(v) => { if (v) setKeepIdleTime(v as 'prompt' | 'always' | 'never'); }} disabled={!isAdmin}>
                  <SelectTrigger className="bg-slate-800/50 border-slate-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prompt">Prompt (ask Keep / Discard / Reassign / Stop)</SelectItem>
                    <SelectItem value="always">Always keep idle time</SelectItem>
                    <SelectItem value="never">Always discard idle time</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500">Whether to show the idle alert or auto-keep / auto-discard</p>
              </div>
              <div className="grid gap-2 max-w-xs">
                <Label className="text-slate-300">Idle alert auto-stop</Label>
                <p className="text-xs text-slate-500">
                  If idle alert is shown in <strong>Prompt</strong> mode and user does not respond, auto-stop after this many minutes.
                </p>
                <Input
                  type="number"
                  min="1"
                  max="60"
                  value={idleAlertAutoStopMin}
                  onChange={(e) => setIdleAlertAutoStopMin(e.target.value)}
                  disabled={!isAdmin}
                  className="w-28 bg-slate-800/50 border-slate-700 text-white"
                />
                <span className="text-xs text-slate-500">minutes</span>
              </div>
              <div className="grid gap-2 max-w-xs">
                <Label className="text-slate-300">Idle check interval</Label>
                <Input
                  type="number"
                  min={1}
                  max={60}
                  value={idleCheckIntervalSec}
                  onChange={(e) => setIdleCheckIntervalSec(e.target.value)}
                  disabled={!isAdmin}
                  className="w-28 bg-slate-800/50 border-slate-700 text-white"
                />
                <p className="text-xs text-slate-500">How often (seconds) the desktop app checks for idle activity</p>
              </div>
              <Separator className="bg-slate-800" />
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-slate-300">Screenshot on idle resume</Label>
                  <p className="text-xs text-slate-500">Capture one screenshot immediately after idle alert is resolved/discarded.</p>
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
          <Card className="border-slate-800 bg-slate-900/50">
            <CardHeader>
              <CardTitle className="text-white">Policies</CardTitle>
              <CardDescription className="text-slate-400">
                Rules that apply to all employees in the organization
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-slate-300">Track browser URLs</Label>
                  <p className="text-xs text-slate-500">Record the active browser URL alongside each screenshot</p>
                </div>
                <Switch
                  checked={trackUrls}
                  onCheckedChange={setTrackUrls}
                  disabled={!isAdmin}
                  aria-label="Track browser URLs"
                />
              </div>
              <Separator className="bg-slate-800" />
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-slate-300">Allow manual time entries</Label>
                  <p className="text-xs text-slate-500">Allow employees to add time entries manually</p>
                </div>
                <Switch
                  checked={allowManualTime}
                  onCheckedChange={setAllowManualTime}
                  disabled={!isAdmin}
                  aria-label="Allow manual time entries"
                />
              </div>
              <Separator className="bg-slate-800" />
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-slate-300">Require project selection</Label>
                  <p className="text-xs text-slate-500">Employees must select a project before starting the timer</p>
                </div>
                <Switch
                  checked={requireProject}
                  onCheckedChange={setRequireProject}
                  disabled={!isAdmin}
                  aria-label="Require project selection"
                />
              </div>
              <Separator className="bg-slate-800" />
              <div className="grid gap-2 max-w-xs">
                <Label htmlFor="weekly-limit" className="text-slate-300">Weekly hour limit</Label>
                <Input
                  id="weekly-limit"
                  type="number"
                  min={0}
                  max={168}
                  value={weeklyLimitHours}
                  onChange={(e) => setWeeklyLimitHours(e.target.value)}
                  disabled={!isAdmin}
                  placeholder="0 = unlimited"
                  className="bg-slate-800/50 border-slate-700 text-white w-28"
                  aria-label="Weekly hour limit"
                />
                <p className="text-xs text-slate-500">Maximum hours per week per employee. 0 = unlimited.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>}
      </Tabs>
    </div>
  );
}
