'use client';

import { useEffect, useState } from 'react';
import { Play, Square } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTimerStore } from '@/stores/timer-store';
import { formatDuration, cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

interface Project {
  id: string;
  name: string;
  color: string;
}

export function TimerWidget() {
  const {
    isRunning,
    elapsedSeconds,
    projectId,
    selectedProjectId,
    setSelectedProjectId,
    startTimer,
    stopTimer,
    fetchStatus,
    startPolling,
    stopPolling,
  } = useTimerStore();

  const [isLoading, setIsLoading] = useState(false);

  const { data: projects } = useQuery<Project[]>({
    queryKey: ['projects-list'],
    queryFn: async () => {
      const res = await api.get('/projects', { params: { per_page: 100 } });
      return res.data.projects || res.data.data || (Array.isArray(res.data) ? res.data : []);
    },
  });

  // When timer is running, show running project in dropdown; otherwise show selected project
  const displayProjectId = isRunning ? projectId : selectedProjectId;

  // Fetch status on mount and when project changes so header shows total time for selected project (or all)
  useEffect(() => {
    fetchStatus(selectedProjectId ?? null).catch(() => {});
    startPolling();
    return () => stopPolling();
  }, [fetchStatus, selectedProjectId, startPolling, stopPolling]);

  // When project changes, fetch status for that project so header shows its total
  const handleProjectChange = (val: string | null) => {
    const id = val || null;
    setSelectedProjectId(id);
    fetchStatus(id).catch(() => {});
  };

  const handleToggle = async () => {
    setIsLoading(true);
    try {
      if (isRunning) {
        await stopTimer();
        toast.success('Timer stopped');
      } else {
        await startTimer(selectedProjectId ?? undefined);
        toast.success('Timer started');
      }
    } catch {
      await fetchStatus(selectedProjectId).catch(() => {});
      toast.error(isRunning ? 'Failed to stop timer' : 'Failed to start timer');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      {/* Project selector */}
      <Select
        value={displayProjectId ?? ''}
        onValueChange={handleProjectChange}
        disabled={isRunning}
      >
        <SelectTrigger className="w-[160px] h-8 bg-slate-800/50 border-slate-700 text-sm">
          <SelectValue placeholder="Select project" />
        </SelectTrigger>
        <SelectContent>
          {projects?.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              <div className="flex items-center gap-2">
                <div
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: project.color || '#6366f1' }}
                />
                {project.name}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Timer display: gray when stopped, active style when running */}
      <div
        className={cn(
          'flex items-center gap-2 min-w-[100px] rounded-lg px-3 py-1.5 transition-colors',
          isRunning
            ? 'bg-green-950/40 border border-green-800/50'
            : 'bg-slate-800 border border-slate-700'
        )}
      >
        {isRunning && (
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
        )}
        <span className={cn(
          'font-mono text-sm font-medium tabular-nums',
          isRunning ? 'text-green-400' : elapsedSeconds > 0 ? 'text-slate-300' : 'text-slate-400'
        )}>
          {formatDuration(elapsedSeconds)}
        </span>
      </div>

      {/* Start/Stop button */}
      <Button
        size="sm"
        variant={isRunning ? 'destructive' : 'default'}
        onClick={handleToggle}
        disabled={isLoading}
        className={`h-8 px-3 ${!isRunning ? 'bg-green-600 hover:bg-green-700 text-white' : ''}`}
      >
        {isRunning ? (
          <>
            <Square className="h-3.5 w-3.5 mr-1.5" />
            Stop
          </>
        ) : (
          <>
            <Play className="h-3.5 w-3.5 mr-1.5" />
            Start
          </>
        )}
      </Button>
    </div>
  );
}
