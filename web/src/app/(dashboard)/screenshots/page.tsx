'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, subDays, parseISO } from 'date-fns';
import {
  Camera,
  Monitor,
  ChevronLeft,
  ChevronRight,
  Download,
  Trash2,
  Keyboard,
  Mouse,
  Maximize2,
  Users,
  FolderOpen,
  CalendarIcon,
  FileDown,
  Clock,
  AlertTriangle,
} from 'lucide-react';

import Image from 'next/image';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import api from '@/lib/api';
import { cn, getActivityColor } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { usePermissionStore } from '@/stores/permission-store';
import { toast } from 'sonner';

// --- Types ---

interface Screenshot {
  id: string;
  user_id: string;
  user_name: string;
  user_avatar_color?: string;
  url: string | null;
  thumbnail_url: string | null;
  captured_at: string;
  activity_score: number;
  project_name: string | null;
  project_id: string | null;
  app_name: string | null;
  window_title: string | null;
  keyboard_events: number | null;
  mouse_events: number | null;
}

interface ScreenshotResponse {
  data: Screenshot[];
  current_page?: number;
  last_page?: number;
  total?: number;
  per_page?: number;
  meta?: {
    current_page: number;
    last_page: number;
    total: number;
    per_page: number;
  };
}

interface TeamUser {
  id: string;
  name: string;
}

interface Project {
  id: string;
  name: string;
}

type DatePreset = 'today' | 'yesterday' | '7days' | 'custom';

// --- Helpers ---

function getDateRange(preset: DatePreset, customDate: string): { from: string; to: string } {
  const today = format(new Date(), 'yyyy-MM-dd');
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');

  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: yesterday, to: yesterday };
    case '7days':
      return { from: format(subDays(new Date(), 6), 'yyyy-MM-dd'), to: today };
    case 'custom':
      return { from: customDate, to: customDate };
    default:
      return { from: today, to: today };
  }
}

function groupByHour(screenshots: Screenshot[]): Map<string, Screenshot[]> {
  const groups = new Map<string, Screenshot[]>();

  for (const ss of screenshots) {
    const date = parseISO(ss.captured_at);
    // Create hour key: "10:00 AM" format for display, but use sortable key internally
    const hourKey = format(date, 'HH'); // 24h for sorting
    const existing = groups.get(hourKey) || [];
    existing.push(ss);
    groups.set(hourKey, existing);
  }

  // Sort each group by captured_at descending
  for (const [key, group] of groups) {
    groups.set(key, group.sort((a, b) =>
      new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime()
    ));
  }

  // Return sorted by hour descending
  return new Map(
    [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  );
}

function formatHourLabel(hourKey: string): string {
  const hour = parseInt(hourKey, 10);
  if (hour === 0) return '12:00 AM';
  if (hour < 12) return `${hour}:00 AM`;
  if (hour === 12) return '12:00 PM';
  return `${hour - 12}:00 PM`;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function getAvatarColor(hash?: string): string {
  if (!hash) return 'hsl(210, 40%, 60%)';
  const hue = parseInt(hash.substring(0, 2), 16) * 1.4;
  return `hsl(${Math.round(hue)}, 55%, 55%)`;
}

function getActivityDotColor(score: number): string {
  if (score >= 80) return 'bg-green-500';
  if (score >= 50) return 'bg-yellow-500';
  return 'bg-red-500';
}

// --- Component ---

export default function ScreenshotsPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const { hasPermission, hasPermissionWithScope } = usePermissionStore();
  const isManager = hasPermissionWithScope('screenshots.view', 'team');
  const canDelete = hasPermission('screenshots.delete');

  // Filter state
  const [datePreset, setDatePreset] = useState<DatePreset>('today');
  const [customDate, setCustomDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [userFilter, setUserFilter] = useState<string>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [userPopoverOpen, setUserPopoverOpen] = useState(false);
  const [projectPopoverOpen, setProjectPopoverOpen] = useState(false);

  // Lightbox state
  const [selectedScreenshot, setSelectedScreenshot] = useState<Screenshot | null>(null);

  // Pagination
  const [page, setPage] = useState(1);

  // Broken images tracking
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());

  // Date range derived from preset
  const dateRange = useMemo(() => getDateRange(datePreset, customDate), [datePreset, customDate]);

  // --- Queries ---

  const { data: teamUsers } = useQuery<TeamUser[]>({
    queryKey: ['team-users'],
    queryFn: async () => {
      const res = await api.get('/users', { params: { per_page: 100 } });
      return res.data.users || res.data.data || (Array.isArray(res.data) ? res.data : []);
    },
    enabled: isManager,
  });

  const { data: projects } = useQuery<Project[]>({
    queryKey: ['projects-list'],
    queryFn: async () => {
      const res = await api.get('/projects', { params: { per_page: 100 } });
      return res.data.data || res.data.projects || (Array.isArray(res.data) ? res.data : []);
    },
  });

  const { data: screenshotsData, isLoading, isError: isScreenshotsError } = useQuery<ScreenshotResponse>({
    queryKey: ['screenshots', dateRange.from, dateRange.to, userFilter, projectFilter, page],
    queryFn: async () => {
      const params: Record<string, string | number> = {
        date_from: dateRange.from,
        date_to: dateRange.to,
        page,
        per_page: 100,
      };
      if (isManager && userFilter && userFilter !== 'all') {
        params.user_id = userFilter;
      }
      if (projectFilter && projectFilter !== 'all') {
        params.project_id = projectFilter;
      }
      const res = await api.get('/screenshots', { params });
      return res.data;
    },
    staleTime: 60 * 60 * 1000,
    refetchInterval: 90 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const deleteScreenshot = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/screenshots/${id}`);
    },
    onSuccess: () => {
      toast.success('Screenshot deleted');
      setSelectedScreenshot(null);
      queryClient.invalidateQueries({ queryKey: ['screenshots'] });
    },
    onError: () => {
      toast.error('Failed to delete screenshot');
    },
  });

  const screenshots = screenshotsData?.data || [];
  const meta = screenshotsData?.meta || (screenshotsData?.current_page != null ? {
    current_page: screenshotsData.current_page!,
    last_page: screenshotsData.last_page!,
    total: screenshotsData.total!,
    per_page: screenshotsData.per_page!,
  } : undefined);

  // Group screenshots by hour
  const hourlyGroups = useMemo(() => groupByHour(screenshots), [screenshots]);

  // Flat list for lightbox navigation
  const flatScreenshots = useMemo(() => {
    const result: Screenshot[] = [];
    for (const [, group] of hourlyGroups) {
      result.push(...group);
    }
    return result;
  }, [hourlyGroups]);

  const currentIndex = selectedScreenshot
    ? flatScreenshots.findIndex((s) => s.id === selectedScreenshot.id)
    : -1;
  const total = flatScreenshots.length;

  const navigateScreenshot = useCallback(
    (direction: number) => {
      const nextIndex = currentIndex + direction;
      if (nextIndex >= 0 && nextIndex < total) {
        setSelectedScreenshot(flatScreenshots[nextIndex]);
      }
    },
    [currentIndex, total, flatScreenshots],
  );

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (!selectedScreenshot) return;
    const handler = (e: KeyboardEvent) => {
      const idx = flatScreenshots.findIndex((s) => s.id === selectedScreenshot.id);
      if (e.key === 'ArrowRight' && idx < flatScreenshots.length - 1) {
        setSelectedScreenshot(flatScreenshots[idx + 1]);
      } else if (e.key === 'ArrowLeft' && idx > 0) {
        setSelectedScreenshot(flatScreenshots[idx - 1]);
      } else if (e.key === 'Escape') {
        setSelectedScreenshot(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedScreenshot, flatScreenshots]);

  // Broken image handler
  const handleImageError = (screenshotId: string) => {
    setBrokenImages((prev) => new Set(prev).add(screenshotId));
  };

  const handleRefreshUrls = () => {
    setBrokenImages(new Set());
    queryClient.invalidateQueries({ queryKey: ['screenshots'] });
  };

  const handleDelete = (id: string) => {
    if (typeof window !== 'undefined' && window.confirm('Are you sure you want to delete this screenshot? This action cannot be undone.')) {
      deleteScreenshot.mutate(id);
    }
  };

  // Reset page when filters change
  const handlePresetChange = (preset: DatePreset) => {
    setDatePreset(preset);
    setPage(1);
  };

  // Find the hour group's screenshots for "session summary" in lightbox
  const getSessionInfo = (ss: Screenshot) => {
    const hourKey = format(parseISO(ss.captured_at), 'HH');
    const group = hourlyGroups.get(hourKey) || [];
    if (group.length === 0) return null;

    const times = group.map((s) => new Date(s.captured_at).getTime());
    const earliest = new Date(Math.min(...times));
    const latest = new Date(Math.max(...times));
    const avgActivity = Math.round(
      group.reduce((sum, s) => sum + s.activity_score, 0) / group.length
    );

    return {
      timeRange: `${format(earliest, 'h:mm a')} - ${format(latest, 'h:mm a')}`,
      count: group.length,
      avgActivity,
    };
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Screenshots</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Real-time engagement across your organization&apos;s active projects.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {datePreset === 'custom' && (
            <DatePicker
              value={customDate}
              onChange={(val) => {
                setCustomDate(val);
                setPage(1);
              }}
              placeholder="Pick a date"
            />
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => {
              if (datePreset !== 'custom') {
                setDatePreset('custom');
              } else {
                setDatePreset('today');
              }
            }}
          >
            <CalendarIcon className="h-4 w-4" />
            {datePreset === 'custom' ? 'Quick Filters' : 'Pick Date'}
          </Button>
          <Button variant="outline" size="sm" className="gap-2">
            <FileDown className="h-4 w-4" />
            Export Report
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {/* Member Filter */}
          {isManager && (
            <Popover open={userPopoverOpen} onOpenChange={setUserPopoverOpen}>
              <PopoverTrigger
                render={
                  <Button variant="outline" size="sm" className="gap-2 min-w-[140px] justify-start" />
                }
              >
                <Users className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  {userFilter === 'all'
                    ? 'All Members'
                    : teamUsers?.find((u) => u.id === userFilter)?.name ?? 'Loading...'}
                </span>
              </PopoverTrigger>
              <PopoverContent className="w-[220px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search members..." />
                  <CommandList>
                    <CommandEmpty>No members found.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        data-checked={userFilter === 'all'}
                        onSelect={() => {
                          setUserFilter('all');
                          setUserPopoverOpen(false);
                          setPage(1);
                        }}
                      >
                        All Members
                      </CommandItem>
                      {teamUsers?.map((u) => (
                        <CommandItem
                          key={u.id}
                          data-checked={userFilter === u.id}
                          onSelect={() => {
                            setUserFilter(u.id);
                            setUserPopoverOpen(false);
                            setPage(1);
                          }}
                        >
                          {u.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          )}

          {/* Project Filter */}
          <Popover open={projectPopoverOpen} onOpenChange={setProjectPopoverOpen}>
            <PopoverTrigger
              render={
                <Button variant="outline" size="sm" className="gap-2 min-w-[140px] justify-start" />
              }
            >
              <FolderOpen className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {projectFilter === 'all'
                  ? 'All Projects'
                  : projects?.find((p) => p.id === projectFilter)?.name ?? 'Loading...'}
              </span>
            </PopoverTrigger>
            <PopoverContent className="w-[220px] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search projects..." />
                <CommandList>
                  <CommandEmpty>No projects found.</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      data-checked={projectFilter === 'all'}
                      onSelect={() => {
                        setProjectFilter('all');
                        setProjectPopoverOpen(false);
                        setPage(1);
                      }}
                    >
                      All Projects
                    </CommandItem>
                    {projects?.map((p) => (
                      <CommandItem
                        key={p.id}
                        data-checked={projectFilter === p.id}
                        onSelect={() => {
                          setProjectFilter(p.id);
                          setProjectPopoverOpen(false);
                          setPage(1);
                        }}
                      >
                        {p.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        {/* Date Quick Filters */}
        {datePreset !== 'custom' && (
          <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/50 p-0.5">
            {([
              { key: 'today', label: 'Today' },
              { key: 'yesterday', label: 'Yesterday' },
              { key: '7days', label: 'Last 7 Days' },
            ] as const).map(({ key, label }) => (
              <Button
                key={key}
                variant={datePreset === key ? 'default' : 'ghost'}
                size="sm"
                className={cn(
                  'text-xs h-7 px-3',
                  datePreset === key
                    ? ''
                    : 'text-muted-foreground hover:text-foreground'
                )}
                onClick={() => handlePresetChange(key)}
              >
                {label}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      {isScreenshotsError ? (
        <Card className="border-border bg-card">
          <CardContent className="py-16">
            <div className="text-center">
              <Camera className="h-10 w-10 text-red-500/60 mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">Failed to load screenshots</p>
              <p className="text-sm text-muted-foreground mt-1">
                Please try again.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="space-y-8">
          {/* Loading skeleton: simulate 2 hour groups */}
          {[0, 1].map((groupIdx) => (
            <div key={groupIdx} className="space-y-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-5 w-20" />
                <Separator className="flex-1" />
              </div>
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i} className="overflow-hidden border-border bg-card">
                    <Skeleton className="aspect-[16/10] w-full" />
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-6 w-6 rounded-full" />
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-4 w-12 ml-auto" />
                      </div>
                      <Skeleton className="h-3 w-32" />
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-3 w-16" />
                        <Skeleton className="h-3 w-16" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : screenshots.length === 0 ? (
        <Card className="border-border bg-card">
          <CardContent className="py-16">
            <div className="text-center">
              <Camera className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">No screenshots found</p>
              <p className="text-sm text-muted-foreground mt-1">
                Adjust your date range or filters to view screenshots
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {/* Hourly groups */}
          {[...hourlyGroups.entries()].map(([hourKey, group]) => (
            <div key={hourKey} className="space-y-4">
              {/* Hour heading */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 shrink-0">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold text-foreground">
                    {formatHourLabel(hourKey)}
                  </span>
                  <Badge variant="secondary" className="text-[10px] tabular-nums">
                    {group.length}
                  </Badge>
                </div>
                <Separator className="flex-1" />
              </div>

              {/* Screenshot cards grid */}
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {group.map((screenshot) => (
                  <ScreenshotCard
                    key={screenshot.id}
                    screenshot={screenshot}
                    isManager={isManager}
                    brokenImages={brokenImages}
                    onImageError={handleImageError}
                    onRefreshUrls={handleRefreshUrls}
                    onClick={() => setSelectedScreenshot(screenshot)}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* Pagination */}
          {meta && meta.last_page > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-border">
              <p className="text-sm text-muted-foreground">
                Page {meta.current_page} of {meta.last_page} ({meta.total} screenshots)
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(meta.last_page, p + 1))}
                  disabled={page >= meta.last_page}
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lightbox Dialog */}
      <Dialog
        open={!!selectedScreenshot}
        onOpenChange={(open) => {
          if (!open) setSelectedScreenshot(null);
        }}
      >
        <DialogContent className="sm:max-w-4xl bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-foreground">
                {isManager && selectedScreenshot?.user_name && (
                  <>
                    <Avatar size="sm">
                      <AvatarFallback
                        style={{ backgroundColor: getAvatarColor(selectedScreenshot.user_avatar_color) }}
                        className="text-white text-[10px]"
                      >
                        {getInitials(selectedScreenshot.user_name)}
                      </AvatarFallback>
                    </Avatar>
                    <span>{selectedScreenshot.user_name}</span>
                    {selectedScreenshot.project_name && (
                      <span className="text-muted-foreground font-normal">
                        working on <strong className="text-foreground">{selectedScreenshot.project_name}</strong>
                      </span>
                    )}
                  </>
                )}
                {!isManager && selectedScreenshot?.project_name && (
                  <span>
                    Working on <strong>{selectedScreenshot.project_name}</strong>
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigateScreenshot(-1)}
                  disabled={currentIndex <= 0}
                  aria-label="Previous screenshot"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {currentIndex + 1} / {total}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigateScreenshot(1)}
                  disabled={currentIndex >= total - 1}
                  aria-label="Next screenshot"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </DialogTitle>
            <DialogDescription>
              {selectedScreenshot && (
                <span className="flex items-center gap-2 flex-wrap">
                  <span className="text-foreground font-medium">
                    {format(parseISO(selectedScreenshot.captured_at), 'MMM d, yyyy h:mm:ss a')}
                  </span>
                  <Badge className={cn('text-xs tabular-nums', getActivityColor(selectedScreenshot.activity_score).badge)}>
                    {selectedScreenshot.activity_score}%
                  </Badge>
                  {selectedScreenshot.app_name && (
                    <>
                      <span className="text-muted-foreground">|</span>
                      <span>{selectedScreenshot.app_name}</span>
                    </>
                  )}
                  {selectedScreenshot.window_title && (
                    <>
                      <span className="text-muted-foreground">-</span>
                      <span className="truncate max-w-[200px]">{selectedScreenshot.window_title}</span>
                    </>
                  )}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {/* Full screenshot */}
          <div className="aspect-video bg-muted rounded-lg relative flex items-center justify-center overflow-hidden">
            {selectedScreenshot?.url && !brokenImages.has(`lightbox-${selectedScreenshot.id}`) ? (
              <Image
                key={selectedScreenshot.url}
                src={selectedScreenshot.url}
                alt={`Screenshot from ${selectedScreenshot.project_name || 'unknown project'} at ${format(parseISO(selectedScreenshot.captured_at), 'HH:mm')}, ${selectedScreenshot.activity_score}% activity`}
                className="w-full h-full object-contain"
                fill
                sizes="(max-width: 768px) 100vw, 900px"
                unoptimized
                onError={() => handleImageError(`lightbox-${selectedScreenshot.id}`)}
              />
            ) : selectedScreenshot?.url && brokenImages.has(`lightbox-${selectedScreenshot.id}`) ? (
              <div
                className="absolute inset-0 flex flex-col items-center justify-center bg-muted gap-2 cursor-pointer hover:bg-muted/80 transition-colors"
                onClick={handleRefreshUrls}
              >
                <Monitor className="h-8 w-8 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Click to reload images</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-muted-foreground">
                <Monitor className="h-16 w-16" />
                <span className="text-sm">Screenshot preview not available</span>
              </div>
            )}
          </div>

          {/* Session Summary + Actions */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-2">
            {/* Session summary */}
            {selectedScreenshot && (() => {
              const session = getSessionInfo(selectedScreenshot);
              if (!session) return null;
              return (
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    <span>{session.timeRange}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'inline-block h-2 w-2 rounded-full',
                        getActivityDotColor(session.avgActivity)
                      )}
                    />
                    <span>Avg {session.avgActivity}%</span>
                  </div>
                  {selectedScreenshot.keyboard_events != null && (
                    <div className="flex items-center gap-1.5">
                      <Keyboard className="h-3.5 w-3.5" />
                      <span>{selectedScreenshot.keyboard_events}</span>
                    </div>
                  )}
                  {selectedScreenshot.mouse_events != null && (
                    <div className="flex items-center gap-1.5">
                      <Mouse className="h-3.5 w-3.5" />
                      <span>{selectedScreenshot.mouse_events}</span>
                    </div>
                  )}
                  {session.count > 1 && (
                    <span className="text-muted-foreground/70">
                      {session.count} screenshots this hour
                    </span>
                  )}
                </div>
              );
            })()}

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              {selectedScreenshot?.url && (
                <a
                  href={selectedScreenshot.url}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex"
                >
                  <Button variant="outline" size="sm" className="border-border text-foreground">
                    <Download className="h-4 w-4 mr-2" />
                    Download
                  </Button>
                </a>
              )}
              {canDelete && selectedScreenshot && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDelete(selectedScreenshot.id)}
                  disabled={deleteScreenshot.isPending}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  {deleteScreenshot.isPending ? 'Deleting...' : 'Delete'}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Screenshot Card Component ---

function ScreenshotCard({
  screenshot,
  isManager,
  brokenImages,
  onImageError,
  onRefreshUrls,
  onClick,
}: {
  screenshot: Screenshot;
  isManager: boolean;
  brokenImages: Set<string>;
  onImageError: (id: string) => void;
  onRefreshUrls: () => void;
  onClick: () => void;
}) {
  const capturedDate = parseISO(screenshot.captured_at);
  const timeLabel = format(capturedDate, 'h:mm a');
  const activityColors = getActivityColor(screenshot.activity_score);
  const isLowActivity = screenshot.activity_score < 30;

  return (
    <Card
      className="overflow-hidden cursor-pointer group hover:ring-1 hover:ring-ring/20 transition-all border-border bg-card"
      onClick={onClick}
    >
      {/* Thumbnail */}
      <div className="aspect-[16/10] bg-muted relative flex items-center justify-center overflow-hidden">
        {screenshot.thumbnail_url && !brokenImages.has(screenshot.id) ? (
          <Image
            key={screenshot.thumbnail_url}
            src={screenshot.thumbnail_url}
            alt={`Screenshot from ${screenshot.project_name || 'unknown project'} at ${format(capturedDate, 'HH:mm')}, ${screenshot.activity_score}% activity`}
            className="w-full h-full object-cover"
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            unoptimized
            onError={() => onImageError(screenshot.id)}
          />
        ) : screenshot.thumbnail_url && brokenImages.has(screenshot.id) ? (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center bg-muted gap-2 cursor-pointer hover:bg-muted/80 transition-colors"
            onClick={(e) => { e.stopPropagation(); onRefreshUrls(); }}
          >
            <Monitor className="h-8 w-8 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Click to reload</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Monitor className="h-8 w-8" />
            <span className="text-xs">No preview</span>
          </div>
        )}

        {/* Time badge overlay - top left */}
        <div className="absolute top-2 left-2">
          <span className="inline-flex items-center gap-1 rounded-md bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
            {timeLabel}
          </span>
        </div>

        {/* Low activity badge - top right */}
        {isLowActivity && (
          <div className="absolute top-2 right-2">
            <span className="inline-flex items-center gap-1 rounded-md bg-red-600/90 px-2 py-0.5 text-[10px] font-semibold text-white uppercase tracking-wider">
              <AlertTriangle className="h-3 w-3" />
              Low Activity
            </span>
          </div>
        )}

        {/* Expand icon on hover */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-end justify-end p-2 opacity-0 group-hover:opacity-100">
          <button
            className="rounded-md bg-black/60 p-1.5 text-white hover:bg-black/80 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onClick();
            }}
            aria-label="Expand screenshot"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Card body */}
      <CardContent className="p-3 space-y-2">
        {/* User info row */}
        <div className="flex items-center gap-2">
          {isManager && (
            <>
              <Avatar size="sm">
                <AvatarFallback
                  style={{ backgroundColor: getAvatarColor(screenshot.user_avatar_color) }}
                  className="text-white text-[10px]"
                >
                  {getInitials(screenshot.user_name)}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium text-foreground truncate flex-1">
                {screenshot.user_name}
              </span>
            </>
          )}
          <div className="flex items-center gap-1.5 ml-auto shrink-0">
            <span
              className={cn(
                'inline-block h-2 w-2 rounded-full',
                getActivityDotColor(screenshot.activity_score)
              )}
            />
            <span className={cn('text-xs tabular-nums font-medium', activityColors.text)}>
              {screenshot.activity_score}%
            </span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
              activity
            </span>
          </div>
        </div>

        {/* Project name */}
        {screenshot.project_name && (
          <p className="text-xs text-muted-foreground truncate">
            {screenshot.project_name}
            {screenshot.app_name && (
              <span className="text-muted-foreground/60"> - {screenshot.app_name}</span>
            )}
          </p>
        )}

        {/* Footer: keyboard/mouse counts */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {screenshot.keyboard_events != null ? (
            <div className="flex items-center gap-1">
              <Keyboard className="h-3 w-3" />
              <span className="tabular-nums">{screenshot.keyboard_events}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <Keyboard className="h-3 w-3 opacity-40" />
              <span className="opacity-40">&mdash;</span>
            </div>
          )}
          {screenshot.mouse_events != null ? (
            <div className="flex items-center gap-1">
              <Mouse className="h-3 w-3" />
              <span className="tabular-nums">{screenshot.mouse_events}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <Mouse className="h-3 w-3 opacity-40" />
              <span className="opacity-40">&mdash;</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
