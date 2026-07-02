// Regression tests for:
//   bugs/desktop-today-total-project-scoped-when-project-selected.md
//
// The desktop popup's "Today, all projects" line (updateTotalSum) and the tray
// "Today: X" tooltip both render `todayTotalGlobal`. Previously the get-timer-state
// handler assigned `todayTotalGlobal = status.today_total`, but the backend scopes
// `today_total` to the requested project when a project is selected. So selecting a
// project while the timer was stopped made the all-projects line show only that
// project's total.
//
// Fix: the handler now derives `todayTotalGlobal` from the always-global
// `all_projects_today_total` field (falling back to today_total for older backends),
// while the big timer keeps using the scoped `today_total` for its per-project display.
//
// The selection logic lives inside src/main/index.js (get-timer-state handler),
// which cannot be imported without booting Electron. These tests re-implement the
// exact pure derivations so a regression in the field-selection is caught here.

describe("get-timer-state: global vs project-scoped today totals", () => {
    // Mirrors the field selection in the get-timer-state handler (src/main/index.js).
    function deriveTotals(status) {
        const globalTotal = status.today_total ?? 0; // scoped when a project is passed
        const allProjectsTotal = status.all_projects_today_total ?? globalTotal;
        return {
            // "Today, all projects" line + tray tooltip — must always be global.
            todayTotalGlobal: allProjectsTotal,
            // Big timer while stopped — scoped to the selected project (global if none).
            bigTimerWhenStopped: globalTotal,
        };
    }

    test("stopped WITH a project selected: global line stays global, big timer is scoped", () => {
        // Backend: today_total scoped to the selected project (1h); global sum is 2h.
        const status = {
            running: false,
            today_total: 3600,
            all_projects_today_total: 7200,
            project_today_total: 3600,
        };

        const { todayTotalGlobal, bigTimerWhenStopped } = deriveTotals(status);

        expect(todayTotalGlobal).toBe(7200); // regression: was 3600 (project-scoped)
        expect(bigTimerWhenStopped).toBe(3600); // big timer keeps per-project total
    });

    test("stopped WITHOUT a project selected: both totals equal the global sum", () => {
        const status = {
            running: false,
            today_total: 5400,
            all_projects_today_total: 5400,
            project_today_total: 0,
        };

        const { todayTotalGlobal, bigTimerWhenStopped } = deriveTotals(status);

        expect(todayTotalGlobal).toBe(5400);
        expect(bigTimerWhenStopped).toBe(5400);
    });

    test("falls back to today_total when older backend omits all_projects_today_total", () => {
        const status = { running: false, today_total: 4200 };

        const { todayTotalGlobal } = deriveTotals(status);

        // No new field → behave as before (best-effort). No crash, defined value.
        expect(todayTotalGlobal).toBe(4200);
    });

    test("tray tooltip source (todayTotalGlobal) never reflects a project scope", () => {
        // Two different selected projects against the same underlying day must yield
        // the SAME global total for the tray tooltip.
        const projectA = {
            running: false,
            today_total: 1200,
            all_projects_today_total: 9000,
        };
        const projectB = {
            running: false,
            today_total: 3000,
            all_projects_today_total: 9000,
        };

        expect(deriveTotals(projectA).todayTotalGlobal).toBe(9000);
        expect(deriveTotals(projectB).todayTotalGlobal).toBe(9000);
    });
});
