'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings,
  Save,
  Loader2,
  CreditCard,
} from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';

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
      idle_timeout: number;
      require_project?: boolean;
      can_add_manual_time: boolean;
      weekly_limit_hours?: number;
      timezone: string;
    };
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
    idleTimeout: settings ? String(settings.idle_timeout) : '5',
    allowManualTime: settings?.can_add_manual_time ?? true,
  }), [data, settings]);

  const [orgName, setOrgName] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [screenshotInterval, setScreenshotInterval] = useState('5');
  const [screenshotBlur, setScreenshotBlur] = useState(false);
  const [idleTimeout, setIdleTimeout] = useState('5');
  const [allowManualTime, setAllowManualTime] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [userTimezone, setUserTimezone] = useState(user?.timezone ?? 'UTC');
  const { fetchUser } = useAuthStore();

  // Sync form state from fetched data without using setState in useEffect
  if (data && !initialized) {
    setOrgName(defaults.orgName);
    setTimezone(defaults.timezone);
    setUserTimezone(user?.timezone ?? defaults.timezone);
    setScreenshotInterval(defaults.screenshotInterval);
    setScreenshotBlur(defaults.screenshotBlur);
    setIdleTimeout(defaults.idleTimeout);
    setAllowManualTime(defaults.allowManualTime);
    setInitialized(true);
  }

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
    updateMutation.mutate({
      name: orgName,
      timezone,
      screenshot_interval: parseInt(screenshotInterval),
      blur_screenshots: screenshotBlur,
      idle_timeout: parseInt(idleTimeout),
      can_add_manual_time: allowManualTime,
    });
  };

  const handleSaveUserTimezone = () => {
    updateProfileMutation.mutate({ timezone: userTimezone });
  };

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
          <TabsTrigger value="tracking">Tracking</TabsTrigger>
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
        <TabsContent value="tracking" className="space-y-6 mt-6">
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
              <Separator className="bg-slate-800" />
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-slate-300">Blur Screenshots</Label>
                  <p className="text-xs text-slate-500">Apply blur to screenshots for privacy</p>
                </div>
                <Switch checked={screenshotBlur} onCheckedChange={setScreenshotBlur} disabled={!isAdmin} />
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
                <Label htmlFor="idle-timeout" className="text-slate-300">Idle Timeout (minutes)</Label>
                <Input
                  id="idle-timeout"
                  type="number"
                  min="1"
                  max="60"
                  value={idleTimeout}
                  onChange={(e) => setIdleTimeout(e.target.value)}
                  disabled={!isAdmin}
                  className="bg-slate-800/50 border-slate-700 text-white"
                />
                <p className="text-xs text-slate-500">Pause tracking after this many minutes of inactivity</p>
              </div>
              <Separator className="bg-slate-800" />
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-slate-300">Allow Manual Time</Label>
                  <p className="text-xs text-slate-500">Allow employees to add time entries manually</p>
                </div>
                <Switch checked={allowManualTime} onCheckedChange={setAllowManualTime} disabled={!isAdmin} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
