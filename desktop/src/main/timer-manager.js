/**
 * Timer Manager — extraction target for start/stop/sync logic from index.js.
 * Phase 5: re-exports pure helpers; full IPC/tray extraction remains incremental.
 */

const timerState = require('./timer-state');
const PowerManager = require('./power-manager');

module.exports = {
  ...timerState,
  PowerManager,
  // Full startTimer/stopTimer/reconcileTimerState remain in index.js until
  // tray/IPC coupling is untangled in a follow-up refactor.
};
