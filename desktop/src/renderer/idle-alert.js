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

    if (Array.isArray(data.projects) && data.projects.length > 0) {
        const sel = document.getElementById("reassignProject");
        // idle-data is re-sent while the popup is open (project refresh on show,
        // the 30-min refresh interval, resume-after-sleep). Rebuilding the <select>
        // unconditionally wiped the project the user had just picked back to the
        // placeholder. Only rebuild when the list actually changed, and preserve
        // the current selection across the rebuild.
        const sameList =
            projects.length === data.projects.length &&
            projects.every((p, i) => p.id === data.projects[i].id);
        projects = data.projects;
        if (!sameList || sel.options.length <= 1) {
            const prevValue = sel.value;
            sel.innerHTML = '<option value="">Reassign to project\u2026</option>';
            projects.forEach((p) => {
                const opt = document.createElement("option");
                opt.value = p.id;
                opt.textContent = p.name || p.id;
                sel.appendChild(opt);
            });
            if (prevValue && projects.some((p) => String(p.id) === prevValue)) {
                sel.value = prevValue;
            }
        }
        document.getElementById("reassignBtn").disabled = !sel.value;
    }
});

document
    .getElementById("reassignProject")
    .addEventListener("change", function () {
        document.getElementById("reassignBtn").disabled = !this.value;
    });

function disableAllButtons() {
    ["keepBtn", "discardBtn", "reassignBtn", "stopBtn"].forEach((id) => {
        document.getElementById(id).disabled = true;
    });
}

function enableAllButtons() {
    ["keepBtn", "discardBtn", "stopBtn"].forEach((id) => {
        document.getElementById(id).disabled = false;
    });
    // Reassign stays disabled unless a project is selected
    document.getElementById("reassignBtn").disabled =
        !document.getElementById("reassignProject").value;
}

function sendAction(action, projectId) {
    if (actionSent) return; // Prevent double-send
    actionSent = true;
    disableAllButtons();
    window.trackflow.resolveIdle(action, projectId || null, currentActionId);
}

document
    .getElementById("keepBtn")
    .addEventListener("click", () => sendAction("keep"));
document
    .getElementById("discardBtn")
    .addEventListener("click", () => sendAction("discard"));
document.getElementById("reassignBtn").addEventListener("click", () => {
    const projectId = document.getElementById("reassignProject").value;
    if (projectId) sendAction("reassign", projectId);
});
document
    .getElementById("stopBtn")
    .addEventListener("click", () => sendAction("stop"));

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (actionSent) return;
    // Don't trigger shortcuts when the select dropdown is focused
    if (document.activeElement && document.activeElement.tagName === "SELECT") {
        if (e.key.toLowerCase() !== "r") return;
    }
    switch (e.key.toLowerCase()) {
        case "k":
            document.getElementById("keepBtn").click();
            break;
        case "d":
            document.getElementById("discardBtn").click();
            break;
        case "s":
            document.getElementById("stopBtn").click();
            break;
        case "r":
            const sel = document.getElementById("reassignProject");
            if (sel.value) document.getElementById("reassignBtn").click();
            else sel.focus();
            break;
    }
});

// ── Auto-Stopped State ──────────────────────────────────────────────────────
// When the auto-stop timer fires, the main process stops the timer but keeps
// this window visible. It sends 'auto-stopped' so we can switch the UI to
// show "Timer Stopped" with a dismiss button — ensuring the user sees what
// happened when they return.

window.trackflow.onAutoStopped((data) => {
    // Stop the idle time ticker
    if (tickInterval) {
        clearInterval(tickInterval);
        tickInterval = null;
    }

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
    window.trackflow.resolveIdle("dismiss", null, currentActionId);
});

window.addEventListener("beforeunload", () => {
    if (tickInterval) {
        clearInterval(tickInterval);
        tickInterval = null;
    }
});

window.addEventListener("error", (e) =>
    console.error("Idle alert renderer error:", e.message),
);
