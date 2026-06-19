/**
 * Pure timer state helpers — extracted from index.js for testability and reuse.
 * Mirrors the invariants documented in desktop/test/timer-sync-invariants.test.js.
 */

function adoptServerStartedAt(cachedStartedAtMs, serverStartedAtIso) {
  const serverMs = serverStartedAtIso ? new Date(serverStartedAtIso).getTime() : null;
  if (serverMs == null || Number.isNaN(serverMs)) return cachedStartedAtMs;
  if (cachedStartedAtMs == null || serverMs <= cachedStartedAtMs) return serverMs;
  return cachedStartedAtMs;
}

function elapsedSecondsFromAnchor(cachedStartedAtMs, nowMs = Date.now()) {
  if (cachedStartedAtMs == null) return 0;
  return Math.floor((nowMs - cachedStartedAtMs) / 1000);
}

module.exports = {
  adoptServerStartedAt,
  elapsedSecondsFromAnchor,
};
