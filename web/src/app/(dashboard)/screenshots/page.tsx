'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  Camera,
  Search,
  Monitor,
  ChevronLeft,
  ChevronRight,
  Download,
  Trash2,
} from 'lucide-react';

import Image from 'next/image';
import { Button } from '@/components/ui/button';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import api from '@/lib/api';
import { getActivityColor } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from 'sonner';

interface Screenshot {
  id: string;
  user_id: string;
  user_name: string;
  url: string | null;
  thumbnail_url: string | null;
  captured_at: string;
  activity_score: number;
  project_name: string | null;
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

export default function ScreenshotsPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const isManager =
    user?.role === 'owner' || user?.role === 'admin' || user?.role === 'manager';
  const canDelete = user?.role === 'owner' || user?.role === 'admin';

  const [dateFrom, setDateFrom] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [userFilter, setUserFilter] = useState<string>('all');
  const [timeTypeFilter, setTimeTypeFilter] = useState<string>('all');
  const [selectedScreenshot, setSelectedScreenshot] = useState<Screenshot | null>(null);
  const [page, setPage] = useState(1);
  // Track which screenshot IDs have broken images so we can show fallback UI
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());

  const { data: teamUsers } = useQuery<TeamUser[]>({
    queryKey: ['team-users'],
    queryFn: async () => {
      const res = await api.get('/users', { params: { per_page: 100 } });
      return res.data.users || res.data.data || (Array.isArray(res.data) ? res.data : []);
    },
    enabled: isManager,
  });

  const { data: screenshotsData, isLoading, isError: isScreenshotsError } = useQuery<ScreenshotResponse>({
    queryKey: ['screenshots', dateFrom, dateTo, userFilter, timeTypeFilter, page],
    queryFn: async () => {
      const params: Record<string, string | number> = {
        date_from: dateFrom,
        date_to: dateTo,
        page,
        per_page: 24,
      };
      // Only pass user_id filter for managers; employees rely on backend scoping
      if (isManager && userFilter && userFilter !== 'all') {
        params.user_id = userFilter;
      }
      if (timeTypeFilter && timeTypeFilter !== 'all') {
        params.time_type = timeTypeFilter;
      }
      const res = await api.get('/screenshots', { params });
      return res.data;
    },
    // Screenshot URLs have HMAC signatures that expire after 2 hours. Refetch before expiry.
    staleTime: 60 * 60 * 1000, // Consider data stale after 60 min
    refetchInterval: 90 * 60 * 1000, // Auto-refetch every 90 min (before 2hr expiry)
    refetchOnWindowFocus: true, // Refetch when user returns to tab (gets fresh URLs)
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

  // SS-10: Lightbox navigation helpers
  const currentIndex = selectedScreenshot
    ? screenshots.findIndex((s) => s.id === selectedScreenshot.id)
    : -1;
  const total = screenshots.length;

  const navigateScreenshot = useCallback(
    (direction: number) => {
      const nextIndex = currentIndex + direction;
      if (nextIndex >= 0 && nextIndex < total) {
        setSelectedScreenshot(screenshots[nextIndex]);
      }
    },
    [currentIndex, total, screenshots],
  );

  // SS-10: Keyboard navigation for lightbox
  useEffect(() => {
    if (!selectedScreenshot) return;
    const handler = (e: KeyboardEvent) => {
      const currentData = screenshotsData?.data || [];
      const idx = currentData.findIndex((s) => s.id === selectedScreenshot.id);
      if (e.key === 'ArrowRight' && idx < currentData.length - 1) {
        setSelectedScreenshot(currentData[idx + 1]);
      } else if (e.key === 'ArrowLeft' && idx > 0) {
        setSelectedScreenshot(currentData[idx - 1]);
      } else if (e.key === 'Escape') {
        setSelectedScreenshot(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedScreenshot, screenshotsData]);

  // SS-9: Broken image handler — track by screenshot ID in React state
  const handleImageError = (screenshotId: string) => {
    setBrokenImages((prev) => new Set(prev).add(screenshotId));
  };

  // Refetch screenshots to get fresh signed URLs and clear broken image state
  const handleRefreshUrls = () => {
    setBrokenImages(new Set());
    queryClient.invalidateQueries({ queryKey: ['screenshots'] });
  };

  const getActivityBadgeClass = (score: number) => getActivityColor(score).badge;

  const handleDelete = (id: string) => {
    if (window.confirm('Are you sure you want to delete this screenshot? This action cannot be undone.')) {
      deleteScreenshot.mutate(id);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Screenshots</h1>
        <p className="text-muted-foreground text-sm mt-1">
          View captured screenshots of your team&apos;s activity
        </p>
      </div>

      {/* Filters */}
      <Card className="border-border bg-card">
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-foreground">
                From
              </label>
              <DatePicker
                value={dateFrom}
                onChange={(val) => { setDateFrom(val); setPage(1); }}
                placeholder="Start date"
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-foreground">
                To
              </label>
              <DatePicker
                value={dateTo}
                onChange={(val) => { setDateTo(val); setPage(1); }}
                placeholder="End date"
              />
            </div>
            {isManager && (
              <div className="grid gap-1.5">
                <label className="text-sm font-medium text-foreground">Team Member</label>
                <Select value={userFilter} onValueChange={(val) => { setUserFilter(val ?? 'all'); setPage(1); }}>
                  <SelectTrigger className="w-[200px] bg-muted border-border">
                    <SelectValue placeholder="All members" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Members</SelectItem>
                    {teamUsers?.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-foreground">Time type</label>
              <Select value={timeTypeFilter} onValueChange={(val) => { setTimeTypeFilter(val ?? 'all'); setPage(1); }}>
                <SelectTrigger className="w-[160px] bg-muted border-border">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="tracked">Tracked</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="idle">Idle</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Screenshot Grid */}
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="overflow-hidden border-border bg-card">
              <div className="aspect-video bg-muted animate-pulse" />
              <CardContent className="p-3 space-y-2">
                <div className="h-4 w-24 bg-muted animate-pulse rounded" />
                <div className="h-3 w-32 bg-muted animate-pulse rounded" />
              </CardContent>
            </Card>
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
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {screenshots.map((screenshot) => (
              <Card
                key={screenshot.id}
                className="overflow-hidden cursor-pointer group hover:border-border transition-all border-border bg-card"
                onClick={() => setSelectedScreenshot(screenshot)}
              >
                <div className="aspect-video bg-muted relative flex items-center justify-center overflow-hidden">
                  {screenshot.thumbnail_url && !brokenImages.has(screenshot.id) ? (
                    <Image
                      key={screenshot.thumbnail_url}
                      src={screenshot.thumbnail_url}
                      alt={`Screenshot from ${screenshot.project_name || 'unknown project'} at ${format(new Date(screenshot.captured_at), 'HH:mm')}, ${screenshot.activity_score}% activity`}
                      className="w-full h-full object-cover"
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                      unoptimized
                      onError={() => handleImageError(screenshot.id)}
                    />
                  ) : screenshot.thumbnail_url && brokenImages.has(screenshot.id) ? (
                    /* SS-9: Broken image fallback — click to refresh and get fresh URLs */
                    <div
                      className="absolute inset-0 flex flex-col items-center justify-center bg-muted gap-2 cursor-pointer hover:bg-muted/80 transition-colors"
                      onClick={(e) => { e.stopPropagation(); handleRefreshUrls(); }}
                    >
                      <Monitor className="h-8 w-8 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Click to reload images</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Monitor className="h-8 w-8" />
                      <span className="text-xs">No preview</span>
                    </div>
                  )}
                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                    <Search className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  {/* Activity overlay */}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-white/80 font-mono">
                        {format(new Date(screenshot.captured_at), 'HH:mm')}
                      </span>
                      <Badge className={`text-xs tabular-nums ${getActivityBadgeClass(screenshot.activity_score)}`}>
                        {screenshot.activity_score}%
                      </Badge>
                    </div>
                  </div>
                </div>
                <CardContent className="p-3 space-y-1">
                  {isManager && (
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-white truncate">
                        {screenshot.user_name}
                      </p>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(screenshot.captured_at), 'MMM d, yyyy HH:mm')}
                  </p>
                  {screenshot.project_name && (
                    <p className="text-xs text-muted-foreground truncate">
                      {screenshot.project_name}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          {meta && meta.last_page > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-border">
              <p className="text-sm text-muted-foreground">
                Showing {((meta.current_page - 1) * 24) + 1}&ndash;{Math.min(meta.current_page * 24, meta.total)} of {meta.total} screenshots
              </p>
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      aria-disabled={page <= 1}
                      className={page <= 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                  {Array.from({ length: meta.last_page }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === meta.last_page || Math.abs(p - meta.current_page) <= 1)
                    .reduce((acc, p, idx, arr) => {
                      if (idx > 0 && p - arr[idx - 1] > 1) acc.push(-1);
                      acc.push(p);
                      return acc;
                    }, [] as number[])
                    .map((p, idx) =>
                      p === -1 ? (
                        <PaginationItem key={`ellipsis-${idx}`}>
                          <PaginationEllipsis />
                        </PaginationItem>
                      ) : (
                        <PaginationItem key={p}>
                          <PaginationLink
                            isActive={p === meta.current_page}
                            onClick={() => setPage(p)}
                            className="cursor-pointer"
                          >
                            {p}
                          </PaginationLink>
                        </PaginationItem>
                      ),
                    )}
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => setPage((p) => Math.min(meta.last_page, p + 1))}
                      aria-disabled={page >= (meta.last_page || 1)}
                      className={page >= (meta.last_page || 1) ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </>
      )}

      {/* Enlarged View Dialog */}
      <Dialog
        open={!!selectedScreenshot}
        onOpenChange={(open) => {
          if (!open) setSelectedScreenshot(null);
        }}
      >
        <DialogContent className="sm:max-w-3xl bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center justify-between">
              <span>
                {isManager && selectedScreenshot?.user_name ? `${selectedScreenshot.user_name} — ` : ''}
                {selectedScreenshot &&
                  format(new Date(selectedScreenshot.captured_at), 'MMM d, yyyy HH:mm:ss')}
              </span>
              {/* SS-10: Prev/Next navigation buttons */}
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
              <span className="flex items-center gap-2">
                Activity score:{' '}
                <Badge className={`text-xs tabular-nums ${getActivityBadgeClass(selectedScreenshot?.activity_score ?? 0)}`}>
                  {selectedScreenshot?.activity_score}%
                </Badge>
                {selectedScreenshot?.project_name && (
                  <>
                    <span className="text-muted-foreground">|</span>
                    <span>{selectedScreenshot.project_name}</span>
                  </>
                )}
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="aspect-video bg-muted rounded-lg relative flex items-center justify-center overflow-hidden">
            {selectedScreenshot?.url && !brokenImages.has(`lightbox-${selectedScreenshot.id}`) ? (
              <Image
                key={selectedScreenshot.url}
                src={selectedScreenshot.url}
                alt={`Screenshot from ${selectedScreenshot.project_name || 'unknown project'} at ${format(new Date(selectedScreenshot.captured_at), 'HH:mm')}, ${selectedScreenshot.activity_score}% activity`}
                className="w-full h-full object-contain"
                fill
                sizes="(max-width: 768px) 100vw, 768px"
                unoptimized
                onError={() => handleImageError(`lightbox-${selectedScreenshot.id}`)}
              />
            ) : selectedScreenshot?.url && brokenImages.has(`lightbox-${selectedScreenshot.id}`) ? (
              /* SS-9: Broken image fallback for lightbox */
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
          {/* SS-13: Action buttons (download + delete) */}
          <div className="flex items-center justify-end gap-2 pt-2">
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
        </DialogContent>
      </Dialog>
    </div>
  );
}
