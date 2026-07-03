// Pure, SSR-safe time helpers for the check-in / checkout UI.
//
// CRITICAL: live elapsed time is DERIVED from the server timestamp on every render,
// never accumulated by a counter. An interval only forces re-renders; each render
// recomputes elapsed from wall-clock, so a slow/dropped tick can never cause drift.
// (Same lesson as the desktop local-first timer fix.)

/**
 * Clock skew between the server and this client, in milliseconds.
 * offset = server - client. Add it to Date.now() to get the server's "now".
 * Returns 0 if the server timestamp is missing/unparseable.
 */
export function computeClockOffset(serverNowIso: string | null | undefined, clientNowMs: number): number {
  if (!serverNowIso) return 0;
  const server = Date.parse(serverNowIso);
  if (Number.isNaN(server)) return 0;
  return server - clientNowMs;
}

/**
 * Elapsed whole seconds since check-in, derived from wall-clock adjusted by the
 * server offset. Never negative. Returns 0 when the check-in timestamp is missing.
 */
export function elapsedSeconds(
  checkInAtIso: string | null | undefined,
  offsetMs: number,
  clientNowMs: number
): number {
  if (!checkInAtIso) return 0;
  const start = Date.parse(checkInAtIso);
  if (Number.isNaN(start)) return 0;
  const serverNow = clientNowMs + offsetMs;
  const deltaMs = serverNow - start;
  if (deltaMs <= 0) return 0;
  return Math.floor(deltaMs / 1000);
}

/**
 * Format a whole-second count as HH:MM:SS (used for the live elapsed clock).
 * Hours are not zero-padded to two digits when they exceed 99, but always at
 * least two. Negative inputs are clamped to 0.
 */
export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Derive the single most notable check-in signal badge status for a record row.
 * Priority: missing_checkout > early_checkout > late > on_time. Returns null when
 * there is no check-in signal worth flagging (e.g. a non-checked-in record).
 */
export function deriveCheckInBadgeStatus(record: {
  check_in_at?: string | null;
  check_in_status?: 'on_time' | 'late' | null;
  is_early_checkout?: boolean;
  missing_checkout?: boolean;
}):
  | 'on_time'
  | 'late'
  | 'early_checkout'
  | 'missing_checkout'
  | null {
  if (!record.check_in_at) return null;
  if (record.missing_checkout) return 'missing_checkout';
  if (record.is_early_checkout) return 'early_checkout';
  if (record.check_in_status === 'late') return 'late';
  if (record.check_in_status === 'on_time') return 'on_time';
  return null;
}

/**
 * Format a whole-second count as an unambiguous "Xh Ym Zs" duration — used for ALL
 * on-screen TOTALS (frozen day total, per-session durations, report columns).
 * This is deliberately distinct from formatElapsed (HH:MM:SS, live ticker only):
 * a total rendered as "00:02" reads as a running clock, whereas "2m 38s" is
 * unmistakably a duration.
 *
 * Seconds are always included so HR can verify totals to the second. Zero LEADING
 * units are omitted (no "0h 2m 5s" → "2m 5s") and pure-zero trailing units are
 * dropped, but interior zero units are kept so a value can never read ambiguously
 * (e.g. "1h 0m 5s", never "1h 5s").
 *
 *   null / undefined / <= 0        → "0s"
 *   0h 2m 38s                      → "2m 38s"
 *   1h 4m 12s                      → "1h 4m 12s"
 *   1h 0m 0s                       → "1h"
 *   1h 1m 0s                       → "1h 1m"
 *   1h 0m 5s                       → "1h 0m 5s"
 *   0h 0m 59s                      → "59s"
 */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || totalSeconds <= 0) return '0s';
  const total = Math.floor(totalSeconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  // Show minutes when non-zero, or as an interior zero between hours and seconds
  // (so "1h 0m 5s" never collapses to the ambiguous "1h 5s").
  if (minutes > 0 || (hours > 0 && seconds > 0)) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);

  return parts.join(' ');
}

/**
 * Format a whole-second count as HH:MM — mirrors the backend CheckInService::formatHhmm.
 * Returns null for null input (a session with no worked_seconds).
 *
 * NOTE: no longer used for on-screen totals (see formatDuration). Retained for any
 * callers that mirror the backend HH:MM contract directly.
 */
export function formatHhmm(totalSeconds: number | null | undefined): string | null {
  if (totalSeconds == null) return null;
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}`;
}
