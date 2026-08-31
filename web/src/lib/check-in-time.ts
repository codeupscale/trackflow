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

export type DerivedCheckInBadge =
  | 'on_time'
  | 'early_checkout'
  | 'missing_checkout';

/**
 * Fallback full working day, INCLUSIVE of the break — 9 hours from first
 * check-in to last checkout. Used when the employee has no assigned shift to
 * derive the requirement from.
 *
 * Measured as the day SPAN (first in → last out), not the sum of session
 * durations, precisely because the break counts toward the 9 hours: someone in
 * at 09:00 and out at 18:00 with an hour for lunch has completed their day.
 */
export const REQUIRED_DAY_SECONDS = 9 * 60 * 60;

/** "HH:MM[:SS]" → seconds since midnight, or null when unparseable. */
function timeToSeconds(value?: string | null): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0);
}

/**
 * How much presence a day must contain before it counts as complete.
 *
 * Derived from the assigned SHIFT (end − start, overnight-aware) rather than a
 * flat 9 hours, so a 10-hour or 6-hour shift is judged on its own length. The
 * shift's grace period is SUBTRACTED: arriving anywhere inside the grace window
 * is defined as on time, so an 11:30 shift with 15 minutes of grace is fully
 * served by 11:45 → 20:30 (8h45m). Without that subtraction, using the grace the
 * policy grants would itself trigger a short-day badge — the exact case this
 * fixes.
 *
 * Falls back to REQUIRED_DAY_SECONDS when there is no usable shift.
 */
export function requiredDaySeconds(shift?: {
  start_time?: string | null;
  end_time?: string | null;
  grace_period_minutes?: number | null;
} | null): number {
  const start = timeToSeconds(shift?.start_time);
  const end = timeToSeconds(shift?.end_time);

  let span = REQUIRED_DAY_SECONDS;
  if (start !== null && end !== null) {
    // An overnight shift (end at or before start) finishes the next day.
    span = end > start ? end - start : end + 24 * 3600 - start;
  }

  const grace = Math.max(0, (shift?.grace_period_minutes ?? 0) * 60);

  // Never let grace erase the whole day.
  return Math.max(0, span - grace);
}

/**
 * Same requirement, derived from a today-status POLICY instead of a shift row.
 * The policy states the grace window as an absolute `late_threshold` (start +
 * grace) rather than a duration, so it is converted back to minutes here.
 */
export function requiredDayFromPolicy(policy?: {
  check_in_time?: string | null;
  late_threshold?: string | null;
  checkout_time?: string | null;
} | null): number {
  const start = timeToSeconds(policy?.check_in_time);
  const threshold = timeToSeconds(policy?.late_threshold);
  const graceMinutes =
    start !== null && threshold !== null && threshold > start
      ? Math.round((threshold - start) / 60)
      : 0;

  return requiredDaySeconds({
    start_time: policy?.check_in_time,
    end_time: policy?.checkout_time,
    grace_period_minutes: graceMinutes,
  });
}

/**
 * Seconds elapsed between the day's first check-in and its last checkout.
 * Returns null while the day is still open (no checkout yet) — an unfinished
 * day must never be judged short.
 */
export function dayPresenceSeconds(record: {
  check_in_at?: string | null;
  check_out_at?: string | null;
  worked_seconds?: number | null;
}): number | null {
  if (record.check_in_at && record.check_out_at) {
    const start = new Date(record.check_in_at).getTime();
    const end = new Date(record.check_out_at).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      return Math.floor((end - start) / 1000);
    }
  }

  // No usable timestamp pair (e.g. a legacy row) — fall back to recorded work.
  return record.worked_seconds ?? null;
}

/**
 * Derive ALL notable check-in signal badges for a record row, in a deterministic
 * render order: late → early_checkout → missing_checkout.
 *
 * Late and early-checkout COEXIST by design (the backend records both on the same
 * day — you can arrive after the start AND leave before the checkout time), so both
 * badges must render. An earlier single-badge collapse dropped the Late badge when a
 * day was also an early checkout; that was the bug this fixes. Missing-checkout
 * likewise coexists as applicable.
 *
 * The positive "On Time" badge is only surfaced when there is nothing else worth
 * flagging (a clean check-in with no early checkout / missing checkout), so it never
 * competes with an exception badge. Returns an empty array when there is no check-in
 * signal at all (e.g. a non-checked-in record).
 */
export function deriveCheckInBadges(record: {
  check_in_at?: string | null;
  check_in_status?: 'on_time' | 'late' | null;
  is_early_checkout?: boolean;
  missing_checkout?: boolean;
  check_out_at?: string | null;
  worked_seconds?: number | null;
  /** Server snapshot: did this day reach its requirement? Null = not yet judged. */
  met_required_hours?: boolean | null;
  shift?: {
    start_time?: string | null;
    end_time?: string | null;
    grace_period_minutes?: number | null;
  } | null;
}): DerivedCheckInBadge[] {
  if (!record.check_in_at) return [];

  const badges: DerivedCheckInBadge[] = [];

  // NOTE: there is deliberately no 'late' badge. Arriving after the shift start
  // is no longer surfaced as a status badge (owner decision) — the numeric
  // "Late (min)" column still reports it for anyone who needs the detail.

  // Early checkout is a SHORT DAY, not an early clock-out time: the day is
  // flagged when presence falls under REQUIRED_DAY_SECONDS. The server's
  // is_early_checkout compares the checkout against the shift end instead, which
  // marks a full day short whenever someone starts and finishes early, and
  // misses a genuinely short day that happens to end on time.
  // The SERVER's snapshot is authoritative: it was taken against the schedule in
  // force on that day, so a later shift change cannot re-judge history. The
  // client-side computation below is only a fallback for rows that predate the
  // snapshot (met_required_hours null) — keep the two rules identical.
  if (record.met_required_hours === false) {
    badges.push('early_checkout');
  } else if (record.met_required_hours == null) {
    const presence = dayPresenceSeconds(record);
    if (presence !== null && presence < requiredDaySeconds(record.shift)) {
      badges.push('early_checkout');
    }
  }

  if (record.missing_checkout) badges.push('missing_checkout');

  // Positive "On Time" only when nothing else is worth flagging — it should never
  // sit next to an exception badge (preserves the prior on_time-alone behavior).
  if (badges.length === 0 && record.check_in_status === 'on_time') {
    badges.push('on_time');
  }

  return badges;
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
  /** Seconds present that day (first in → last out), for the short-day tooltip. */
  presenceSeconds?: number | null;
  /** The day's requirement after grace (requiredDaySeconds); defaults to 9h. */
  requiredSeconds?: number | null;
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
      // Short DAY, measured against the 9-hour requirement (break included) —
      // not a clock-out that merely preceded the shift end.
      const requiredSecs = ctx.requiredSeconds ?? REQUIRED_DAY_SECONDS;
      const required = formatDuration(requiredSecs);
      if (ctx.presenceSeconds != null && ctx.presenceSeconds > 0) {
        const short = requiredSecs - ctx.presenceSeconds;
        return `Completed ${formatDuration(ctx.presenceSeconds)} of the required ${required} day — ${formatDuration(short)} short.`;
      }
      return `Did not complete the required ${required} day (break included).`;
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
