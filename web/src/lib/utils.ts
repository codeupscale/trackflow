import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format seconds into h:mm:ss or mm:ss */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Format an ISO date string to a readable date */
export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date))
}

/** Return Tailwind color classes based on activity percentage */
export function getActivityColor(percent: number): { bar: string; badge: string; text: string } {
  if (percent >= 70) return { bar: 'bg-green-500', badge: 'text-green-600 border-green-200 dark:text-green-400 dark:border-green-800', text: 'text-green-600 dark:text-green-400' }
  if (percent >= 40) return { bar: 'bg-yellow-500', badge: 'text-yellow-600 border-yellow-200 dark:text-yellow-400 dark:border-yellow-800', text: 'text-yellow-600 dark:text-yellow-400' }
  return { bar: 'bg-red-500', badge: 'text-red-600 border-red-200 dark:text-red-400 dark:border-red-800', text: 'text-red-600 dark:text-red-400' }
}
