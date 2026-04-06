# TrackFlow — Engineering Standards & Project Context

## What This Is
TrackFlow is a production workforce time tracking & monitoring platform (comparable to Hubstaff). Monorepo with three codebases:

| Component | Stack | Path | Runtime |
|---|---|---|---|
| Backend API | Laravel 12, PHP 8.2+, PostgreSQL 18, Redis 7 | `/backend` | Docker / Sail |
| Web Dashboard | Next.js 16, React 19, TypeScript 5.x, Zustand, TanStack Query v5 | `/web` | Node 20+ |
| Desktop Agent | Electron 28, Node.js, better-sqlite3, sharp | `/desktop` | Native binary |

## System Architecture
```
                    ┌──────────────────────────────────┐
                    │        PostgreSQL 18              │
                    │   (multi-tenant, UUID PKs,        │
                    │    org_id scoping on all tables)   │
                    └──────────┬───────────────────────┘
                               │
Desktop Agent ──► Laravel REST API v1 ──► Redis (cache + queue)
  (Electron)       │    │    │              │
                   │    │    │         Horizon (workers)
Web Dashboard ─────┘    │    │
  (Next.js SSR)         │    └──► S3 / CloudFront (screenshots)
                        │
                   Reverb WebSocket (real-time updates)
```

## Non-Negotiable Engineering Rules

### 1. Data Isolation (Multi-Tenancy)
Every database query MUST be scoped by `organization_id`. The `GlobalOrganizationScope` trait handles this for Eloquent models. For raw/aggregate queries, add explicit `WHERE organization_id = ?`. A query that leaks data across orgs is a P0 security incident.

### 2. API Design
- All list endpoints: `->paginate()`, NEVER `->get()` for unbounded collections
- Response envelope: `{ "data": [...], "meta": { "current_page", "last_page", "total" } }`
- Errors: `{ "message": "Human-readable", "errors": { "field": ["..."] } }` (Laravel default)
- Auth: Bearer token via Sanctum. Access token (24h) + refresh token (30d)
- Versioning: All routes under `/api/v1/`
- Rate limits defined in `AppServiceProvider`: auth=10/min, general=1000/min

### 3. Code Organization
- **Controllers**: Thin. Validate input, call service, return response. Max ~30 lines per method.
- **Services**: `app/Services/` — all business logic. Constructor injection via Laravel DI.
- **Jobs**: Background work. Every job MUST have `$tries`, `$timeout`, `$backoff`, and `failed()` handler.
- **Policies**: Authorization logic. Every controller action that accesses a resource must `$this->authorize()`.
- **Models**: Eloquent with `$fillable`, UUID traits, relationship definitions. No business logic in models.

### 4. Frontend Patterns
- Data fetching: TanStack Query (`useQuery`/`useMutation`). Never raw `useEffect + fetch`.
- State: Zustand stores. Cleanup intervals on unmount and logout. No stale subscriptions.
- SSR safety: `typeof window !== 'undefined'` guard on all browser-only APIs.
- Error handling: Every query destructures `isLoading`, `isError` and renders both states.
- Role-based: Early return with `<PageLoading />` for unauthorized roles. No content flash.
- Layout: shadcn Sidebar primitive (`web/src/components/ui/sidebar.tsx`) with collapsible icon mode; mobile uses Sheet overlay.
- Charts: shadcn `ChartContainer` (`web/src/components/ui/chart.tsx`) wrapping Recharts primitives. Never use raw `ResponsiveContainer` — always wrap in `<ChartContainer config={...}>`. Use `ChartTooltip`/`ChartTooltipContent` and `ChartLegend`/`ChartLegendContent` from the chart component. Colors use CSS variables `--chart-1` through `--chart-5` via `hsl(var(--chart-N))` in `ChartConfig`.
- Dashboard layout: shadcn dashboard-01 design. Sidebar has 3 nav groups (Main / Analytics / Team) with role-based filtering. Area charts with gradient fills for both admin (hours + activity) and employee (hours) views.

### 5. Desktop Security
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on ALL BrowserWindows
- ALL renderer ↔ main communication through `contextBridge` in preload script
- Token storage: AES-256-GCM via Node.js `crypto`. NOT keytar, NOT safeStorage (both trigger macOS keychain popups on ad-hoc signed apps)
- Screenshots on macOS: window capture first (avoids wallpaper-only bug), screen capture fallback
- **Logout conditions** (enforced in `api-client.js` interceptor): `forceLogout()` is ONLY triggered when token refresh returns HTTP 401 or 403 (genuine auth rejection: invalid/expired refresh token, password changed, token revoked). Network errors, timeouts, DNS failures, and 5xx server errors during token refresh do NOT trigger logout — the request simply fails and the user stays authenticated. This prevents the "unconditional logout" bug where transient network issues would log the user out.
- **Logout cleanup**: Both `forceLogout()` and `performLogout()` clean up: timer state, all services (activityMonitor, screenshotService, idleDetector, networkMonitor), powerMonitor/app listeners (`removeSessionListeners()`), timerSync interval, tray timer, offline queue, and encrypted token file.
- **Timer start mutex**: `startTimer()` uses a `_startTimerInProgress` flag with `try/finally` to prevent concurrent API calls from creating duplicate time entries on rapid double-clicks.
- **Local-first timer architecture**: Timer starts/stops write to SQLite (`timer_sessions` table) BEFORE calling the API. The local `started_at` timestamp is the source of truth and is never overwritten. If the API call fails (timeout, offline, server error), the timer continues running locally. On reconnect, `reconcileTimerState()` compares local vs server state and syncs using idempotency keys. The server `POST /timer/start` accepts an `idempotency_key`; if the key matches an existing entry, it returns that entry (200) instead of creating a duplicate. `POST /timer/stop` accepts optional `started_at`/`ended_at` timestamps for offline sync — both are validated server-side to be in the past.
- **Offline sync protocol**: Timer start/stop events are queued in SQLite with full timestamps. On reconnect, the queue flushes with exponential backoff: 5s, 15s, 30s, 60s, 120s (cap). Backoff resets on success. `timer_start` entries include `idempotency_key` to prevent duplicates. `timer_stop` entries include `started_at`/`ended_at` so the server uses the local timestamps. 409 on start and 404 on stop are treated as success (already synced). A single retry scheduler handles all failed calls — no per-call retry storms.
- **Platform-specific network detection**: macOS/Linux use Electron's `net.isOnline()` directly. Windows adds a ping fallback (`ping 1.1.1.1` with 3s timeout) since `net.isOnline()` can report false positives on Windows.
- **Sleep/wake behavior**: On suspend, `_suspendedAt` is recorded and capture services are paused. On resume, the sleep gap is calculated and compared against the idle threshold. Long sleeps trigger the idle alert (discard/keep/reassign). Short sleeps resume tracking normally. After any resume, `reconcileTimerState()` runs followed by an offline queue flush.
- **Offline queue**: Stores heartbeat data, screenshot file paths, and timer start/stop events only — no tokens or sensitive credentials in SQLite. Queue is closed and nullified on both logout paths to prevent cross-user data leakage.
- **API timeouts**: Timer start/stop calls use 10s timeout. Screenshot uploads use 30s timeout. Default API timeout is 15s.

### 6. Performance Budgets
| Metric | Target | Measured By |
|---|---|---|
| API response (p95) | < 200ms | Laravel Telescope / logs |
| Dashboard first paint | < 2s | Lighthouse |
| Desktop memory (idle) | < 150MB | Activity Monitor |
| Desktop memory (tracking) | < 250MB | Activity Monitor |
| Screenshot capture | < 3s | `[SS]` log timestamps |
| Time entry query (1M rows) | < 500ms | EXPLAIN ANALYZE |

### 7. Git & Release
- Branch: `fix/web-frontend-and-desktop-app` (current), merge to `main`
- Commits: conventional commits (`feat:`, `fix:`, `refactor:`, `chore:`)
- Desktop releases: GitHub Releases with `latest-mac.yml` / `latest.yml` manifests
- CI: `.github/workflows/tests.yml` — PHPUnit + `composer audit` + `npm audit`

## Multi-Organization Authentication

Users can belong to multiple organizations (same email, different `organization_id` in `users` table). The auth system handles this:

### Login Flow (email/password & Google OAuth)
1. Backend finds ALL User rows matching the email/Google ID
2. If single org: direct login (original behavior)
3. If multiple orgs: returns `{ "requires_org_selection": true, "organizations": [...] }`
4. Client shows org selector, user picks one
5. Client calls `POST /auth/select-organization` with credentials + `organization_id`

### API Endpoints
| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /auth/select-organization` | Public | Complete login after multi-org detection |
| `GET /auth/organizations` | Sanctum | List all orgs for the current user's email |
| `POST /auth/switch-organization` | Sanctum | Switch to different org (issues new tokens) |

### Frontend Components
| Component | Path | Purpose |
|---|---|---|
| OrgSelector | `web/src/components/org-selector.tsx` | Login-time org picker (Card UI) |
| OrgSwitcher | `web/src/components/org-switcher.tsx` | Dashboard header dropdown to switch orgs |
| Sidebar | `web/src/components/ui/sidebar.tsx` | shadcn Sidebar primitive (collapsible, mobile sheet, keyboard shortcut Cmd+B) |

### Desktop Google OAuth
- Uses OAuth Authorization Code flow via system browser
- Starts temporary local HTTP server on `127.0.0.1` for the callback
- Exchanges auth code for ID token, sends to `POST /auth/google`
- Requires `TRACKFLOW_GOOGLE_CLIENT_ID` and `TRACKFLOW_GOOGLE_CLIENT_SECRET` env vars

### Invitation-Aware Google Signup
- When a new Google user signs up, the backend checks for pending invitations
- Pending invitations are auto-accepted: user is added to those orgs with the invited role
- A personal org is also created so the user always has at least one

## HR Module (Phase 1)

Adds department/position org structure and leave management under `/api/v1/hr/`.

### Multi-Tenancy Rules for HR
- All 6 HR tables (`departments`, `positions`, `leave_types`, `leave_balances`, `leave_requests`, `public_holidays`) carry `organization_id` and are covered by `GlobalOrganizationScope` — no exception.
- `positions.min_salary` and `positions.max_salary` are **AES-256-GCM encrypted at rest**. Never expose raw cipher values in API responses; decryption happens inside `OrganizationStructureService`.
- **Self-approval is prevented at the service layer**: `LeaveService::approveLeave()` rejects if `approved_by === leave_request.user_id`. Do not bypass this check in controllers.
- Leave list endpoints are **role-scoped**: employees see only their own requests; managers see their direct reports; admins see the full org. This scoping lives in `LeaveService`, not in the controller.

### HR API Routes (all under `/api/v1/hr/`, Sanctum required)
| Route | Notes |
|---|---|
| `GET/POST /hr/departments` | Paginated list + create |
| `GET /hr/departments/tree` | Recursive org tree — no pagination, O(n) recursive builder in `OrganizationStructureService::getOrgTree()` |
| `GET/PUT/DELETE /hr/departments/{id}` | CRUD; DELETE archives (soft delete) |
| `GET/POST /hr/positions` | Paginated; filterable by `dept_id` and `level` query params |
| `GET/PUT/DELETE /hr/positions/{id}` | CRUD |
| `GET/POST /hr/leave-types` | Admin only for POST |
| `GET /hr/leave-balances` | Own balances; pass `?user_id=` for manager/admin view |
| `GET/POST /hr/leave-requests` | Role-scoped list + apply |
| `PUT /hr/leave-requests/{id}/approve` | Manager/admin only |
| `PUT /hr/leave-requests/{id}/reject` | Manager/admin only |
| `DELETE /hr/leave-requests/{id}` | Cancel (own request only) |
| `GET /hr/leave-calendar` | Team calendar; requires `month` + `year` query params |
| `GET/POST /hr/public-holidays` | Admin only for POST |

### Employee Records & Documents (Module 2)
- Tables: `employee_profiles` (personal/financial fields, encrypted bank fields), `employee_documents` (S3-backed, signed-URL access), `employee_notes` (confidential filtering)
- `EmployeeService`: `getDirectory()` (joined query with LIKE-safe escaping), `generateEmployeeId()` (lockForUpdate), `getNotes()` (viewer-based confidential filtering), `maskFinancialField()` (last-4 visible)
- **Encrypted fields**: `bank_name`, `bank_account_number`, `bank_routing_number`, `tax_id` on `EmployeeProfile` use Laravel `encrypted` cast + `$hidden`. Never expose raw values in API responses.
- **Signed URLs**: `file_path` is `$hidden` on `EmployeeDocument`; `download_url` accessor generates 15-min S3 `temporaryUrl()`. Never return raw S3 paths.
- **Field-level auth**: employees can only edit personal fields on their own profile (enforced in `EmployeeService::updateProfile()`); admins can edit all fields
- Routes: `GET/PUT /hr/employees`, `GET/PUT /hr/employees/{id}/profile`, `GET/POST/DELETE /hr/employees/{id}/documents`, `PUT /hr/employees/{id}/documents/{doc}/verify`, `GET/POST/DELETE /hr/employees/{id}/notes`

### Attendance HR Layer (Module 3)
- Tables: `attendance_records` (softDeletes, composite indexes), `attendance_regularizations` (softDeletes), `overtime_rules` (softDeletes, one per org)
- `AttendanceService`: `generateDailyAttendance()` chunks users (200/batch), uses `withoutGlobalScopes()` with explicit org_id for system-context queries; status priority: Holiday > On Leave > Weekend > Present (≥4h) > Half Day (≥2h) > Absent (<2h)
- `GenerateDailyAttendanceJob`: `$tries=3`, `$timeout=300`, `backoff=[60,120,300]`, `failed()` handler
- **Date filter params**: both frontend and backend use `start_date`/`end_date` (not `date_from`/`date_to`)
- **Valid attendance statuses**: `present`, `absent`, `half_day`, `on_leave`, `weekend`, `holiday` — `late` is NOT a status (tracked via `late_minutes` column)
- Routes: `GET /hr/attendance`, `GET /hr/attendance/team`, `GET /hr/attendance/summary`, `POST /hr/attendance/generate`, `GET/POST /hr/attendance/regularizations`, `POST /hr/attendance/{record}/regularize`, `PUT /hr/attendance/regularizations/{id}/approve`, `PUT /hr/attendance/regularizations/{id}/reject`, `GET/PUT /hr/overtime-rules`

### Shift Management (Module 5)
- Tables: `shifts` (softDeletes, new columns: `is_active`, `break_minutes`, `color`, `timezone`, `grace_period_minutes`, `description`), `shift_swap_requests` (softDeletes), `user_shifts` pivot (softDeletes added)
- `ShiftService`: CRUD, `assignUser()` with overlap prevention, `unassignUser()`, `bulkAssign()` (transactional), `getShiftRoster()` (7-day weekly view), swap request lifecycle (create/approve/reject/cancel)
- **Overlap prevention**: `assignUser()` checks for existing active pivot rows before inserting. A user can only have one active shift at a time.
- **Swap approval**: Creates single-day pivot overrides (`effective_from = effective_to = swap_date`). Self-approval prevented at both policy and service layers.
- **Grace period**: Per-shift `grace_period_minutes` deducted from late calculation in `AttendanceService`
- **Break deduction**: Per-shift `break_minutes` subtracted from shift duration in overtime calculation
- **Soft-deleted pivots**: `users()` and `activeUsers()` relationships filter `whereNull('user_shifts.deleted_at')`
- Routes: `GET/POST /hr/shifts`, `GET /hr/shifts/roster`, `GET/PUT/DELETE /hr/shifts/{id}`, `GET /hr/shifts/{id}/assignments`, `POST /hr/shifts/{id}/assign`, `POST /hr/shifts/{id}/unassign`, `POST /hr/shifts/{id}/bulk-assign`, `GET/POST /hr/shift-swaps`, `PUT /hr/shift-swaps/{id}/approve`, `PUT /hr/shift-swaps/{id}/reject`, `DELETE /hr/shift-swaps/{id}`

### Payroll & Salary Management (Module 4)
- Tables: `salary_structures` (type: monthly/hourly/daily, base_salary, effective dates), `pay_components` (allowance/deduction/bonus/tax, fixed/percentage), `employee_salary_assignments` (user+structure link, encrypted `custom_base_salary`), `payroll_periods` (status: draft/processing/approved/paid), `payslips` (gross/deductions/allowances/net, unique per user+period), `payslip_line_items` (earning/deduction breakdown)
- `PayrollService`: salary structure CRUD, pay component CRUD, payroll period management, `runPayroll()` (DB transaction, chunked processing, creates payslips + line items), `approvePayroll()` (lockForUpdate, marks all payslips approved), role-scoped `getPayslips()` (employee=own, manager=team, admin=all), `getPayslipDetail()` with authorization
- `RunPayrollJob`: `$tries=3`, `$timeout=300`, `backoff=[60,120,300]`, `failed()` handler -- dispatched from `PayrollPeriodController::run()`
- **Encrypted fields**: `custom_base_salary` on `EmployeeSalaryAssignment` uses Laravel `encrypted` cast + `$hidden`. Never exposed raw in API responses.
- **Role-based permissions** (7 new): `payroll.view_own` (employee), `payroll.view_team` (manager), `payroll.view_all` (admin/accountant), `payroll.run` (admin/accountant), `payroll.manage_structures` (admin), `payroll.manage_components` (admin), `payroll.approve` (admin/accountant)
- **Policies**: `PayslipPolicy::view()` -- employee can only view own; manager can view team; admin can view all. `SalaryStructurePolicy` / `PayComponentPolicy` -- admin only. `PayrollPeriodPolicy` -- run/approve require specific permissions.
- Routes: `GET/POST /hr/salary-structures`, `GET/PUT/DELETE /hr/salary-structures/{id}`, `GET/POST /hr/pay-components`, `GET/PUT/DELETE /hr/pay-components/{id}`, `GET/POST /hr/payroll-periods`, `GET/PUT/DELETE /hr/payroll-periods/{id}`, `POST /hr/payroll-periods/{id}/run`, `POST /hr/payroll-periods/{id}/approve`, `GET /hr/payslips`, `GET /hr/payslips/{id}`, `GET/POST /hr/employees/{id}/salary`

## Quick Reference — Key Files

| What | Where |
|---|---|
| API routes | `backend/routes/api.php` |
| Controllers | `backend/app/Http/Controllers/Api/V1/` |
| Services | `backend/app/Services/` (Timer, Report, Billing, Audit, Permission, OrganizationStructure, Leave, Payroll) |
| Models | `backend/app/Models/` |
| Migrations | `backend/database/migrations/` |
| Frontend pages | `web/src/app/(dashboard)/*/page.tsx` |
| API client | `web/src/lib/api.ts` (axios + token refresh mutex) |
| Zustand stores | `web/src/stores/` (auth-store, timer-store) |
| HR controllers | `backend/app/Http/Controllers/Api/V1/Hr/` (Department, Position, LeaveType, LeaveBalance, LeaveRequest, PublicHoliday, Employee, EmployeeDocument, EmployeeNote, Attendance, AttendanceRegularization, OvertimeRule, Shift, ShiftAssignment, ShiftSwap, SalaryStructure, PayComponent, PayrollPeriod, Payslip, EmployeeSalary) |
| HR services | `backend/app/Services/OrganizationStructureService.php`, `backend/app/Services/LeaveService.php`, `backend/app/Services/EmployeeService.php`, `backend/app/Services/AttendanceService.php`, `backend/app/Services/ShiftService.php`, `backend/app/Services/PayrollService.php` |
| HR pages | `web/src/app/(dashboard)/hr/` (departments, positions, leave, leave/apply, leave/approvals, leave/calendar, leave/types, employees, employees/[id], attendance, attendance/team, attendance/regularizations, shifts, shifts/roster, shifts/assignments, shifts/swaps, payroll, payroll/periods, payroll/periods/[id], payroll/my-payslips, payroll/structures, payroll/components) |
| HR components | `web/src/components/hr/` (DepartmentSelect, PositionSelect, LeaveBalanceCard, LeaveCalendar, LeaveApprovalCard, EmployeeCard, EmployeeStatusBadge, AttendanceStatusBadge, AttendanceSummaryCard, RegularizationCard, etc.) |
| HR hooks | `web/src/hooks/hr/` (use-departments, use-positions, use-leave-requests, use-leave-balance, use-apply-leave, use-employees, use-employee-documents, use-attendance, use-regularizations, use-overtime-rules, use-payroll, use-payslips, use-salary-structures, use-pay-components, etc.) |
| Org selector | `web/src/components/org-selector.tsx` |
| Org switcher | `web/src/components/org-switcher.tsx` |
| Sidebar primitive | `web/src/components/ui/sidebar.tsx` (shadcn Sidebar with collapsible icon mode) |
| Chart primitive | `web/src/components/ui/chart.tsx` (shadcn ChartContainer, ChartTooltip, ChartLegend) |
| Desktop main | `desktop/src/main/index.js` (includes local-first timer with SQLite, reconciliation, sleep/wake) |
| Desktop services | `desktop/src/main/` (screenshot, activity, idle, offline, keychain, network-monitor, api-client, timer-manager) |
| Desktop timer tests | `desktop/test/timer-start.test.js`, `timer-stop.test.js`, `offline-sync.test.js`, `network-resilience.test.js`, `platform-compat.test.js` |
| Build config | `desktop/package.json` (build field) |
| Docker dev | `compose.yaml` |
| Docker prod | `compose.production.yaml` |
