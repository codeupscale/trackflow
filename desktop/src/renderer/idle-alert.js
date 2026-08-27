// idle-alert.js — Idle alert renderer logic
//
// Communicates with the main process via the preload bridge (window.trackflow).
// Tracks the idle detector's actionId to prevent stale actions from being sent
// back when the user responds after auto-stop has already fired.

// ── OS Theme Detection ──
function applyTheme(theme) {
    if (theme === "light") {
        document.documentElement.setAttribute("data-theme", "light");
    } else {
        document.documentElement.removeAttribute("data-theme");
    }
}
window.trackflow
    .getTheme()
    .then(applyTheme)
    .catch(() => {});
window.trackflow.onThemeChange(applyTheme);

const idleTimeEl = document.getElementById("idleTime");
let idleStartMs = Date.now();
let tickInterval = null;

// ── In-renderer alert sound (Bug A1) ────────────────────────────────────────
// The ONLY previous sound path was a raw Electron Notification (silent:false) in
// the main process. macOS Focus/DND, Windows Action Center dedup, and Linux
// libnotify frequently drop that sound with no fallback, so a user on another
// screen / virtual desktop never heard the idle alert. This WebAudio beep fires
// the moment ANY alert window becomes visible (first idle-data) or is re-shown
// after sleep (playSound flag) — independent of OS notification policy. It needs
// NO external resource, so the strict CSP (default-src 'none'; script-src 'self')
// is satisfied with no change. The system Notification is kept as a secondary.
//
// A single beep at the moment the popup appears is easy to miss — the whole
// premise of "idle" is that the user isn't at the keyboard, so by the time they
// walk back within earshot the one-shot tone is long over. The popup now repeats
// the beep every BEEP_REPEAT_MS for as long as it stays up, so someone drifting
// back into the room over the next few minutes still catches it.
let _audioCtx = null;
let _beepIntervalId = null;
const BEEP_REPEAT_MS = 5000;

function playIdleBeep() {
    try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        if (!_audioCtx) _audioCtx = new AC();
        // Autoplay policy may leave the context suspended without a user gesture;
        // resume() is best-effort. If it stays suspended, the OS Notification and
        // the visible window are the fallbacks — we never depend on sound alone.
        if (_audioCtx.state === "suspended") _audioCtx.resume().catch(() => {});
        const now = _audioCtx.currentTime;
        // A playful, unmistakably-not-a-system-sound "boop boop be-DOOP" — three
        // quick notes plus a comedic upward jump on the last one. Triangle wave
        // keeps it softer than a pure sine alarm while still cutting through.
        // Deliberately distinct from the two-tone rising idle chime this replaces
        // and from the three descending tones return-to-work uses, so none of the
        // three sounds this app makes get confused for one another.
        const notes = [
            { freq: 523.25, t: 0, dur: 0.11 }, // C5
            { freq: 523.25, t: 0.14, dur: 0.11 }, // C5
            { freq: 659.25, t: 0.28, dur: 0.11 }, // E5
            { freq: 987.77, t: 0.42, dur: 0.24 }, // B5 — the punchline
        ];
        notes.forEach(({ freq, t, dur }) => {
            const osc = _audioCtx.createOscillator();
            const gain = _audioCtx.createGain();
            osc.type = "triangle";
            osc.frequency.value = freq;
            const t0 = now + t;
            gain.gain.setValueAtTime(0.0001, t0);
            gain.gain.exponentialRampToValueAtTime(0.28, t0 + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
            osc.connect(gain).connect(_audioCtx.destination);
            osc.start(t0);
            osc.stop(t0 + dur + 0.02);
        });
    } catch (e) {
        // WebAudio unavailable — the system Notification / visible window are the
        // fallbacks. Never let a sound failure break the alert.
    }
}

// Repeats every BEEP_REPEAT_MS for as long as the alert is up. Idempotent —
// safe to call on every idle-data message without spawning extra intervals.
// Skips a tick while the window is hidden (Bug B sleep-preservation hides
// rather than destroys the window) so it doesn't beep into a locked screen;
// reshowIdleAlertAfterResume() sends playSound:true on resume, which beeps
// immediately again and the loop resumes ticking once visible.
function startBeepLoop() {
    if (_beepIntervalId) return;
    _beepIntervalId = setInterval(() => {
        if (document.visibilityState === "visible") playIdleBeep();
    }, BEEP_REPEAT_MS);
}

function stopBeepLoop() {
    if (_beepIntervalId) {
        clearInterval(_beepIntervalId);
        _beepIntervalId = null;
    }
}

// Beep immediately on the FIRST idle-data of this renderer (fresh window
// becoming visible) or whenever the main process explicitly requests a replay
// (playSound:true — e.g. re-showing the SAME window after wake). Project-refresh
// idle-data (no playSound) never re-beeps immediately — but always (re)starts the
// repeat loop, so it keeps ticking regardless of which idle-data call started it.
function maybeBeep(data) {
    if (!data || data.playSound !== false) {
        playIdleBeep();
    }
    startBeepLoop();
}

// The idle detector action ID for the current idle cycle.
// Passed back to the main process on resolve to prevent stale actions.
let currentActionId = null;

// Guard against double-sends (e.g., keyboard shortcut + button click)
let actionSent = false;

// Auto-stop countdown: grace period after popup shown (matches IdleDetector._checkAutoStop)
let alertShownAtMs = null;
let autoStopGraceSec = 0;
let autoStopBar = document.getElementById("autoStopBar");
let autoStopCountdownEl = document.getElementById("autoStopCountdown");

function toTimestampMs(value) {
    if (value == null) return null;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
}

function computeAutoStopRemainingSec(nowMs = Date.now()) {
    if (!alertShownAtMs || !autoStopGraceSec || autoStopGraceSec <= 0) {
        return null;
    }
    const deadlineMs = alertShownAtMs + autoStopGraceSec * 1000;
    return Math.max(0, Math.floor((deadlineMs - nowMs) / 1000));
}

function updateAutoStopCountdownDisplay(nowMs = Date.now()) {
    if (!autoStopBar || !autoStopCountdownEl) return;
    const remaining = computeAutoStopRemainingSec(nowMs);
    if (remaining == null) {
        autoStopBar.style.display = "none";
        return;
    }
    autoStopBar.style.display = "";
    autoStopCountdownEl.textContent = formatCountdown(remaining);
}

function formatIdleTime(seconds) {
    // Guard against negative or absurdly large values (>99h would overflow display)
    if (seconds < 0) seconds = 0;
    const h = Math.floor(seconds / 3600)
        .toString()
        .padStart(2, "0");
    const m = Math.floor((seconds % 3600) / 60)
        .toString()
        .padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
}

function formatCountdown(seconds) {
    if (seconds <= 0) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
}

function startTicking() {
    if (tickInterval) clearInterval(tickInterval);
    tickInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - idleStartMs) / 1000);
        idleTimeEl.textContent = formatIdleTime(elapsed);

        updateAutoStopCountdownDisplay();
    }, 1000);
}

let projects = [];

window.trackflow.onIdleData((data) => {
    // Bug A1: guarantee an audible alert the moment this window is visible,
    // independent of OS notification policy (Focus/DND, Action Center dedup).
    maybeBeep(data);

    const parsedIdleStart = toTimestampMs(data.idleStartedAt);
    if (parsedIdleStart != null) idleStartMs = parsedIdleStart;
    if (data.actionId != null) currentActionId = data.actionId;

    // Reset actionSent when new idle data arrives (e.g., resume after suspend
    // extends the idle period and sends updated data to an existing window)
    actionSent = false;
    enableAllButtons();

    const elapsed = Math.floor((Date.now() - idleStartMs) / 1000);
    idleTimeEl.textContent = formatIdleTime(elapsed);

    // Auto-stop countdown: grace after popup shown (matches idle-detector.js)
    const parsedAlertShown = toTimestampMs(data.alertShownAt);
    if (parsedAlertShown != null) alertShownAtMs = parsedAlertShown;
    if (data.autoStopGraceSec > 0) {
        autoStopGraceSec = data.autoStopGraceSec;
    }
    updateAutoStopCountdownDisplay();

    startTicking();

    // Reassign was removed (2026-07-16) \u2014 the project list is no longer rendered
    // into a picker. `projects` is still tracked because the main process keeps
    // sending it in idle-data; ignoring it here is deliberate.
    if (Array.isArray(data.projects)) {
        projects = data.projects;
    }
});

const ACTION_BUTTON_IDS = ["continueBtn", "discardBtn"];

function disableAllButtons() {
    ACTION_BUTTON_IDS.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.disabled = true;
    });
}

function enableAllButtons() {
    ACTION_BUTTON_IDS.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.disabled = false;
    });
}

function sendAction(action, projectId) {
    if (actionSent) return; // Prevent double-send
    actionSent = true;
    disableAllButtons();
    stopBeepLoop();
    window.trackflow.resolveIdle(action, projectId || null, currentActionId);
}

// Both buttons DISCARD the idle gap; they differ only in what happens next.
//
// "Continue Tracking" → main action "discard": the server splits the entry at
// idle-start, drops the gap, and opens a NEW running entry, so tracking resumes
// from where it paused. (Same path the `keep_idle_time:"never"` policy uses.)
// It does NOT credit idle time, so it is not blocked by the keep/reassign 403.
document
    .getElementById("continueBtn")
    .addEventListener("click", () => sendAction("discard"));

// "Stop Timer" → main action "stop": discard the gap and stop; the entry closes
// at the moment idle began, no server split, no resume.
document
    .getElementById("discardBtn")
    .addEventListener("click", () => sendAction("stop"));

// Keyboard shortcuts: C = continue, S = stop. (K/R for the removed Keep/Reassign
// buttons are intentionally gone — no hidden path back to crediting idle time.)
document.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (actionSent) return;
    const key = e.key.toLowerCase();
    if (key === "c") {
        document.getElementById("continueBtn").click();
    } else if (key === "s") {
        document.getElementById("discardBtn").click();
    }
});

// ── Auto-Stopped State ──────────────────────────────────────────────────────
// When the auto-stop timer fires, the main process stops the timer but keeps
// this window visible. It sends 'auto-stopped' so we can switch the UI to
// show "Timer Stopped" with a dismiss button — ensuring the user sees what
// happened when they return.

window.trackflow.onAutoStopped((data) => {
    // Stop the idle time ticker and the repeat beep — the alert is now purely
    // informational (timer already stopped), so it should not keep sounding.
    if (tickInterval) {
        clearInterval(tickInterval);
        tickInterval = null;
    }
    stopBeepLoop();

    // Freeze the idle time display at the final value
    if (data.idleDuration) {
        idleTimeEl.textContent = formatIdleTime(data.idleDuration);
    }

    // Hide the action buttons and auto-stop countdown
    document.querySelector(".actions").style.display = "none";
    const autoStopBar = document.getElementById("autoStopBar");
    if (autoStopBar) autoStopBar.style.display = "none";

    // Update header text
    document.querySelector(".title").textContent = "Timer was stopped";
    document.querySelector(".message").textContent =
        "Automatically stopped due to inactivity";

    // Change the timer label
    document.querySelector(".timer-label").textContent = "Total idle time";

    // Show the auto-stopped section
    document.getElementById("autoStoppedSection").classList.add("visible");
});

document.getElementById("dismissBtn").addEventListener("click", () => {
    stopBeepLoop();
    window.trackflow.resolveIdle("dismiss", null, currentActionId);
});

window.addEventListener("beforeunload", () => {
    if (tickInterval) {
        clearInterval(tickInterval);
        tickInterval = null;
    }
    stopBeepLoop();
});

window.addEventListener("error", (e) =>
    console.error("Idle alert renderer error:", e.message),
);
