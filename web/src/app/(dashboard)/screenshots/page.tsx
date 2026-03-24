'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  Camera,
  CalendarIcon,
  Search,
  Monitor,
  ChevronLeft,
  ChevronRight,
  Info,
} from 'lucide-react';

import Image from 'next/image';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
  const isManager =
    user?.role === 'owner' || user?.role === 'admin' || user?.role === 'manager';

  const [dateFrom, setDateFrom] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [userFilter, setUserFilter] = useState<string>('all');
  const [timeTypeFilter, setTimeTypeFilter] = useState<string>('all');
  const [selectedScreenshot, setSelectedScreenshot] = useState<Screenshot | null>(null);
  const [page, setPage] = useState(1);

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
  });

  const screenshots = screenshotsData?.data || [];
  const meta = screenshotsData?.meta || (screenshotsData?.current_page != null ? {
    current_page: screenshotsData.current_page!,
    last_page: screenshotsData.last_page!,
    total: screenshotsData.total!,
    per_page: screenshotsData.per_page!,
  } : undefined);

  const getActivityBadgeClass = (score: number) => getActivityColor(score).badge;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Screenshots</h1>
        <p className="text-slate-400 text-sm mt-1">
          View captured screenshots of your team&apos;s activity
        </p>
      </div>

      {/* Filters */}
      <Card className="border-slate-800 bg-slate-900/50">
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-slate-300" htmlFor="ss-date-from">
                From
              </label>
              <div className="relative">
                <CalendarIcon className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <Input
                  id="ss-date-from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                  className="pl-10 w-[160px] bg-slate-800/50 border-slate-700 text-white"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-slate-300" htmlFor="ss-date-to">
                To
              </label>
              <div className="relative">
                <CalendarIcon className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <Input
                  id="ss-date-to"
                  type="date"
                  value={dateTo}
                  onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                  className="pl-10 w-[160px] bg-slate-800/50 border-slate-700 text-white"
                />
              </div>
            </div>
            {isManager && (
              <div className="grid gap-1.5">
                <label className="text-sm font-medium text-slate-300">Team Member</label>
                <Select value={userFilter} onValueChange={(val) => { setUserFilter(val ?? 'all'); setPage(1); }}>
                  <SelectTrigger className="w-[200px] bg-slate-800/50 border-slate-700">
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
              <label className="text-sm font-medium text-slate-300">Time type</label>
              <Select value={timeTypeFilter} onValueChange={(val) => { setTimeTypeFilter(val ?? 'all'); setPage(1); }}>
                <SelectTrigger className="w-[160px] bg-slate-800/50 border-slate-700">
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
        <Card className="border-slate-800 bg-slate-900/50">
          <CardContent className="py-16">
            <div className="text-center">
              <Camera className="h-10 w-10 text-red-500/60 mx-auto mb-3" />
              <p className="text-slate-400 font-medium">Failed to load screenshots</p>
              <p className="text-sm text-slate-500 mt-1">
                Please try again.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="overflow-hidden border-slate-800 bg-slate-900/50">
              <div className="aspect-video bg-slate-800/50 animate-pulse" />
              <CardContent className="p-3 space-y-2">
                <div className="h-4 w-24 bg-slate-800/50 animate-pulse rounded" />
                <div className="h-3 w-32 bg-slate-800/50 animate-pulse rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : screenshots.length === 0 ? (
        <Card className="border-slate-800 bg-slate-900/50">
          <CardContent className="py-16">
            <div className="text-center">
              <Camera className="h-10 w-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 font-medium">No screenshots found</p>
              <p className="text-sm text-slate-500 mt-1">
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
                className="overflow-hidden cursor-pointer group hover:border-slate-600 transition-all border-slate-800 bg-slate-900/50"
                onClick={() => setSelectedScreenshot(screenshot)}
              >
                <div className="aspect-video bg-slate-800 relative flex items-center justify-center overflow-hidden">
                  {screenshot.thumbnail_url ? (
                    <Image
                      src={screenshot.thumbnail_url}
                      alt={`Screenshot from ${screenshot.project_name || 'unknown project'} at ${format(new Date(screenshot.captured_at), 'HH:mm')}, ${screenshot.activity_score}% activity`}
                      className="w-full h-full object-cover"
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-slate-600">
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
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-white truncate">
                      {screenshot.user_name}
                    </p>
                  </div>
                  <p className="text-xs text-slate-500">
                    {format(new Date(screenshot.captured_at), 'MMM d, yyyy HH:mm')}
                  </p>
                  {screenshot.project_name && (
                    <p className="text-xs text-slate-500 truncate">
                      {screenshot.project_name}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          {meta && meta.last_page > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-sm text-slate-400">
                Page {meta.current_page} of {meta.last_page} ({meta.total} total)
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="border-slate-700 text-slate-300"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= (meta.last_page || 1)}
                  className="border-slate-700 text-slate-300"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
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
        <DialogContent className="sm:max-w-3xl bg-slate-900 border-slate-800">
          <DialogHeader>
            <DialogTitle className="text-white">
              {selectedScreenshot?.user_name} &mdash;{' '}
              {selectedScreenshot &&
                format(new Date(selectedScreenshot.captured_at), 'MMM d, yyyy HH:mm:ss')}
            </DialogTitle>
            <DialogDescription>
              <span className="flex items-center gap-2">
                Activity score:{' '}
                <Badge className={`text-xs tabular-nums ${getActivityBadgeClass(selectedScreenshot?.activity_score ?? 0)}`}>
                  {selectedScreenshot?.activity_score}%
                </Badge>
                {selectedScreenshot?.project_name && (
                  <>
                    <span className="text-slate-500">|</span>
                    <span>{selectedScreenshot.project_name}</span>
                  </>
                )}
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="aspect-video bg-slate-800 rounded-lg relative flex items-center justify-center overflow-hidden">
            {selectedScreenshot?.url ? (
              <Image
                src={selectedScreenshot.url}
                alt={`Screenshot from ${selectedScreenshot.project_name || 'unknown project'} at ${format(new Date(selectedScreenshot.captured_at), 'HH:mm')}, ${selectedScreenshot.activity_score}% activity`}
                className="w-full h-full object-contain"
                fill
                sizes="(max-width: 768px) 100vw, 768px"
              />
            ) : (
              <div className="flex flex-col items-center gap-3 text-slate-600">
                <Monitor className="h-16 w-16" />
                <span className="text-sm">Screenshot preview not available</span>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
