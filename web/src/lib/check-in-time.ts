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

/**
 * Format a raw MINUTE count as the human "Xh Ym" scheme — used for late / early /
 * overtime signals that the backend reports as bare minute integers.
 *
 * The core problem this solves: a column reading "456" (or "Early (min): 168") is
 * uninterpretable at a glance. "7h 36m" / "2h 48m" is unmistakable. This DELEGATES
 * to formatDuration (whole minutes never produce a seconds part) so there is one
 * duration-formatting source of truth.
 *
 *   null / undefined / <= 0  → "0m"
 *   36                       → "36m"
 *   60                       → "1h"
 *   90                       → "1h 30m"
 *   168                      → "2h 48m"
 *   456                      → "7h 36m"
 */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes == null || minutes <= 0) return '0m';
  return formatDuration(Math.floor(minutes) * 60);
}

/**
 * Format a policy wall-clock time string ("HH:MM" or "HH:MM:SS", 24-hour) as a
 * 12-hour label ("11:30 AM", "8:30 PM"). Returns null when the input is missing or
 * unparseable, so callers can fall back to generic phrasing.
 *
 * This reads the org POLICY config values (check_in_time / checkout_time), which are
 * stable 24-hour strings — deliberately independent of any display-string format the
 * API uses for clock_in / clock_out columns.
 */
export function formatPolicyTime(time: string | null | undefined): string | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes) || hours > 23 || minutes > 59) {
    return null;
  }
  const period = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${String(minutes).padStart(2, '0')} ${period}`;
}

/** Context for building a check-in badge tooltip. All fields optional. */
export interface CheckInTooltipContext {
  /** Minutes late from the official start (check_in_late_minutes / late_minutes). */
  lateMinutes?: number | null;
  /** Minutes checked out before the checkout time (check_out_early_minutes). */
  earlyMinutes?: number | null;
  /** Minutes worked past the checkout time (check_out_overtime_minutes). */
  overtimeMinutes?: number | null;
  /** Policy official start time, 24-hour "HH:MM[:SS]" (policy.check_in_time). */
  checkInTime?: string | null;
  /** Policy checkout time, 24-hour "HH:MM[:SS]" (policy.checkout_time). */
  checkoutTime?: string | null;
}

/**
 * Build a plain-language tooltip for a check-in signal badge, converting the bare
 * minute count into "Xh Ym" and anchoring it to the org policy time when available.
 * Returns undefined when there is nothing worth explaining (e.g. on_time), so the
 * caller can skip rendering a tooltip wrapper.
 *
 *   late,  lateMinutes 456, checkInTime "11:30:00"  →
 *     "Checked in 7h 36m after the 11:30 AM official start."
 *   early_checkout, earlyMinutes 168, checkoutTime "20:30:00" →
 *     "Checked out 2h 48m before the 8:30 PM checkout time."
 *   early_checkout, no minutes, no policy →
 *     "Checked out before the organization's checkout time."
 */
export function checkInBadgeTooltip(
  status:
    | 'on_time'
    | 'late'
    | 'early_checkout'
    | 'missing_checkout'
    | 'on_approved_leave'
    | 'worked_on_off_day'
    | 'overtime',
  ctx: CheckInTooltipContext = {}
): string | undefined {
  switch (status) {
    case 'late': {
      const start = formatPolicyTime(ctx.checkInTime);
      const anchor = start ? `the ${start} official start` : 'the official start time';
      const dur =
        ctx.lateMinutes != null && ctx.lateMinutes > 0
          ? formatMinutes(ctx.lateMinutes)
          : null;
      return dur
        ? `Checked in ${dur} after ${anchor}.`
        : `Checked in after ${anchor}.`;
    }
    case 'early_checkout': {
      const checkout = formatPolicyTime(ctx.checkoutTime);
      const anchor = checkout
        ? `the ${checkout} checkout time`
        : "the organization's checkout time";
      const dur =
        ctx.earlyMinutes != null && ctx.earlyMinutes > 0
          ? formatMinutes(ctx.earlyMinutes)
          : null;
      return dur
        ? `Checked out ${dur} before ${anchor}.`
        : `Checked out before ${anchor}.`;
    }
    case 'overtime': {
      const checkout = formatPolicyTime(ctx.checkoutTime);
      const anchor = checkout
        ? `the ${checkout} checkout time`
        : "the organization's checkout time";
      const dur =
        ctx.overtimeMinutes != null && ctx.overtimeMinutes > 0
          ? formatMinutes(ctx.overtimeMinutes)
          : null;
      return dur
        ? `Worked ${dur} of overtime past ${anchor}.`
        : `Worked overtime past ${anchor}.`;
    }
    case 'missing_checkout':
      return "You didn't check out — the session was auto-closed for you.";
    case 'on_approved_leave':
      return 'You checked in on a day covered by an approved leave request.';
    case 'worked_on_off_day':
      return 'You checked in on a weekend or holiday.';
    case 'on_time':
    default:
      return undefined;
  }
}
