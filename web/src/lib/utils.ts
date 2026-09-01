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

/**
 * Palette for code badges — department codes (ENG, DES) and leave type codes
 * (annual, sick, casual) alike. Shared so a listing table and its detail modal
 * colour the SAME code identically: a code that is amber in the list must not
 * turn grey when the row is opened.
 */
const CODE_BADGE_COLORS = [
  'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
  'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-400',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400',
  'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400',
  'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400',
  'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-400',
  'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400',
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400',
];

/**
 * Deterministic colour for a code — the same code always maps to the same
 * swatch, so colours stay stable across renders, pages and reloads. Case is
 * normalised so "ENG" and "eng" cannot drift to different colours.
 */
export function codeBadgeColor(code: string): string {
  const key = code.toLowerCase();
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  return CODE_BADGE_COLORS[Math.abs(hash) % CODE_BADGE_COLORS.length];
}

/**
 * Distinct identity colours for leave-type cards, so Annual / Sick / Casual /
 * Study each read as a different chart rather than four identical green bars.
 *
 * Red and amber are deliberately ABSENT. The balance card reserves those for
 * the "running low" signal on the remaining figure — if an identity colour
 * could also be red, a full Sick Leave balance would look like a warning.
 */
const LEAVE_TYPE_COLORS = [
  { icon: 'bg-blue-500/10 text-blue-500',     bar: 'bg-blue-500',    value: 'text-blue-600 dark:text-blue-400' },
  { icon: 'bg-violet-500/10 text-violet-500', bar: 'bg-violet-500',  value: 'text-violet-600 dark:text-violet-400' },
  { icon: 'bg-emerald-500/10 text-emerald-500', bar: 'bg-emerald-500', value: 'text-emerald-600 dark:text-emerald-400' },
  { icon: 'bg-cyan-500/10 text-cyan-500',     bar: 'bg-cyan-500',    value: 'text-cyan-600 dark:text-cyan-400' },
  { icon: 'bg-indigo-500/10 text-indigo-500', bar: 'bg-indigo-500',  value: 'text-indigo-600 dark:text-indigo-400' },
  { icon: 'bg-teal-500/10 text-teal-500',     bar: 'bg-teal-500',    value: 'text-teal-600 dark:text-teal-400' },
  { icon: 'bg-fuchsia-500/10 text-fuchsia-500', bar: 'bg-fuchsia-500', value: 'text-fuchsia-600 dark:text-fuchsia-400' },
  { icon: 'bg-sky-500/10 text-sky-500',       bar: 'bg-sky-500',     value: 'text-sky-600 dark:text-sky-400' },
];

export interface LeaveTypeColor {
  icon: string;
  bar: string;
  value: string;
}

/**
 * Assign a DISTINCT colour to each leave type in a set.
 *
 * Hashing the code alone is stable but can collide, and two cards side by side
 * in the same colour is the exact problem this solves. So each code takes its
 * hashed swatch when free, otherwise walks to the next unused one — every card
 * in the list ends up different, and a given set of codes always resolves the
 * same way. Beyond 8 types the palette necessarily repeats.
 *
 * Returns a map of code -> colour; look each card up by its own code so the
 * colour does not depend on render order.
 */
export function assignLeaveTypeColors(codes: string[]): Record<string, LeaveTypeColor> {
  const taken = new Set<number>();
  const out: Record<string, LeaveTypeColor> = {};

  for (const raw of codes) {
    const key = (raw || '').toLowerCase();
    if (out[key]) continue;

    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = key.charCodeAt(i) + ((hash << 5) - hash);
    }

    let slot = Math.abs(hash) % LEAVE_TYPE_COLORS.length;
    // Walk to the next free swatch; give up after a full lap so more types than
    // swatches still render (repeating) instead of looping forever.
    for (let n = 0; n < LEAVE_TYPE_COLORS.length && taken.has(slot); n++) {
      slot = (slot + 1) % LEAVE_TYPE_COLORS.length;
    }

    taken.add(slot);
    out[key] = LEAVE_TYPE_COLORS[slot];
  }

  return out;
}

/**
 * Format a leave-day count for display: drop a meaningless trailing ".0" while
 * keeping real half-days.
 *
 *   "20.0" -> "20"      (leave_balances stores decimal(5,1), so the API sends
 *   "7.5"  -> "7.5"      every whole number as "N.0")
 *   "0.0"  -> "0"
 */
export function formatDecimal(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '0';
  // Number() already drops the trailing zero ("20.0" -> 20, "0.0" -> 0) while
  // preserving a real fraction ("7.5" -> 7.5), so String() is all that is
  // needed. Unlike toFixed(1), which forces a decimal onto whole numbers and
  // renders "0.0h" where "0h" is meant.
  return String(n);
}

/** Leave-day counts — same rule as formatDecimal; kept for call-site clarity. */
export function formatLeaveDays(value: number | string | null | undefined): string {
  return formatDecimal(value);
}
