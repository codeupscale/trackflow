'use client';

import { useEffect, useRef, useState } from 'react';
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
import { formatDuration } from '@/lib/utils';
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
    startTimer,
    stopTimer,
    fetchStatus,
  } = useTimerStore();

  const selectedRef = useRef<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const { data: projects } = useQuery<Project[]>({
    queryKey: ['projects-list'],
    queryFn: async () => {
      const res = await api.get('/projects', { params: { per_page: 100 } });
      return res.data.projects || res.data.data || (Array.isArray(res.data) ? res.data : []);
    },
  });

  useEffect(() => {
    fetchStatus().catch(() => {});
  }, [fetchStatus]);

  useEffect(() => {
    if (projectId) {
      selectedRef.current = projectId;
    }
  }, [projectId]);

  const handleToggle = async () => {
    setIsLoading(true);
    try {
      if (isRunning) {
        await stopTimer();
        toast.success('Timer stopped');
      } else {
        await startTimer(selectedRef.current ?? undefined);
        toast.success('Timer started');
      }
    } catch {
      toast.error(isRunning ? 'Failed to stop timer' : 'Failed to start timer');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      {/* Project selector */}
      <Select
        onValueChange={(val) => { selectedRef.current = val as string | null; }}
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

      {/* Timer display */}
      <div className="flex items-center gap-2 min-w-[100px]">
        {isRunning && (
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
        )}
        <span className={`font-mono text-sm font-medium tabular-nums ${isRunning ? 'text-green-400' : 'text-slate-400'}`}>
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
