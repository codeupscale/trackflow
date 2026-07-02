# Web timer doesn't tick smoothly — freezes then jumps (background-tab throttling)

**Status:** ✅ FIXED (2026-07-02, `fix/qa-build-1.0.41-dev.64-batch`) — QA build 1.0.41-dev.64, issue #6 (P2).

**Scope:** Web dashboard timer display. `web/src/app/(dashboard)/time/page.tsx`, `web/src/app/(dashboard)/dashboard/page.tsx`.

**Severity:** P2 — display-only glitch; the underlying time value is always correct.

## Symptom

The web timer display sometimes freezes and then jumps to the correct time.

## Root cause

**Not** an accumulating counter — the Zustand store `tick()` and page display functions already derive `elapsed = now − started_at`, and the header `TimerWidget` already had `visibilitychange` + `online` re-derive. The remaining freeze-then-jump was in the two **page** timers (`time/page.tsx`, `dashboard/page.tsx`): their driving `setInterval(…, 1000)` is throttled in background browser tabs, and those effects had **no instant re-derive on refocus**. On returning to the tab the display stayed frozen until the next throttled tick fired, then jumped to the correct value.

## Fix

Added `visibilitychange` + window `focus` listeners to each page's tick effect, forcing an immediate re-render on refocus. Because the displayed value derives from `started_at`, it snaps to the correct time instantly with no visible freeze/jump. Listeners are SSR-guarded (`typeof window`) and cleaned up in the effect return alongside `clearInterval`. The Zustand store was unchanged.

## Key files

- `web/src/app/(dashboard)/time/page.tsx` — refocus re-derive listeners.
- `web/src/app/(dashboard)/dashboard/page.tsx` — refocus re-derive listeners.
- `web/src/stores/timer-store.test.ts` — new regression test (2-hour background-tab gap asserts a single `tick()` derives exactly 7200s).

## Verification

- `cd web && npx tsc --noEmit` → exit 0.
- `npx vitest run src/stores/timer-store.test.ts` → 19/19 passing.
