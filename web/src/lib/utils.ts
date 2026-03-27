import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Returns Tailwind classes for activity percentage color coding.
 * - Green: >= 75%  (high activity)
 * - Blue:  50-74%  (moderate activity)
 * - Amber: 25-49%  (low activity)
 * - Red:   < 25%   (very low activity)
 */
export function getActivityColor(score: number): { text: string; bg: string; badge: string; bar: string } {
  if (score >= 75) {
    return {
      text: 'text-green-400',
      bg: 'bg-green-400/10',
      badge: 'bg-green-400/10 text-green-400 border-green-400/20',
      bar: 'bg-green-500',
    };
  }
  if (score >= 50) {
    return {
      text: 'text-blue-400',
      bg: 'bg-blue-400/10',
      badge: 'bg-blue-400/10 text-blue-400 border-blue-400/20',
      bar: 'bg-blue-500',
    };
  }
  if (score >= 25) {
    return {
      text: 'text-amber-400',
      bg: 'bg-amber-400/10',
      badge: 'bg-amber-400/10 text-amber-400 border-amber-400/20',
      bar: 'bg-amber-500',
    };
  }
  return {
    text: 'text-red-400',
    bg: 'bg-red-400/10',
    badge: 'bg-red-400/10 text-red-400 border-red-400/20',
    bar: 'bg-red-500',
  };
}
