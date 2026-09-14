/**
 * The notification chime.
 *
 * Synthesised with WebAudio rather than loaded as an .mp3, for three reasons:
 * no asset to ship or cache, no CSP entry to add (the artifact/CDN rules block
 * media anyway), and no first-play delay while a file downloads. The desktop
 * agent already generates its idle and return-to-work cues the same way.
 *
 * The sound itself is deliberately plain: two short sine tones a fifth apart,
 * rising, at low gain, over in a quarter of a second. Rising reads as "here is
 * something", falling reads as "something went wrong" — and a sine has no
 * harmonics to sound cheap through laptop speakers. It is meant to be heard
 * once in an open-plan office and not remarked on.
 */

const MUTE_KEY = 'trackflow:notification-sound-muted';

/**
 * The shortest gap between two chimes.
 *
 * Twelve people clocking in within the same minute is a normal morning, and
 * without this each one rings. One sound then stands for the batch — the badge
 * still counts them all.
 */
const THROTTLE_MS = 3000;

let lastPlayedAt = 0;
let context: AudioContext | null = null;

/** Muted for this browser. Read defensively: storage can throw in private mode. */
export function isNotificationSoundMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setNotificationSoundMuted(muted: boolean): void {
  try {
    if (muted) localStorage.setItem(MUTE_KEY, '1');
    else localStorage.removeItem(MUTE_KEY);
  } catch {
    // Preference is lost on reload, sound still works. Not worth surfacing.
  }
}

/**
 * A shared AudioContext, created lazily.
 *
 * Browsers start a context in a 'suspended' state until the page has been
 * interacted with, and creating one per chime leaks them (Chrome caps a page at
 * around six). Resuming is attempted on every play because the first
 * notification may well arrive before the user has clicked anything — in which
 * case it stays suspended, plays nothing, and simply works from the next one.
 */
function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;

    context ??= new Ctor();

    if (context.state === 'suspended') {
      void context.resume().catch(() => {});
    }

    return context;
  } catch {
    return null;
  }
}

/** One tone: sine, with a soft attack and a full decay to silence. */
function tone(ctx: AudioContext, frequency: number, startAt: number, duration: number, peak: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(frequency, startAt);

  // An envelope, not a switch. Starting or stopping a tone at full amplitude
  // produces a click — the discontinuity is audible and sounds broken.
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

/**
 * Play the chime, unless muted or too soon after the last one.
 *
 * Never throws: this is decoration on top of a notification that has already
 * arrived, and an audio failure must not break the bell that raised it.
 */
export function playNotificationChime(): void {
  if (isNotificationSoundMuted()) return;

  const now = Date.now();
  if (now - lastPlayedAt < THROTTLE_MS) return;

  const ctx = getContext();
  if (!ctx) return;

  try {
    const start = ctx.currentTime;

    // E6 then B6 — a rising fifth, the interval a doorbell uses.
    tone(ctx, 1318.51, start, 0.12, 0.06);
    tone(ctx, 1975.53, start + 0.1, 0.18, 0.045);

    lastPlayedAt = now;
  } catch {
    // Autoplay blocked, or the context died with the tab in the background.
  }
}
