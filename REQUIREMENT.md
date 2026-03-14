# TrackFlow — Workforce Monitoring SaaS
### Software Requirements & Build Plan · v1.0 · CodeUpscale

> **Built for Claude Code.** Every section includes implementation instructions, priority labels (`Must` / `Should` / `Could`), and exact notes on what to scaffold, where, and how.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Database Schema](#2-database-schema)
3. [Authentication & Authorization](#3-authentication--authorization)
4. [Time Tracking Service](#4-time-tracking-service)
5. [Desktop Agent (Electron)](#5-desktop-agent-electron)
6. [Screenshot Service](#6-screenshot-service)
7. [Analytics & Reporting](#7-analytics--reporting)
8. [Billing (Stripe)](#8-billing-stripe)
9. [Web Dashboard (Next.js)](#9-web-dashboard-nextjs)
11. [Background Jobs (Horizon)](#11-background-jobs-horizon)
12. [Infrastructure & DevOps](#12-infrastructure--devops)
13. [Security Requirements](#13-security-requirements)
14. [Build Order — Phase by Phase](#14-build-order--phase-by-phase)
15. [Agentic Development Architecture](#15-agentic-development-architecture)

---

## 1. Introduction

### 1.1 Product Overview

TrackFlow is a multi-tenant SaaS workforce monitoring platform that competes directly with Hubstaff and Time Doctor. It gives employers real-time visibility into remote and hybrid team activity through time tracking, desktop screenshot capture, app/URL monitoring, productivity scoring, team reporting, and payroll-ready timesheet exports.

**Target market:** US-based SMBs with 5–500 distributed employees.

### 1.2 Scope

- Multi-tenant SaaS — row-level tenancy via `organization_id`
- Desktop agent for Windows & macOS (Electron + Node.js)
- Web dashboard for managers and owners (Next.js)
- REST API consumed by all three clients (Laravel)
- Per-seat billing via Stripe (monthly and annual plans)

### 1.3 Technology Stack

> **Claude Code instruction:** Scaffold as a Laravel monorepo with a separate `web/` (Next.js) workspace. Desktop agent is a standalone Electron project.

| Layer | Stack |
|---|---|
| Backend API | `Laravel 11` · `PHP 8.3` · `PostgreSQL 16` · `Redis 7` |
| Frontend | `Next.js 14` · `React 18` · `TailwindCSS` · `Zustand` · `shadcn/ui` |
| Desktop Agent | `Electron 30` · `Node.js 20` · `electron-builder` |
| Infrastructure | `AWS S3` · `CloudFront` · `Laravel Horizon` · `Laravel Reverb` · `Stripe` · `Laravel Sail` (dev) · `Docker` |

### 1.4 Definitions

| Term | Definition |
|---|---|
| **Organization** | A tenant — one paying customer account containing multiple users |
| **Owner** | Top-level admin; manages billing and all org settings |
| **Admin** | Can manage users and settings but not billing |
| **Manager** | Views team activity, approves timesheets, runs reports |
| **Employee** | Tracked user; sees only their own data |
| **Time Entry** | A logged block of time with start, end, project, and task |
| **Activity Score** | 0–100% measure of keyboard + mouse activity per time entry |
| **Screenshot** | Periodic desktop capture tied to a time entry |
| **Shift** | Predefined work schedule enforced per employee |
| **Timesheet** | Aggregated time entries for a pay period requiring approval |
| **Seat** | One active Employee account — the billable unit |

---

## 2. Database Schema

> **Claude Code instruction:** Use **row-level multi-tenancy**. Every table except `organizations` and `users` carries an `organization_id` column. Apply a `GlobalOrganizationScope` in a base `Model` class that auto-appends `WHERE organization_id = ?` to all queries. Use **UUIDs** as primary keys throughout. All migrations should run in the dependency order listed below.

### 2.1 Migration Order

```
1. organizations
2. users
3. teams
4. team_user (pivot)
5. projects
6. tasks
7. shifts
8. user_shifts
9. time_entries
10. screenshots
11. activity_logs       ← partition by month on logged_at
12. timesheets
13. invitations
14. api_keys
15. personal_access_tokens  ← Laravel Sanctum
16. jobs / failed_jobs      ← Laravel Queue
17. password_reset_tokens   ← Laravel built-in
```

### 2.2 organizations

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PK` | |
| `name` | `VARCHAR(255)` | Company name |
| `slug` | `VARCHAR(100) UNIQUE` | URL-safe; used for subdomain routing |
| `plan` | `ENUM(trial, starter, pro, enterprise)` | Current billing plan |
| `stripe_customer_id` | `VARCHAR(255) NULL` | |
| `stripe_subscription_id` | `VARCHAR(255) NULL` | |
| `trial_ends_at` | `TIMESTAMP NULL` | 14 days from `created_at` |
| `settings` | `JSONB` | `screenshot_interval`, `blur_screenshots`, `idle_timeout`, `timezone`, `can_add_manual_time` |
| `created_at` / `updated_at` | `TIMESTAMP` | |

### 2.3 users

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PK` | |
| `organization_id` | `UUID FK → organizations` | Tenant scope |
| `name` | `VARCHAR(255)` | |
| `email` | `VARCHAR(255)` | Unique per organization |
| `password` | `VARCHAR(255)` | Bcrypt hashed |
| `role` | `ENUM(owner, admin, manager, employee)` | RBAC role |
| `timezone` | `VARCHAR(64)` | e.g. `America/New_York` |
| `avatar_url` | `VARCHAR(255) NULL` | S3 URL |
| `is_active` | `BOOLEAN DEFAULT true` | Soft-disable without deleting |
| `last_active_at` | `TIMESTAMP NULL` | Last timer activity |
| `settings` | `JSONB` | Notification prefs, theme |
| `email_verified_at` | `TIMESTAMP NULL` | `NULL` = unverified |

### 2.4 projects

```
id UUID PK
organization_id UUID FK
name VARCHAR(255)
color VARCHAR(7)        -- hex e.g. #3B82F6
billable BOOLEAN DEFAULT false
hourly_rate DECIMAL(8,2) NULL
is_archived BOOLEAN DEFAULT false
created_by UUID FK → users
timestamps
```

### 2.5 tasks

```
id UUID PK
organization_id UUID FK
project_id UUID FK → projects
name VARCHAR(255)
description TEXT NULL
is_archived BOOLEAN DEFAULT false
created_by UUID FK → users
timestamps
```

### 2.6 time_entries

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PK` | |
| `organization_id` | `UUID FK` | Tenant scope |
| `user_id` | `UUID FK → users` | |
| `project_id` | `UUID FK NULL` | |
| `task_id` | `UUID FK NULL` | |
| `started_at` | `TIMESTAMP` | UTC always |
| `ended_at` | `TIMESTAMP NULL` | `NULL` = currently running |
| `duration_seconds` | `INTEGER NULL` | Computed on stop |
| `type` | `ENUM(tracked, manual, idle)` | `tracked` = agent, `manual` = web, `idle` = auto-paused |
| `activity_score` | `SMALLINT NULL` | 0–100; `NULL` for manual entries |
| `notes` | `TEXT NULL` | |
| `is_approved` | `BOOLEAN DEFAULT false` | |
| `approved_by` | `UUID FK NULL → users` | |
| `approved_at` | `TIMESTAMP NULL` | |
| `deleted_at` | `TIMESTAMP NULL` | Soft deletes |

> **Index:** `(organization_id, user_id, started_at DESC)` — used by all timeline queries.

### 2.7 screenshots

```
id UUID PK
organization_id UUID FK
user_id UUID FK → users
time_entry_id UUID FK → time_entries
s3_key VARCHAR(512)           -- e.g. {org_id}/{user_id}/{date}/{epoch}.jpg
captured_at TIMESTAMP
activity_score_at_capture SMALLINT NULL
is_blurred BOOLEAN DEFAULT false
width SMALLINT
height SMALLINT
timestamps
```

### 2.8 activity_logs

```
id UUID PK
organization_id UUID FK
user_id UUID FK → users
time_entry_id UUID FK → time_entries
logged_at TIMESTAMP            -- PARTITION BY RANGE on this column (monthly)
keyboard_events INT DEFAULT 0
mouse_events INT DEFAULT 0
active_app VARCHAR(255) NULL
active_window_title VARCHAR(512) NULL
active_url VARCHAR(1024) NULL
```

> **Claude Code instruction:** Create monthly partitions. Use `CREATE TABLE activity_logs_2026_03 PARTITION OF activity_logs FOR VALUES FROM ('2026-03-01') TO ('2026-04-01')`. Add a `PruneOldActivityLogsJob` that drops partitions past the retention window.

### 2.9 Supporting Tables

**teams**
```
id, organization_id, name VARCHAR(255), manager_id UUID FK → users, timestamps
```

**team_user** *(pivot)*
```
team_id UUID FK, user_id UUID FK, PRIMARY KEY (team_id, user_id)
```

**shifts**
```
id, organization_id, name, start_time TIME, end_time TIME,
days_of_week JSONB  -- e.g. ["mon","tue","wed","thu","fri"]
```

**user_shifts**
```
id, user_id FK, shift_id FK, effective_from DATE, effective_to DATE NULL
```

**timesheets**
```
id, organization_id, user_id FK, period_start DATE, period_end DATE,
total_seconds INT DEFAULT 0,
status ENUM(draft, submitted, approved, rejected),
submitted_at TIMESTAMP NULL, reviewed_by UUID NULL FK → users, reviewed_at TIMESTAMP NULL
```

**invitations**
```
id, organization_id, email, role ENUM(admin,manager,employee),
token VARCHAR(64) UNIQUE, accepted_at TIMESTAMP NULL,
expires_at TIMESTAMP, created_by UUID FK → users
```

**api_keys**
```
id, organization_id, user_id FK, name VARCHAR(100),
key_hash VARCHAR(64), last_used_at TIMESTAMP NULL,
permissions JSONB, is_active BOOLEAN DEFAULT true
```

---

## 3. Authentication & Authorization

> **Claude Code instruction:** Use **Laravel Sanctum** for API token auth. Include `organization_id` and `role` in the token payload (custom claims). Apply `OrganizationScope` globally. Build two middleware classes: `RoleMiddleware` (checks `$user->role`) and `OwnsResource` (checks ownership or manager scope).

### 3.1 RBAC Permission Matrix

| Action | Owner | Admin | Manager | Employee |
|---|:---:|:---:|:---:|:---:|
| View own time entries | ✅ | ✅ | ✅ | ✅ |
| Start/stop own timer | ✅ | ✅ | ✅ | ✅ |
| Edit own manual time entries | ✅ | ✅ | ✅ | ✅ |
| View team time entries | ✅ | ✅ | ✅ | ❌ |
| View team screenshots | ✅ | ✅ | ✅ | ❌ |
| Approve timesheets | ✅ | ✅ | ✅ | ❌ |
| Manage projects & tasks | ✅ | ✅ | ✅ | ❌ |
| Invite & manage users | ✅ | ✅ | ❌ | ❌ |
| Configure org settings | ✅ | ✅ | ❌ | ❌ |
| Access billing | ✅ | ❌ | ❌ | ❌ |
| Delete organization | ✅ | ❌ | ❌ | ❌ |

### 3.2 Auth Endpoints

| ID | Endpoint | Priority | Implementation Notes |
|---|---|---|---|
| `AUTH-01` | `POST /api/v1/auth/register` — Create org + owner. Body: `name, email, password, company_name, timezone`. | **Must** | Hash with bcrypt. Auto-generate slug from `company_name`. Start 14-day trial. |
| `AUTH-02` | `POST /api/v1/auth/login` — Returns `access_token` (24hr JWT) + `refresh_token` (30d) + user object. | **Must** | Include `organization_id` and `role` in Sanctum token payload. |
| `AUTH-03` | `POST /api/v1/auth/refresh` — Exchange refresh token for new access token. | **Must** | Rotate refresh token on use (invalidate old). |
| `AUTH-04` | `POST /api/v1/auth/logout` — Revoke current access token. | **Must** | Delete from `personal_access_tokens`. |
| `AUTH-05` | `POST /api/v1/auth/forgot-password` — Send reset email. | **Must** | Laravel built-in. Expire after 60 min. |
| `AUTH-06` | `POST /api/v1/auth/reset-password` — Consume token, set new password. | **Must** | |
| `AUTH-07` | `GET /api/v1/auth/me` — Return user with org and permissions. | **Must** | |
| `AUTH-08` | `POST /api/v1/auth/google` — Google OAuth via Laravel Socialite. | **Should** | Create or link account. New users need invite token or org selection. |
| `AUTH-09` | `POST /api/v1/invitations` — Owner/admin sends invite with role. | **Must** | Signed email link. Expire after 7 days. |
| `AUTH-10` | `POST /api/v1/invitations/accept` — Accept invite, create user account. | **Must** | Validate token, attach to org with invited role. |

---

## 4. Time Tracking Service

> **Claude Code instruction:** Timer state must live in **both PostgreSQL and Redis**. Redis key: `timer:{user_id}` → `{entry_id, started_at}`. This enables fast real-time status checks and survives API restarts. Always sync Redis + DB atomically inside `DB::transaction`. Never update one without the other.

### 4.1 Timer Endpoints

| ID | Endpoint | Priority | Implementation Notes |
|---|---|---|---|
| `TIME-01` | `POST /api/v1/timer/start` — Start timer. Body: `project_id?`, `task_id?`, `notes?`. Fails if timer already running. | **Must** | Check Redis first. Create `time_entry` with `ended_at=null`. Set Redis key (30d TTL). |
| `TIME-02` | `POST /api/v1/timer/stop` — Stop running timer. Returns completed entry. | **Must** | Remove Redis key. Set `ended_at`, compute `duration_seconds`. |
| `TIME-03` | `POST /api/v1/timer/pause` — Mark timer as idle. | **Must** | Stop tracked entry, create new entry with `type=idle`. |
| `TIME-04` | `GET /api/v1/timer/status` — Return current timer state. | **Must** | Read from Redis only. Returns `{running, entry, elapsed_seconds}`. Fast. |
| `TIME-05` | `POST /api/v1/time-entries` — Create manual entry. Body: `started_at, ended_at, project_id?, task_id?, notes`. | **Must** | `type=manual`. No `activity_score`. Respect `can_add_manual_time` org setting. |
| `TIME-06` | `PUT /api/v1/time-entries/{id}` — Edit entry. Employees edit own; managers edit team. | **Must** | Recalculate `duration_seconds`. Re-evaluate timesheet approval status. |
| `TIME-07` | `DELETE /api/v1/time-entries/{id}` — Soft delete. | **Must** | Laravel soft deletes. Managers can delete any team entry. |
| `TIME-08` | `GET /api/v1/time-entries` — Paginated list. Filters: `user_id, project_id, date_from, date_to, type, is_approved`. | **Must** | Always scope to `organization_id`. Employees see only own. |
| `TIME-09` | `POST /api/v1/time-entries/{id}/approve` — Manager approves entry. | **Should** | Set `is_approved=true`, `approved_by`, `approved_at`. |
| `TIME-10` | `POST /api/v1/timesheets/submit` — Employee submits timesheet for period. | **Should** | Aggregate entries. Create timesheet record. Queue manager notification. |
| `TIME-11` | `POST /api/v1/timesheets/{id}/review` — Manager approves or rejects. Body: `action (approve\|reject), notes`. | **Should** | Update `status`. Dispatch email to employee. |

### 4.2 Heartbeat & Idle Detection

> Idle detection runs in the **desktop agent**, not the server.

**Heartbeat — `POST /api/v1/timer/heartbeat`**

```json
{
  "keyboard_events": 142,
  "mouse_events": 38,
  "active_app": "VS Code",
  "active_window_title": "srs_gen.js — TrackFlow",
  "active_url": "https://github.com/..."
}
```

- Agent sends heartbeat every **30 seconds** while timer is running
- Server stores record in `activity_logs` and updates `activity_score` on the time entry
- `activity_score = (keyboard_events + mouse_events) / max_expected_events * 100` — capped at 100
- If heartbeat stops for `idle_timeout` minutes (default: 5), server marks entry paused and dispatches `SendTimerIdleAlertJob`

---

## 5. Desktop Agent (Electron)

> **Claude Code instruction:** Scaffold with `electron + electron-builder`. Main process handles all OS interactions. Renderer is a minimal React tray popup. All API calls go through a preload script using `contextBridge`. Package: Windows (NSIS installer) + macOS (DMG).

### 5.1 Agent Requirements

| ID | Requirement | Priority | Implementation Notes |
|---|---|---|---|
| `AGENT-01` | **Tray app** — No main window. Runs in system tray. Click → mini popup with timer state, project selector, start/stop. | **Must** | `BrowserWindow` with `frame: false, skipTaskbar: true`. Show org logo in tray icon. |
| `AGENT-02` | **Screenshot capture** — Capture all monitors at org-configured interval (default 5 min). Compress JPEG @ quality 80. Upload to API. | **Must** | `desktopCapturer` API. `POST /api/v1/screenshots` multipart. Queue locally if offline. |
| `AGENT-03` | **Activity monitoring** — Track keyboard event count + mouse move/click count per 30s interval. **Never log keystrokes — counts only.** | **Must** | Use `uiohook-napi` (cross-platform). Send counts in heartbeat. |
| `AGENT-04` | **App tracking** — Capture active app name + window title every 30s. | **Must** | macOS: AppleScript. Windows: `GetForegroundWindow` Win32 via Node addon. Include in heartbeat. |
| `AGENT-05` | **URL tracking** — If active app is Chrome/Firefox/Edge/Safari, capture current tab URL. | **Should** | Requires companion browser extension. Store in `activity_logs.active_url`. |
| `AGENT-06` | **Offline queue** — If network unavailable, queue screenshots + heartbeats in local SQLite. Flush on reconnect. | **Must** | `better-sqlite3`. Exponential backoff retry on reconnect. |
| `AGENT-07` | **Auto-start** — Register agent to start on system login. | **Must** | `app.setLoginItemSettings({ openAtLogin: true })` on both platforms. |
| `AGENT-08` | **Auto-update** — Check for updates on startup. Download and prompt to install. | **Must** | `electron-updater`. Host releases on GitHub Releases or S3. |
| `AGENT-09` | **Screenshot blur** — If `org.settings.blur_screenshots = true`, blur screenshot before upload. | **Should** | Use `sharp` npm package. Gaussian blur. Upload blurred version only — never store raw. |
| `AGENT-10` | **Credentials in keychain** — Never store tokens in plain text files. | **Must** | `keytar` npm package. Clear on logout. |

### 5.2 Agent API Contract

All agent requests require:
```
Authorization: Bearer {token}
X-Agent-Version: 1.0.0
```

| Endpoint | Frequency | Purpose |
|---|---|---|
| `POST /api/v1/timer/heartbeat` | Every 30s (while running) | Activity counts + app info |
| `POST /api/v1/screenshots` | Per interval (multipart) | `file, time_entry_id, captured_at` |
| `GET /api/v1/agent/config` | On startup + hourly | Returns `screenshot_interval, idle_timeout, track_urls, blur_screenshots` |
| `POST /api/v1/agent/logs` | On reconnect (bulk) | Array of queued activity log objects |

---

## 6. Screenshot Service

> **Claude Code instruction:** Screenshots must **never be publicly accessible**. All S3 objects go into a **private bucket**. Generate pre-signed CloudFront URLs on every read request (15-min expiry). For gallery views, issue **CloudFront signed cookies** (valid 2 hours) to avoid thousands of individual signed URLs.

### 6.1 S3 Key Structure

```
s3://trackflow-screenshots/{org_id}/{user_id}/{YYYY-MM-DD}/{timestamp_epoch}.jpg
```

### 6.2 CloudFront Setup

- S3 bucket policy: `deny s3:GetObject from *`, allow only from CloudFront Origin Access Identity (OAI)
- CloudFront distribution with signed URLs/cookies enabled
- `CLOUDFRONT_KEY_PAIR_ID` + `CLOUDFRONT_PRIVATE_KEY_PATH` in `.env`

### 6.3 Screenshot Endpoints

| ID | Endpoint | Priority | Notes |
|---|---|---|---|
| `SS-01` | `POST /api/v1/screenshots` — Upload from agent. Multipart: `file, time_entry_id, captured_at`. | **Must** | Validate JPEG < 5MB. Store to S3. Create DB record. Dispatch `ProcessScreenshotJob`. |
| `SS-02` | `GET /api/v1/screenshots` — List with filters: `user_id, date_from, date_to, time_entry_id`. Returns paginated list with signed URLs. | **Must** | Generate CloudFront signed URL per screenshot. Employees see own only. |
| `SS-03` | `DELETE /api/v1/screenshots/{id}` — Owner/admin only. | **Should** | Delete from S3 and DB. Log deletion audit event. |
| `SS-04` | `ProcessScreenshotJob` (background) — Resize to max 1280px, optimize JPEG, store processed version, delete raw. | **Must** | Use `Intervention Image` or process via Lambda@Edge. |
| `SS-05` | `GET /api/v1/screenshots/signed-cookies` — Issue CloudFront signed cookies for gallery. | **Should** | 2-hour expiry. Scoped to org + date range. |

---

## 7. Analytics & Reporting

> **Claude Code instruction:** All aggregate queries run against a **read replica** (or ClickHouse in phase 2). Never run heavy report queries on the primary DB. Encapsulate all report logic in a `ReportService` class. Cache results in Redis for 15 minutes. Cache key pattern: `report:{org_id}:{type}:{period}:{user_id_hash}`.

### 7.1 Report Endpoints

| ID | Endpoint | Priority | Notes |
|---|---|---|---|
| `REPT-01` | `GET /api/v1/reports/summary` — Hours, activity score, earnings for a period. Params: `user_id?, period (week\|month\|custom), date_from, date_to`. | **Must** | Aggregate `time_entries`. Return `[{date, total_seconds, activity_score_avg, earnings}]`. |
| `REPT-02` | `GET /api/v1/reports/team` — Summary for all team members. Manager/owner only. | **Must** | Array of user summaries ranked by `total_seconds`. |
| `REPT-03` | `GET /api/v1/reports/projects` — Hours by project and task. | **Must** | Join `time_entries → projects → tasks`. Group and sum. |
| `REPT-04` | `GET /api/v1/reports/apps` — Top 20 apps by time spent. Derived from `activity_logs`. | **Should** | Group by `active_app`, sum duration. Employees see own; managers see team. |
| `REPT-05` | `GET /api/v1/reports/timeline` — Per-minute activity timeline for a user on a given date. | **Should** | Merge `activity_logs` + `time_entries` into a 24-hour block array. |
| `REPT-06` | `POST /api/v1/reports/export` — Queue PDF or CSV export. Body: `type, format (pdf\|csv), period`. | **Must** | Dispatch `GenerateReportJob`. Return `{job_id}`. Poll `GET /api/v1/jobs/{id}`. Store in S3, return download URL. |
| `REPT-07` | `GET /api/v1/reports/payroll` — Payroll-ready: user, total hours, billable hours, rate, earnings. | **Should** | Join users + approved time entries + billable projects. |
| `REPT-08` | `GET /api/v1/reports/attendance` — Daily log: who was active, first seen, last seen, total hours. | **Should** | Group `time_entries` by user + day. |

### 7.2 Real-time Dashboard

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| `DASH-01` | `GET /api/v1/dashboard` — Who is online now, today's hours per user, team activity score. | **Must** | Check Redis for active timers. Cache 60s. |
| `DASH-02` | WebSocket channel `private-org.{org_id}` — Broadcast: `TimerStarted, TimerStopped, EmployeeIdle, ScreenshotUploaded`. | **Must** | Use **Laravel Reverb** (self-hosted) or Pusher. Laravel Echo on frontend. |
| `DASH-03` | Manager alert when employee activity < 20% for 10 consecutive minutes. | **Should** | `LowActivityJob` checks heartbeats. Broadcasts `LowActivityAlert`. |

---

## 8. Billing (Stripe)

> **Claude Code instruction:** Use `stripe/stripe-php` SDK. Store Stripe Price IDs in `.env` — never hardcode amounts. Verify Stripe webhook signature on every inbound event using `STRIPE_WEBHOOK_SECRET`. Use idempotency keys on all Stripe API calls.

### 8.1 Plans

| Plan | Price/seat/mo | Annual | Limits |
|---|---|---|---|
| **Trial** | $0 | — | 14 days · 5 seats max · all Pro features |
| **Starter** | $7 | $5.60 (20% off) | ≤20 seats · screenshot every 10 min · 90-day history |
| **Pro** | $10 | $8 (20% off) | Unlimited seats · every 5 min · unlimited history · payroll export |
| **Enterprise** | Custom | Custom | SSO · dedicated support · SLA · on-premise option |

### 8.2 Billing Endpoints

| ID | Endpoint | Priority | Notes |
|---|---|---|---|
| `BILL-01` | `POST /api/v1/billing/subscribe` — Upgrade from trial. Body: `plan, interval (monthly\|annual), payment_method_id`. | **Must** | Create Stripe customer if not exists. Create subscription. Update `org.plan`. |
| `BILL-02` | `POST /api/v1/billing/change-plan` — Upgrade or downgrade. | **Must** | Prorate via Stripe. Upgrade immediately; downgrade at period end. |
| `BILL-03` | `POST /api/v1/billing/cancel` — Cancel at period end. | **Must** | `cancel_at_period_end = true` on Stripe. Show cancellation date in dashboard. |
| `BILL-04` | `GET /api/v1/billing/invoices` — Past invoices with download links. | **Should** | Fetch from Stripe. Return Stripe-hosted PDF URLs. |
| `BILL-05` | `GET /api/v1/billing/usage` — Current seat count vs plan limit. | **Must** | Returns `{used, limit, overage}`. Count active `role=employee` users. |
| `BILL-06` | `POST /api/v1/webhooks/stripe` — Handle Stripe webhooks. | **Must** | Verify signature. Handle: `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.deleted`, `customer.subscription.updated`. |
| `BILL-07` | Seat limit enforcement — Block inviting new employees when at plan limit. | **Must** | Check on `POST /invitations` + `POST /users`. Return `402` with upgrade prompt. |

### 8.3 Required `.env` Variables — Stripe

```env
STRIPE_KEY=pk_live_...
STRIPE_SECRET=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

STRIPE_PRICE_STARTER_MONTHLY=price_...
STRIPE_PRICE_STARTER_ANNUAL=price_...
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_PRO_ANNUAL=price_...
```

---

## 9. Web Dashboard (Next.js)

> **Claude Code instruction:** Next.js 14 App Router. All authenticated routes under `/app/(dashboard)/`. Use **Zustand** for global state (auth, timer, org). **TanStack Query** for server state. Pre-configure an Axios instance with `Authorization` header interceptor and `organization_id` header. Component library: **shadcn/ui**. Charts: **Recharts**.

### 9.1 Pages & Routes

| ID | Route | Priority | Notes |
|---|---|---|---|
| `UI-01` | `/login`, `/register`, `/forgot-password` | **Must** | React Hook Form + Zod validation. Redirect to `/dashboard` on success. |
| `UI-02` | `/dashboard` | **Must** | Live team activity feed. WebSocket on mount. Real-time timer updates via Laravel Echo. |
| `UI-03` | `/time` | **Must** | Time entries list + calendar toggle. Inline timer widget at top. Bulk approve for managers. |
| `UI-04` | `/screenshots` | **Must** | Grid gallery by employee + date. Lazy-load via CloudFront signed cookies. Activity score overlay. |
| `UI-05` | `/reports` | **Must** | Report builder: type, date range, users. Preview + export (PDF/CSV). Recharts charts. |
| `UI-06` | `/team` | **Must** | User management. Invite, edit roles, deactivate, assign to teams/shifts. Seat count vs limit. |
| `UI-07` | `/projects` | **Must** | Project + task management. Drag-and-drop reorder (dnd-kit). Color picker. |
| `UI-08` | `/settings` | **Must** | Org settings: screenshot interval, idle timeout, timezone. Tabbed layout. |
| `UI-09` | `/settings/billing` | **Must** | Plan info, seat usage meter, invoice history, upgrade/cancel. Stripe Customer Portal link. |
| `UI-10` | Timer widget (persistent) | **Must** | In dashboard header. Shows elapsed time. Syncs with agent via WebSocket. Starting from web also starts agent if connected. |

### 9.2 Frontend Non-Functional Requirements

- All pages load in < 2s on 10 Mbps (Lighthouse target)
- Fully responsive: 375px mobile → 1920px desktop
- Dark mode via Tailwind `dark:` class strategy
- WCAG 2.1 AA accessibility — all elements keyboard navigable
- Error boundaries on all page-level components — never a raw crash

---

## 11. Background Jobs (Horizon)

> **Claude Code instruction:** Configure **Laravel Horizon** with named queues and worker counts. Run Horizon under `supervisor` in production. All jobs must be idempotent. Use `ShouldBeUnique` where noted.

### 11.1 Queue Priority Order

```
critical  →  timer sync, auth operations
high      →  screenshots, notifications
default   →  reports, exports
low       →  analytics sync, cleanup, reminders
```

### 11.2 Job Registry

| ID | Job | Queue | Timeout | Retry | Notes |
|---|---|---|---|---|---|
| `JOB-01` | `ProcessScreenshotJob` — Resize, optimize, store to S3, delete raw. | `high` | 60s | 3 | Use Intervention Image. |
| `JOB-02` | `SendTimerIdleAlertJob` — Notify manager on employee idle. | `high` | 30s | 3 | Dispatch WebSocket event + email. |
| `JOB-03` | `GenerateReportJob` — Build PDF/CSV, store to S3, notify via WebSocket. | `default` | 300s | 2 | PDF: `barryvdh/laravel-dompdf`. Update job status record. |
| `JOB-04` | `SendTimesheetReminderJob` — Friday 4pm in employee timezone. | `low` | 30s | 3 | Scheduled via Scheduler. `ShouldBeUnique` by `org_id + week`. |
| `JOB-05` | `SyncStripeUsageJob` — Hourly seat count report to Stripe. | `low` | 30s | 3 | Idempotent by `org_id + hour`. |
| `JOB-06` | `PruneOldActivityLogsJob` — Daily 2am UTC. Delete logs past retention window. | `low` | 600s | 1 | Drop entire monthly partition where applicable. |
| `JOB-07` | `FlushAgentQueueJob` — Process bulk upload from reconnected offline agent. | `high` | 120s | 3 | Fan out to individual handlers. |
| `JOB-08` | `SendEmailNotificationJob` — Generic email dispatch wrapper. | `high` | 30s | 5 | Laravel Mail + SES/SMTP. Used by all other jobs. |

---

## 12. Infrastructure & DevOps

### 12.1 Laravel Sail Development Environment

> **Claude Code instruction:** Use **Laravel Sail** as the development environment. Sail is Laravel's official Docker wrapper — no custom `Dockerfile` or `docker-compose.yml` to maintain. Developers only need Docker Desktop installed. All `php`, `composer`, and `artisan` commands run through the `sail` CLI wrapper which proxies into the container.

#### Installation

```bash
# 1. Create the project with Sail pre-installed
composer create-project laravel/laravel trackflow
cd trackflow

# 2. Install Sail
composer require laravel/sail --dev
php artisan sail:install
# When prompted, select: pgsql, redis, mailpit, minio
```

This generates a `docker-compose.yml` in the project root managed by Sail. Do not hand-edit it — use `sail:publish` if customisation is needed.

---

#### Add extra services to `docker-compose.yml`

Sail's generated file covers `laravel.test`, `pgsql`, `redis`, `mailpit`, and `minio`. Add the three extra services below (Horizon, Reverb, Scheduler) by appending them to the `services:` block after running `php artisan sail:publish`:

```yaml
# Append to services: in docker-compose.yml after sail:publish

  horizon:
    build:
      context: ./vendor/laravel/sail/runtimes/8.3
      dockerfile: Dockerfile
      args:
        WWWGROUP: '${WWWGROUP}'
    image: sail-8.3/app
    extra_hosts:
      - 'host.docker.internal:host-gateway'
    environment:
      WWWUSER: '${WWWUSER}'
      LARAVEL_SAIL: 1
      APP_ENV: '${APP_ENV}'
    volumes:
      - '.:/var/www/html'
    networks:
      - sail
    depends_on:
      - pgsql
      - redis
    command: php artisan horizon

  reverb:
    build:
      context: ./vendor/laravel/sail/runtimes/8.3
      dockerfile: Dockerfile
      args:
        WWWGROUP: '${WWWGROUP}'
    image: sail-8.3/app
    extra_hosts:
      - 'host.docker.internal:host-gateway'
    ports:
      - '${REVERB_PORT:-8080}:8080'
    environment:
      WWWUSER: '${WWWUSER}'
      LARAVEL_SAIL: 1
      APP_ENV: '${APP_ENV}'
    volumes:
      - '.:/var/www/html'
    networks:
      - sail
    depends_on:
      - pgsql
      - redis
    command: php artisan reverb:start --host=0.0.0.0 --port=8080

  scheduler:
    build:
      context: ./vendor/laravel/sail/runtimes/8.3
      dockerfile: Dockerfile
      args:
        WWWGROUP: '${WWWGROUP}'
    image: sail-8.3/app
    extra_hosts:
      - 'host.docker.internal:host-gateway'
    environment:
      WWWUSER: '${WWWUSER}'
      LARAVEL_SAIL: 1
      APP_ENV: '${APP_ENV}'
    volumes:
      - '.:/var/www/html'
    networks:
      - sail
    depends_on:
      - pgsql
      - redis
    command: /bin/sh -c "while true; do php artisan schedule:run --no-interaction; sleep 60; done"
```

> **Note:** All three extra services use the same Sail runtime image (`sail-8.3/app`) that gets built the first time you run `sail up`. No separate `Dockerfile` to maintain.

---

#### Shell alias (add to `~/.bashrc` or `~/.zshrc`)

```bash
alias sail='sh $([ -f sail ] && echo sail || echo vendor/bin/sail)'
```

---

#### First-time setup

```bash
cp .env.example .env

# Start all services (builds images on first run — takes ~2 min)
sail up -d

# Bootstrap
sail artisan key:generate
sail artisan migrate --seed
sail artisan storage:link

# Create the MinIO screenshots bucket
sail exec minio mc alias set local http://localhost:9000 minioadmin minioadmin
sail exec minio mc mb --ignore-existing local/trackflow-screenshots
sail exec minio mc anonymous set none local/trackflow-screenshots
```

---

#### Day-to-day commands

```bash
# Services
sail up -d                        # start all services in background
sail down                         # stop all services
sail down -v                      # ⚠️ stop + destroy all volumes (full reset)

# Artisan
sail artisan migrate
sail artisan migrate:fresh --seed
sail artisan tinker
sail artisan route:list
sail artisan horizon:status

# Composer & NPM (run inside container — no local PHP/Node needed)
sail composer require stripe/stripe-php
sail npm install
sail npm run dev

# Testing
sail artisan test
sail artisan test --parallel
sail artisan test --filter=AuthTest

# Shell access
sail shell                        # bash into the app container
sail root-shell                   # bash as root (for debugging)

# Database
sail psql                         # psql prompt
sail artisan db:seed
```

---

#### `.env` changes for Sail services

Sail uses the service name as the hostname. Make sure these match in `.env`:

```env
DB_CONNECTION=pgsql
DB_HOST=pgsql          # Sail service name, not "postgres" or "localhost"
DB_PORT=5432

REDIS_HOST=redis       # Sail service name
REDIS_PORT=6379

MAIL_HOST=mailpit      # Sail service name
MAIL_PORT=1025

AWS_ENDPOINT=http://minio:9000   # Sail service name
AWS_USE_PATH_STYLE_ENDPOINT=true

REVERB_HOST=localhost  # exposed to browser, not internal service name
REVERB_PORT=8080
REVERB_SCHEME=http
```

---

#### Service URLs (local)

| Service | URL | Credentials |
|---|---|---|
| Laravel API | `http://localhost/api/v1` | — |
| Mailpit UI | `http://localhost:8025` | — |
| MinIO Console | `http://localhost:8900` | `minioadmin / minioadmin` |
| Reverb WebSocket | `ws://localhost:8080` | — |
| PostgreSQL | `localhost:5432` | per `.env` |
| Redis | `localhost:6379` | — |

### 12.2 Full `.env.example`

```env
# App
APP_NAME=TrackFlow
APP_ENV=local
APP_URL=http://localhost
APP_KEY=

# Database
DB_CONNECTION=pgsql
DB_HOST=postgres
DB_PORT=5432
DB_DATABASE=trackflow
DB_USERNAME=trackflow
DB_PASSWORD=secret

# Redis
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=null

# S3 / MinIO (local)
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
AWS_BUCKET=trackflow-screenshots
AWS_REGION=us-east-1
AWS_ENDPOINT=http://minio:9000
AWS_USE_PATH_STYLE_ENDPOINT=true

# CloudFront (production only)
CLOUDFRONT_DOMAIN=
CLOUDFRONT_KEY_PAIR_ID=
CLOUDFRONT_PRIVATE_KEY_PATH=

# Stripe
STRIPE_KEY=
STRIPE_SECRET=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_STARTER_MONTHLY=
STRIPE_PRICE_STARTER_ANNUAL=
STRIPE_PRICE_PRO_MONTHLY=
STRIPE_PRICE_PRO_ANNUAL=

# Laravel Reverb (WebSocket)
REVERB_APP_ID=trackflow
REVERB_APP_KEY=
REVERB_APP_SECRET=
REVERB_HOST=reverb
REVERB_PORT=8080
REVERB_SCHEME=http

# Mail
MAIL_MAILER=smtp
MAIL_HOST=mailpit
MAIL_PORT=1025
MAIL_USERNAME=null
MAIL_PASSWORD=null
MAIL_FROM_ADDRESS=hello@trackflow.io
MAIL_FROM_NAME="TrackFlow"

# Google OAuth (Socialite)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI="${APP_URL}/auth/google/callback"
```

### 12.3 Production Architecture

| Component | Service |
|---|---|
| API | Laravel on **AWS ECS** behind an Application Load Balancer |
| Frontend | Next.js on **Vercel** (or S3 + CloudFront) |
| Database | **AWS RDS PostgreSQL 16** Multi-AZ + read replica for reports |
| Cache / Queue | **ElastiCache Redis** cluster |
| Background workers | Horizon on dedicated ECS task |
| File storage | **S3 private bucket** + CloudFront |
| WebSocket | **Laravel Reverb** behind ALB WebSocket listener |
| Monitoring | Telescope (dev) · Sentry (prod) · UptimeRobot (health) |
| CI/CD | **GitHub Actions** → tests → Docker build → ECR push → ECS rolling deploy |

---

## 13. Security Requirements

| ID | Requirement | Priority | Implementation Notes |
|---|---|---|---|
| `SEC-01` | All API endpoints require authentication. No unauthenticated access except `/auth/*`. | **Must** | Apply `auth:sanctum` middleware. No exceptions outside public auth routes. |
| `SEC-02` | All queries are automatically scoped to `organization_id`. Cross-tenant access is structurally impossible. | **Must** | `GlobalOrganizationScope` on base model + explicit checks in Laravel Policy classes. |
| `SEC-03` | HTTPS only. HTTP redirects to HTTPS. HSTS with 1-year `max-age`. | **Must** | Nginx config + `Strict-Transport-Security` header in middleware. |
| `SEC-04` | Rate limiting: `/auth/*` = 10 req/min per IP. API = 1000 req/min per user. | **Must** | `ThrottleRequests` middleware with Redis driver. |
| `SEC-05` | Screenshots never publicly accessible. Only via signed URLs with 15-min expiry. | **Must** | S3 bucket policy: deny public GetObject. Allow only CloudFront OAI. |
| `SEC-06` | Desktop agent stores credentials in OS keychain only. Never in plain text files or localStorage. | **Must** | `keytar` npm package. Clear all tokens on logout. |
| `SEC-07` | Activity monitoring captures **event counts only**. Never log keystrokes or clipboard content. | **Must** | Agent discards all key content — only increments counter. Document in privacy policy. |
| `SEC-08` | SQL injection prevention: use Eloquent ORM exclusively. No raw SQL with user input. | **Must** | Review every `DB::statement()` and `->whereRaw()` call. |
| `SEC-09` | XSS prevention: all React JSX auto-escapes. Sanitize any HTML with `DOMPurify`. | **Must** | Never use `dangerouslySetInnerHTML` without sanitization. |
| `SEC-10` | Stripe webhook signature verified on every inbound event. | **Must** | `Stripe::constructEvent()` with `STRIPE_WEBHOOK_SECRET`. Return 400 on invalid signature. |
| `SEC-11` | All records soft-deleted. Hard delete on org cancellation after 30-day grace period. | **Should** | Laravel soft deletes throughout. `PruneDeletedDataJob` scheduled after grace period. |

---

## 14. Build Order — Phase by Phase

> **Claude Code instruction:** This is the authoritative build sequence. Each phase depends on the previous. Do not skip phases — the dependency chain is real. Start every Claude Code session by referencing the phase you are currently on.

---

### ✅ Phase 1 — Foundation (Weeks 1–2)

**Goal:** Auth, multi-tenancy, and database working end-to-end.

- [ ] Create Laravel project, install Sail (`composer require laravel/sail --dev`), run `sail:install` selecting pgsql, redis, mailpit, minio
- [ ] Run `sail:publish`, then append `horizon`, `reverb`, and `scheduler` services to `docker-compose.yml` (Section 12.1)
- [ ] Verify all services start cleanly: `sail up -d` — laravel.test, pgsql, redis, mailpit, minio, horizon, reverb, scheduler
- [ ] Create MinIO `trackflow-screenshots` bucket and set private policy (Section 12.1 first-time setup)
- [ ] Create `.env.example` with all required variables
- [ ] Write all database migrations in dependency order (Section 2.1)
- [ ] Implement `GlobalOrganizationScope` base model
- [ ] `AUTH-01` → `AUTH-10`: Registration, login, refresh, logout, RBAC, invitations
- [ ] Laravel Policy classes for each role
- [ ] Unit tests: auth flows, role enforcement, cross-tenant isolation

---

### ✅ Phase 2 — Core Time Tracking (Weeks 3–4)

**Goal:** Timer works, web dashboard loads, employees can track time.

- [ ] `TIME-01` → `TIME-11`: All timer + timesheet endpoints
- [ ] Redis timer state with `DB::transaction` sync
- [ ] `JOB-08`: Email notification infrastructure (SES + Mailpit local)
- [ ] `DASH-01` + `DASH-02`: Dashboard endpoint + WebSocket broadcasting
- [ ] Next.js project: App Router, Zustand, TanStack Query, shadcn/ui, Axios instance
- [ ] `UI-01`: Auth pages (login, register, forgot password)
- [ ] `UI-03`: Time entries page with inline timer widget

---

### ✅ Phase 3 — Desktop Agent (Weeks 5–6)

**Goal:** Agent installs, tracks activity, and syncs with API.

- [ ] Electron project scaffold with electron-builder configs for Win + Mac
- [ ] `AGENT-01`: Tray app with mini popup UI
- [ ] `AGENT-03`: Activity monitoring — uiohook-napi, keyboard + mouse counts
- [ ] `AGENT-04`: Active app name tracking (AppleScript / Win32)
- [ ] `AGENT-06`: Offline SQLite queue with better-sqlite3
- [ ] `AGENT-07` + `AGENT-08`: Auto-start + auto-update (electron-updater)
- [ ] `AGENT-10`: Keychain credential storage (keytar)
- [ ] Integration test: agent heartbeat → API → Redis → dashboard

---

### ✅ Phase 4 — Screenshots & Media (Week 7)

**Goal:** Screenshots captured, stored securely, viewable by managers.

- [ ] `SS-01` → `SS-05`: Upload, S3 storage, processing, signed URLs
- [ ] `AGENT-02`: Screenshot capture in desktop agent (desktopCapturer)
- [ ] `AGENT-09`: Blur option (sharp)
- [ ] `JOB-01`: ProcessScreenshotJob
- [ ] CloudFront signed cookie issuance
- [ ] `UI-04`: Screenshot gallery in web dashboard

---

### ✅ Phase 5 — Reports & Analytics (Weeks 8–9)

**Goal:** Managers can generate and export meaningful reports.

- [ ] `REPT-01` → `REPT-08`: All report endpoints with Redis caching
- [ ] `JOB-03`: GenerateReportJob — PDF (barryvdh/laravel-dompdf) + CSV
- [ ] `UI-05`: Report builder page with Recharts visualizations
- [ ] `UI-02`: Live dashboard with real-time WebSocket activity feed
- [ ] `DASH-03`: Low activity alert job

---

### ✅ Phase 6 — Billing (Week 10)

**Goal:** Organizations can subscribe, pay, and be blocked when limits are exceeded.

- [ ] `BILL-01` → `BILL-07`: Stripe integration, plans, webhooks, seat enforcement
- [ ] Trial enforcement: block actions past 14 days without active subscription
- [ ] `UI-09`: Billing settings page with Stripe Customer Portal link
- [ ] Upgrade prompt components throughout UI (403/402 responses → modal)
- [ ] Webhook handler with signature verification + idempotency

---

### ✅ Phase 7 — Polish & Hardening (Weeks 11–12)

**Goal:** Production-ready, all security hardened, CI/CD live.

- [ ] `UI-06` → `UI-10`: Team management, projects, all settings pages
- [ ] `JOB-04` → `JOB-07`: Remaining background jobs (reminders, Stripe sync, pruning, bulk flush)
- [ ] `SEC-01` → `SEC-11`: Full security pass — all middleware, policies, rate limits, HTTPS
- [ ] Redis caching on all report endpoints (15-min TTL)
- [ ] GitHub Actions CI/CD pipeline: test → build → push ECR → deploy ECS
- [ ] Playwright E2E tests for critical flows: register → invite → timer → screenshot → report → billing

---

*End of Plan — TrackFlow SRS v1.0 — CodeUpscale · March 2026*

---

## 15. Agentic Development Architecture

> This section defines how **Claude Code operates as a fully autonomous development agent** on TrackFlow. Rather than answering one question at a time, Claude Code runs multi-step loops — plan → implement → test → verify → iterate — without human intervention between steps. Each sub-agent below has a defined scope, entry prompt, tool permissions, and self-verification checklist.

---

### 15.1 Agentic Loop Overview

```
┌─────────────────────────────────────────────────────────────┐
│                   CLAUDE CODE AGENT LOOP                    │
│                                                             │
│  1. READ  →  Ingest this plan + relevant section           │
│  2. PLAN  →  Break scope into atomic tasks                 │
│  3. CODE  →  Implement task (files, migrations, tests)     │
│  4. TEST  →  Run sail artisan test + lint + type checks    │
│  5. FIX   →  If failures: diagnose → patch → retest       │
│  6. MARK  →  Check off task in plan, commit message        │
│  7. NEXT  →  Move to next task in phase                    │
└─────────────────────────────────────────────────────────────┘
```

**Key principle:** Claude Code never moves to the next task while the current task has failing tests. The loop at step 5 repeats until green or a human escalation is explicitly needed.

---

### 15.2 Master Agent — Session Entry Prompt

Paste this at the start of every Claude Code session to orient the agent:

```
You are the lead developer on TrackFlow, a multi-tenant workforce monitoring SaaS.
The full spec lives in TrackFlow_Plan.md. Your job is to implement tasks autonomously,
writing code AND tests together, then running tests to verify before moving on.

Rules:
1. Never write code without a corresponding test.
2. Run `sail artisan test` after every implementation step. Do not proceed if tests fail.
3. Use Pest PHP for all backend tests. Playwright for E2E tests.
4. Always scope database queries to organization_id via GlobalOrganizationScope.
5. All endpoints must have Feature tests covering: success case, auth failure (401),
   wrong role (403), wrong org (404 or 403), and validation failure (422).
6. After completing a phase, output a summary of: files created, tests written,
   test coverage %, and any deferred items.

Current phase: [PHASE NUMBER AND NAME]
Start by reading the relevant section of TrackFlow_Plan.md and listing the atomic
tasks you will complete, in order, before writing any code.
```

---

### 15.3 Sub-Agent Definitions

Each sub-agent handles one domain. Claude Code spawns these sequentially per phase. Each has its own entry context, tool set, and done criteria.

---

#### Agent 1 — Migration Agent

**Scope:** Generate all database migrations in dependency order, run them, verify schema.

**Entry prompt:**
```
Read Section 2 (Database Schema) of TrackFlow_Plan.md.
Generate Laravel migrations for ALL tables in the order listed in Section 2.1.
For each migration:
  - Use UUID primary keys via $table->uuid('id')->primary()
  - Add organization_id UUID foreign key on every table except organizations and users
  - Add softDeletes() on time_entries, screenshots, users
  - Add appropriate indexes (see query patterns in Sections 4 and 7)
After generating all migrations, run: sail artisan migrate:fresh
Then run: sail artisan db:show --counts
Verify all tables exist and column counts match the schema. Fix any errors before proceeding.
```

**Done criteria:**
- [ ] `sail artisan migrate:fresh` exits 0
- [ ] `sail artisan db:show` lists all 17 tables
- [ ] No orphaned foreign keys
- [ ] `activity_logs` monthly partition created for current month

---

#### Agent 2 — Model & Scope Agent

**Scope:** Eloquent models, GlobalOrganizationScope, relationships, factories.

**Entry prompt:**
```
Read Section 2 of TrackFlow_Plan.md.
For every table, create:
  1. An Eloquent model in app/Models/ with correct $fillable, $casts, and relationships
  2. A ModelFactory in database/factories/ with realistic fake data
  3. Apply GlobalOrganizationScope to every model except Organization and User

The GlobalOrganizationScope must:
  - Read organization_id from Auth::user()->organization_id
  - Auto-apply WHERE organization_id = ? to all queries
  - Be bypassable via ->withoutGlobalScope(GlobalOrganizationScope::class)

After creating all models and factories, write and run a unit test suite:
  - Verify GlobalOrganizationScope prevents cross-tenant data leakage
  - Verify all relationships return correct related models
  - Verify factories produce valid model instances

Run: sail artisan test --filter=ModelTest
All tests must pass before proceeding.
```

**Done criteria:**
- [ ] All 14 models created with relationships
- [ ] All factories created with `definition()` methods using Faker
- [ ] `GlobalOrganizationScope` unit tests pass (cross-tenant isolation verified)
- [ ] 100% of model relationship tests green

---

#### Agent 3 — Auth Agent

**Scope:** AUTH-01 through AUTH-10 — endpoints, middleware, RBAC policies.

**Entry prompt:**
```
Read Section 3 of TrackFlow_Plan.md.
Implement AUTH-01 through AUTH-10 in this order:
  1. AuthController (register, login, refresh, logout, me)
  2. Laravel Sanctum token configuration with organization_id in token abilities
  3. Password reset (forgot, reset)
  4. RoleMiddleware class checking $user->role against allowed roles
  5. Laravel Policies for each model (TimeEntryPolicy, ScreenshotPolicy, etc.)
  6. InvitationController (create, accept)
  7. Google OAuth via Laravel Socialite (AUTH-08)

For EVERY endpoint, write a Feature test class covering:
  - 200/201 success case with correct response structure
  - 401 when unauthenticated
  - 403 when wrong role
  - 422 with validation errors
  - Cross-tenant: verify user from org A cannot access org B data

Test class naming: tests/Feature/Auth/{EndpointName}Test.php

Run: sail artisan test tests/Feature/Auth
Fix all failures before outputting done summary.
```

**Done criteria:**
- [ ] All 10 auth endpoints implemented
- [ ] RBAC permission matrix from Section 3.1 enforced in policy classes
- [ ] Feature tests: minimum 50 test cases across Auth suite
- [ ] Zero cross-tenant leakage in tests
- [ ] `sail artisan route:list` shows all auth routes

---

#### Agent 4 — Time Tracking Agent

**Scope:** TIME-01 through TIME-11, heartbeat endpoint, Redis timer state.

**Entry prompt:**
```
Read Section 4 of TrackFlow_Plan.md.
Implement the time tracking service in this order:
  1. TimerService class — encapsulates start/stop/pause logic, syncs Redis + DB atomically
     using DB::transaction + Redis::set/del
  2. TimeEntryController — all CRUD endpoints
  3. TimerController — start, stop, pause, status, heartbeat endpoints
  4. TimesheetController — submit and review endpoints
  5. ActivityLog creation inside heartbeat endpoint

Redis timer key contract:
  Key: timer:{user_id}
  Value: JSON {entry_id, started_at, project_id, task_id}
  TTL: 30 days

For the TimerService, write unit tests mocking Redis and DB.
For all endpoints, write Feature tests covering the full RBAC matrix.
Specifically test the atomic sync: simulate a DB failure mid-transaction and verify
Redis is NOT updated (or is rolled back).

Also write a test that:
  - Starts a timer
  - Sends 5 heartbeats with activity data
  - Verifies activity_score is updated on the time_entry
  - Verifies activity_logs rows were created

Run: sail artisan test tests/Feature/Timer tests/Unit/TimerServiceTest
All tests must pass.
```

**Done criteria:**
- [ ] `TimerService` with Redis+DB atomic sync
- [ ] All 11 TIME endpoints + heartbeat endpoint
- [ ] Feature tests cover all RBAC combinations
- [ ] Redis-DB consistency test passing
- [ ] Idle detection logic tested (mock: no heartbeat for N minutes → entry paused)

---

#### Agent 5 — Screenshot Agent

**Scope:** SS-01 through SS-05, S3 upload pipeline, ProcessScreenshotJob.

**Entry prompt:**
```
Read Section 6 of TrackFlow_Plan.md.
Implement the screenshot service:
  1. ScreenshotController — upload and list endpoints
     - Validate JPEG, max 5MB
     - Store to S3 using key format: {org_id}/{user_id}/{YYYY-MM-DD}/{epoch}.jpg
     - Use Laravel Filesystem with s3 driver (MinIO locally)
  2. ProcessScreenshotJob — resize to 1280px max width using Intervention Image,
     re-upload processed version, delete the raw original
  3. Signed URL generation — generate CloudFront/S3 pre-signed URLs with 15-min expiry
     on every GET /screenshots response
  4. Blur middleware — if org.settings.blur_screenshots = true, apply Gaussian blur
     before the processed upload

Write tests using Storage::fake('s3'):
  - Upload a real JPEG fixture and assert it lands in the correct S3 key path
  - Assert ProcessScreenshotJob is dispatched after upload
  - Assert signed URL is present in GET response
  - Assert employees cannot see other users' screenshots
  - Test blur: upload with blur=true setting, assert blurred flag in DB

Run: sail artisan test tests/Feature/Screenshot
```

**Done criteria:**
- [ ] S3 upload with correct key structure
- [ ] `ProcessScreenshotJob` resizes and replaces original
- [ ] Signed URL in every GET response
- [ ] `Storage::fake` tests all green
- [ ] Blur flag tested

---

#### Agent 6 — Reporting Agent

**Scope:** REPT-01 through REPT-08, Redis report caching, GenerateReportJob.

**Entry prompt:**
```
Read Section 7 of TrackFlow_Plan.md.
Implement all 8 report endpoints inside a ReportService class.
Each report method must:
  1. Check Redis cache first: Cache::remember("report:{org}:{type}:{period}:{user}", 900, fn)
  2. Query the READ-ONLY DB connection (configure 'pgsql_read' connection in database.php
     pointing to the same DB locally, to be pointed at the read replica in production)
  3. Return typed DTO arrays, not raw Eloquent collections

Also implement:
  - GenerateReportJob: accepts report params, generates PDF via barryvdh/laravel-dompdf
    and CSV via League\Csv, stores in S3, updates a job_status record, broadcasts
    ReportReady WebSocket event
  - JobStatusController: GET /api/v1/jobs/{id} — returns status + download URL when done

Tests to write:
  - Unit test ReportService methods with seeded DB data — assert exact totals
  - Test cache: call report twice, assert DB query only fires once (use DB::getQueryLog())
  - Feature test: POST /reports/export → assert job dispatched → run job synchronously
    → assert S3 file exists → assert GET /jobs/{id} returns download URL
  - Assert employees only see their own data in summary reports

Run: sail artisan test tests/Feature/Reports tests/Unit/ReportServiceTest
```

**Done criteria:**
- [ ] All 8 report endpoints returning correct aggregated data
- [ ] Redis caching verified via query log assertion
- [ ] PDF + CSV generation tested with real output
- [ ] Job status polling tested end-to-end

---

#### Agent 7 — Billing Agent

**Scope:** BILL-01 through BILL-07, Stripe webhooks, seat enforcement.

**Entry prompt:**
```
Read Section 8 of TrackFlow_Plan.md.
Implement Stripe billing:
  1. BillingController — subscribe, change-plan, cancel, invoices, usage endpoints
  2. StripeWebhookController — handle all 4 webhook event types with signature verification
  3. BillingService — wraps Stripe SDK, all calls use idempotency keys
  4. SeatEnforcementMiddleware — applied to POST /invitations and POST /users,
     returns 402 JSON with {error, current_seats, limit, upgrade_url} when over limit
  5. SubscriptionObserver — on subscription deletion, set org.plan = 'trial',
     set trial_ends_at = now() + 30 days (grace period)

Use Stripe's test mode. Set STRIPE_KEY and STRIPE_SECRET to test keys in .env.testing.

Tests to write:
  - Mock Stripe SDK using Mockery — test BillingService methods without hitting API
  - Webhook test: construct a fake Stripe webhook payload, sign it with
    STRIPE_WEBHOOK_SECRET, POST to /webhooks/stripe, assert org.plan updated
  - Seat enforcement: seed org at plan limit, attempt POST /invitations,
    assert 402 with correct error body
  - Test cancel flow: assert cancel_at_period_end set on Stripe subscription mock

Run: sail artisan test tests/Feature/Billing tests/Unit/BillingServiceTest
```

**Done criteria:**
- [ ] All Stripe API calls mocked — no real Stripe calls in tests
- [ ] Webhook signature verification tested (valid + invalid signature cases)
- [ ] Seat enforcement returns 402 at the correct threshold for each plan
- [ ] All 7 billing requirements implemented

---

#### Agent 8 — Background Jobs Agent

**Scope:** JOB-01 through JOB-08, Horizon configuration, scheduler registration.

**Entry prompt:**
```
Read Section 11 of TrackFlow_Plan.md.
Implement all 8 jobs and configure Horizon:
  1. Create each Job class in app/Jobs/ implementing ShouldQueue
  2. Mark JOB-04 and JOB-05 with ShouldBeUnique
  3. Configure config/horizon.php with four named queues:
     critical (1 worker), high (3 workers), default (2 workers), low (1 worker)
  4. Register scheduled jobs in routes/console.php (Laravel 11 style):
     - JOB-04: every Friday at 16:00 in each user's timezone
     - JOB-05: hourly
     - JOB-06: daily at 02:00 UTC
  5. Ensure every job has a failed() method that logs to a job_failures table

Tests to write:
  - Dispatch each job synchronously (Bus::dispatchSync) and assert side effects
  - JOB-01: assert S3 has processed file, raw file deleted
  - JOB-02: assert WebSocket event broadcast + email queued
  - JOB-03: assert S3 PDF exists + job_status record updated to 'complete'
  - JOB-06: seed 200 activity_logs older than retention period, run job,
    assert all deleted, assert recent logs untouched
  - Assert ShouldBeUnique prevents duplicate JOB-04 jobs for same org+week

Run: sail artisan test tests/Unit/Jobs
```

**Done criteria:**
- [ ] All 8 jobs implemented and tested
- [ ] Horizon config with 4 named queues
- [ ] Scheduler entries registered with correct frequencies
- [ ] `failed()` handlers on all jobs
- [ ] Unique job constraint tested

---

#### Agent 9 — Security Hardening Agent

**Scope:** SEC-01 through SEC-11 — middleware, policies, rate limiting, headers.

**Entry prompt:**
```
Read Section 13 of TrackFlow_Plan.md.
Implement all 11 security requirements as a hardening pass over the existing codebase:

  SEC-01: Audit all routes in routes/api.php — every route must be inside
          Route::middleware(['auth:sanctum']) group. Write a test that
          calls every route without a token and asserts 401.

  SEC-02: Write a cross-tenant penetration test: create two orgs (A and B),
          authenticate as org A user, attempt to access every resource type
          belonging to org B. Assert 404 or 403 on all attempts.

  SEC-03: Add ForceHttps middleware — redirect HTTP to HTTPS in production.
          Add HSTS header: Strict-Transport-Security: max-age=31536000

  SEC-04: Configure ThrottleRequests middleware in bootstrap/app.php:
          auth/* routes: 10/min per IP, api/* routes: 1000/min per user.
          Write a test that fires 11 rapid requests to /auth/login and
          asserts the 11th returns 429.

  SEC-05: Write a test that fetches a screenshot URL from the API,
          then attempts to access the raw S3 URL directly — assert 403.

  SEC-06: Verify no plain-text credentials exist anywhere in the codebase.
          Run: grep -r "password\|secret\|key" --include="*.php" app/ | grep -v test

  SEC-07: Write a unit test for the desktop agent heartbeat endpoint proving
          that the request body is never written to logs
          (assert Log::shouldNotReceive any key content).

  SEC-08: Run static analysis: sail composer require --dev larastan/larastan
          Run: sail exec laravel.test ./vendor/bin/phpstan analyse --level=6
          Fix all errors before proceeding.

  SEC-09: Install and configure CORS: sail artisan config:publish cors
          Whitelist only the Next.js dashboard origin.

  SEC-10: Write a webhook test with an INVALID signature and assert 400 response.

  SEC-11: Write a test: delete an org, assert all its records are soft-deleted
          (deleted_at set), then run the pruning job after 30 days,
          assert hard deletion.

Run: sail artisan test tests/Feature/Security tests/Feature/CrossTenant
     sail exec laravel.test ./vendor/bin/phpstan analyse --level=6
All must pass with zero errors.
```

**Done criteria:**
- [ ] Every route returns 401 when unauthenticated
- [ ] Cross-tenant penetration test suite: 0 data leaks
- [ ] Rate limiter returns 429 at correct thresholds
- [ ] PHPStan level 6 passes with 0 errors
- [ ] CORS whitelist configured

---

#### Agent 10 — Non-Functional Requirements Agent

**Scope:** Performance, reliability, observability — the NFRs not covered by functional agents.

**Entry prompt:**
```
Read Sections 9.2 and 13 of TrackFlow_Plan.md, then implement these
non-functional requirements across the codebase:

PERFORMANCE
  - Add DB indexes for all high-frequency query patterns:
      (organization_id, user_id, started_at DESC) on time_entries
      (organization_id, user_id, captured_at DESC) on screenshots
      (organization_id, logged_at DESC) on activity_logs
  - Add Redis caching (15-min TTL) to all GET /reports/* endpoints
  - Write a performance test: seed 10,000 time_entries for one org,
    call GET /reports/summary, assert response time < 500ms
    (use Laravel's $this->assertResponseTime() or Benchmark::measure())

RELIABILITY
  - All jobs must retry on failure with exponential backoff:
    public function backoff(): array { return [60, 300, 900]; }
  - Add circuit breaker pattern to Stripe calls: if 3 consecutive Stripe
    API failures in 1 minute, log a critical alert and stop retrying
  - Write a test: simulate S3 unavailability (Storage::shouldReceive('put')->andThrow()),
    assert ProcessScreenshotJob fails gracefully and lands in failed_jobs table

OBSERVABILITY
  - Install Laravel Telescope for local dev:
    sail composer require laravel/telescope --dev
    sail artisan telescope:install
  - Add structured logging to all service classes using Log::channel('stack')
    with context arrays: ['org_id' => ..., 'user_id' => ..., 'action' => ...]
  - Add a GET /api/v1/health endpoint (no auth required) returning:
    {status: ok|degraded, db: ok|error, redis: ok|error, queue: ok|error}
    where each check actually pings the service
  - Write a test for the health endpoint covering the degraded state
    (mock DB::connection() to throw an exception)

API CONTRACTS
  - Install Scramble for auto-generated OpenAPI docs:
    sail composer require dedoc/scramble
  - Ensure every request class has proper validation rules and
    ->bodyParameters() documentation
  - Run: sail artisan scramble:export
    Assert the exported spec covers all routes in routes/api.php

Run: sail artisan test tests/Feature/Health tests/Performance
     sail artisan scramble:export (assert 0 undocumented routes)
```

**Done criteria:**
- [ ] All 3 DB indexes added
- [ ] Performance test: 10k rows, summary report < 500ms
- [ ] All jobs have exponential backoff
- [ ] `/health` endpoint tested in degraded state
- [ ] OpenAPI spec exported with 0 undocumented routes
- [ ] Telescope installed in dev

---

#### Agent 11 — E2E Test Agent

**Scope:** Playwright end-to-end tests covering all critical user journeys.

**Entry prompt:**
```
The Next.js dashboard is running at http://localhost:3000 and the Laravel API
at http://localhost:80. The Sail environment is up.

Install Playwright in the web/ workspace:
  cd web && npx playwright install --with-deps

Create tests in web/tests/e2e/ covering these full user journeys:

JOURNEY 1 — Onboarding (tests/e2e/onboarding.spec.ts)
  1. Register a new organization (owner)
  2. Assert dashboard loads with trial banner
  3. Invite a manager via email (intercept mailpit API to get invite link)
  4. Accept invite as manager, complete registration
  5. Invite an employee
  6. Assert team page shows 3 members

JOURNEY 2 — Time Tracking (tests/e2e/timer.spec.ts)
  1. Login as employee
  2. Select project "Website Redesign", start timer
  3. Wait 3 seconds, stop timer
  4. Assert time entry appears in /time with correct project and duration > 0
  5. Login as manager, assert employee's entry is visible in team view
  6. Approve the time entry, assert status changes to "Approved"

JOURNEY 3 — Screenshots (tests/e2e/screenshots.spec.ts)
  1. Simulate screenshot upload via API (POST /api/v1/screenshots with a test JPEG)
  2. Login as manager, navigate to /screenshots
  3. Assert screenshot thumbnail appears in gallery
  4. Assert employee cannot see other employee's screenshots (login as different employee)

JOURNEY 4 — Reports (tests/e2e/reports.spec.ts)
  1. Seed 1 week of time entries via API
  2. Login as manager, navigate to /reports
  3. Select "Team Summary", last 7 days, click Generate
  4. Assert chart renders with data
  5. Click Export CSV, assert file download triggered

JOURNEY 5 — Billing (tests/e2e/billing.spec.ts)
  1. Login as owner
  2. Navigate to /settings/billing
  3. Assert trial banner and seat usage meter visible
  4. Assert upgrade button visible when at seat limit
  5. Assert invoice list empty on trial

For each journey, use page.route() to mock Stripe API calls.
Assert no console errors on any page.

Run: npx playwright test --reporter=html
Open report: npx playwright show-report
All tests must pass before marking E2E agent complete.
```

**Done criteria:**
- [ ] 5 user journeys, minimum 25 test steps total
- [ ] Mailpit API used for email link extraction
- [ ] No Playwright test skipped or flaky (run 3 times, all green)
- [ ] HTML report generated and saved to `web/playwright-report/`

---

### 15.4 Test Coverage Targets

| Layer | Tool | Target |
|---|---|---|
| Unit tests (Services, Jobs, Scopes) | Pest PHP | ≥ 90% line coverage |
| Feature tests (API endpoints) | Pest PHP | 100% of endpoints, all RBAC cases |
| Cross-tenant isolation | Pest PHP | 100% — zero leakage allowed |
| Static analysis | PHPStan level 6 | 0 errors |
| E2E user journeys | Playwright | 5 journeys, all green |
| Performance | Laravel Benchmark | Summary report < 500ms @ 10k rows |
| API documentation | Scramble | 0 undocumented routes |

Run the full suite at any time:

```bash
# Backend: all tests + static analysis
sail artisan test --parallel --coverage --min=90
sail exec laravel.test ./vendor/bin/phpstan analyse --level=6

# E2E
cd web && npx playwright test

# Coverage HTML report
sail artisan test --coverage-html coverage/
open coverage/index.html
```

---

### 15.5 Claude Code Session Templates

#### Template A — Start a new phase

```
I am working on TrackFlow (TrackFlow_Plan.md).
Starting Phase [N] — [Name].

Before writing any code:
1. List all tasks in this phase as a numbered checklist.
2. For each task, state: files to create, tests to write, done criteria.
3. Ask me to confirm the task list before proceeding.

Then work through tasks one by one. After each task:
- Run the relevant test suite
- Show me the test output (pass/fail counts)
- Only proceed to the next task when tests are green
```

#### Template B — Continue an in-progress phase

```
I am continuing TrackFlow Phase [N].
Completed tasks so far: [list]
Next task: [task name and ID from plan]

Pick up from where we left off. Run `sail artisan test` first to confirm
the existing suite is still green, then proceed with the next task.
```

#### Template C — Fix a failing test

```
This test is failing in TrackFlow:

[paste test name + error output]

Relevant source file: [file path]
Relevant spec section: [Section X.X from TrackFlow_Plan.md]

Diagnose the root cause, fix the implementation (not the test),
and run `sail artisan test --filter=[TestName]` to verify the fix.
Do not change the test assertions unless the spec itself has changed.
```

#### Template D — Security audit pass

```
Run a security audit on TrackFlow's codebase for Section 13 (SEC-01 → SEC-11).
For each security requirement:
1. State whether it is currently implemented
2. If not: implement it
3. Write or update the test that proves it works
4. Run the test

Output a table: | Req ID | Status | Test file | Pass/Fail |
```

#### Template E — Agentic full-phase autonomous run

```
Run Phase [N] of TrackFlow fully autonomously.
Use TrackFlow_Plan.md Section 14 as your task list.
Do not ask for confirmation between tasks.
If a test fails more than 3 times after fixing attempts, stop and report the blocker.
At the end, output:
  - Files created (list)
  - Tests written (count)
  - Test coverage % (from sail artisan test --coverage)
  - Any deferred items with reason
```

---

### 15.6 Agentic Guardrails

These rules prevent the agent from going off-track during autonomous runs:

| Rule | Detail |
|---|---|
| **Test-first on new endpoints** | Write the Feature test skeleton before writing the Controller. Run it (it will fail). Then implement until it passes. |
| **Never delete a passing test** | If a refactor breaks an existing test, fix the implementation, not the test. |
| **Never skip the GlobalScope** | Every new Eloquent query must be verified to include `organization_id`. Failing this is a blocker — stop and fix. |
| **Commit after each passing task** | `git commit -m "feat(AUTH-01): register endpoint with org creation [tests: 8 passing]"` |
| **Stop on 3 consecutive failures** | If a test fails on 3 fix attempts, emit a `BLOCKER:` comment and pause for human review. |
| **No commented-out code** | Remove, don't comment. If uncertain, delete and rely on git history. |
| **Schema changes need migrations** | Never hand-edit a migration after it has been run. Create a new one. |