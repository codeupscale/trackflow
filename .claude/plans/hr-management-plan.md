# TrackFlow HR Management -- Implementation Plan

## Executive Summary

TrackFlow is a mature workforce time tracking and monitoring platform with strong foundations in timer/activity/screenshot capture, project management, team hierarchy, shift scheduling, timesheet approval, and attendance/payroll reporting. It is well-positioned to expand into a full HR management suite because the hardest part -- reliable, trusted employee activity data -- is already built.

This plan outlines 12 HR modules, prioritized by market demand, integration leverage with existing time tracking data, and implementation effort. The strategy is to build outward from what already exists: attendance data flows into leave management, leave balances feed payroll, payroll connects to employee records, and so on. Each module is scoped with database schema, API endpoints, frontend pages, key workflows, and acceptance criteria specific enough for engineers to begin implementation immediately.

**Key principle:** Every new table gets `organization_id` with a foreign key constraint and the `BelongsToOrganization` trait. No exceptions. Multi-tenancy is non-negotiable.

**Estimated total effort:** 6-8 months for a team of 2 backend + 1 frontend engineer working full-time.

---

## Current State Inventory

### What Exists Today

| Area | Assets | Maturity |
|---|---|---|
| **User Management** | Users with roles (owner/admin/manager/employee), invitation system, profile fields (job_title, phone, date_of_birth, date_of_joining, bio, linkedin, github), avatar, timezone, SSO (SAML2 + Google OAuth) | Solid |
| **Organization** | Multi-tenant with UUID PKs, org-level settings (JSON), Stripe billing, plans, SSO config, data retention config | Solid |
| **Teams** | Teams with manager, many-to-many user membership | Basic (flat, no departments) |
| **Projects** | Projects with billable flag, hourly rate, member assignment, tasks, archiving | Solid |
| **Time Tracking** | Timer (start/stop/pause/switch), time entries with approval workflow, heartbeats, idle detection, activity scoring | Production-grade |
| **Timesheets** | Weekly submission with manager review (approve/reject) | Basic |
| **Screenshots** | Capture, upload, blur, thumbnails, app metadata | Solid |
| **Activity Monitoring** | Keyboard/mouse activity %, app name tracking, per-heartbeat logging | Solid |
| **Shifts** | Shift definitions (name, start/end time, days_of_week), user-shift assignment with effective dates | Basic (no overtime, no attendance integration) |
| **Reporting** | Summary, team, projects, apps, timeline, payroll (hours * rate), attendance (first/last seen, total hours per day), CSV/PDF export | Functional |
| **Billing** | Stripe subscription, per-seat, plan management, invoices | Solid |
| **Enterprise** | Audit logs, SSO/SAML, data privacy/GDPR, permission overrides, API keys | Solid |

### What Does NOT Exist

- Leave types, balances, requests, approvals, calendar
- Salary structures, pay components, payslips, deductions, tax
- Overtime rules, regularization, late/early tracking
- Onboarding checklists, document collection, probation management
- Performance reviews, OKRs, goals, feedback, PIPs
- Job postings, applicant tracking, interview pipeline
- Employee document storage, expiry alerts, letter templates
- Offboarding checklists, final settlement, exit interviews
- Benefits enrollment, dependents, compensation statements
- Compliance/statutory reports, policy acknowledgments
- HR announcements, helpdesk tickets
- Departments, org chart, positions, reporting lines

---

## Module Implementation Plan

---

### Module 1: Leave Management

**Status:** Not Started
**Priority:** P0 -- most requested HR feature across every competitor; direct integration with existing attendance data
**Effort:** L (3-4 weeks)
**Dependencies:** None (can build standalone on existing users/teams/org)

#### What Exists Today

Nothing. There is no concept of leave in the system. The attendance report (`ReportService::attendance`) shows first_seen/last_seen per day but has no way to distinguish "absent" from "on leave" from "didn't track time."

#### Database Schema Needed

```sql
-- Leave type definitions per org (e.g., Annual, Sick, Casual, Parental)
CREATE TABLE leave_types (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,           -- "Annual Leave"
    code VARCHAR(20) NOT NULL,            -- "AL"
    color VARCHAR(7) DEFAULT '#3B82F6',   -- hex for calendar display
    is_paid BOOLEAN DEFAULT TRUE,
    requires_approval BOOLEAN DEFAULT TRUE,
    max_consecutive_days INTEGER,          -- NULL = no limit
    requires_document BOOLEAN DEFAULT FALSE, -- e.g., medical cert for sick leave > 2 days
    document_required_after_days INTEGER,   -- require doc after N consecutive days
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    UNIQUE(organization_id, code)
);

-- Leave policy: how many days per year per leave type, per role or per user
CREATE TABLE leave_policies (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    leave_type_id UUID NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,            -- "Standard Annual Leave Policy"
    days_per_year DECIMAL(5,1) NOT NULL,   -- 20.0 days
    accrual_type VARCHAR(20) DEFAULT 'yearly', -- yearly | monthly | none
    carry_forward_max DECIMAL(5,1) DEFAULT 0,  -- max days to carry to next year
    carry_forward_expiry_months INTEGER,    -- carried days expire after N months
    proration_type VARCHAR(20) DEFAULT 'calendar', -- calendar | joining_date
    applicable_after_days INTEGER DEFAULT 0, -- probation: can't use leave until N days after joining
    applies_to_roles JSON,                 -- NULL = all roles, or ["employee","manager"]
    is_default BOOLEAN DEFAULT FALSE,      -- auto-assign to new employees
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Individual leave balances (denormalized for performance)
CREATE TABLE leave_balances (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    leave_type_id UUID NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
    leave_policy_id UUID NOT NULL REFERENCES leave_policies(id),
    year INTEGER NOT NULL,                 -- 2026
    entitled_days DECIMAL(5,1) NOT NULL,   -- total entitlement
    used_days DECIMAL(5,1) DEFAULT 0,
    pending_days DECIMAL(5,1) DEFAULT 0,   -- requested but not approved
    carried_forward_days DECIMAL(5,1) DEFAULT 0,
    adjustment_days DECIMAL(5,1) DEFAULT 0, -- manual admin adjustments
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    UNIQUE(organization_id, user_id, leave_type_id, year)
);

-- Leave requests
CREATE TABLE leave_requests (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    leave_type_id UUID NOT NULL REFERENCES leave_types(id),
    leave_balance_id UUID NOT NULL REFERENCES leave_balances(id),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    start_half VARCHAR(10) DEFAULT 'full', -- full | first_half | second_half
    end_half VARCHAR(10) DEFAULT 'full',
    total_days DECIMAL(5,1) NOT NULL,      -- computed: accounts for half-days, weekends, holidays
    reason TEXT,
    status VARCHAR(20) DEFAULT 'pending',  -- pending | approved | rejected | cancelled
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP,
    reviewer_notes TEXT,
    cancelled_at TIMESTAMP,
    document_path VARCHAR(500),            -- S3 path for supporting documents
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Organization holidays (excluded from leave day calculation)
CREATE TABLE holidays (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    date DATE NOT NULL,
    is_optional BOOLEAN DEFAULT FALSE,     -- optional holidays from a pool
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    UNIQUE(organization_id, date)
);

-- Leave policy assignment to users (many-to-many)
CREATE TABLE leave_policy_user (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    leave_policy_id UUID NOT NULL REFERENCES leave_policies(id) ON DELETE CASCADE,
    created_at TIMESTAMP,
    UNIQUE(organization_id, user_id, leave_policy_id)
);
```

#### API Endpoints Needed

```
# Leave Types (admin)
GET    /api/v1/leave-types                    -- list all active leave types
POST   /api/v1/leave-types                    -- create leave type
PUT    /api/v1/leave-types/{id}               -- update leave type
DELETE /api/v1/leave-types/{id}               -- soft-deactivate

# Leave Policies (admin)
GET    /api/v1/leave-policies                 -- list policies
POST   /api/v1/leave-policies                 -- create policy
PUT    /api/v1/leave-policies/{id}            -- update policy
POST   /api/v1/leave-policies/{id}/assign     -- assign to users/roles

# Leave Balances
GET    /api/v1/leave-balances                 -- my balances (employee) or all (admin)
GET    /api/v1/leave-balances/user/{userId}   -- specific user's balances (manager/admin)
POST   /api/v1/leave-balances/adjust          -- manual adjustment (admin only)
POST   /api/v1/leave-balances/year-end-process -- carry forward + reset (admin only)

# Leave Requests
GET    /api/v1/leave-requests                 -- list (filtered by status, date range, user)
POST   /api/v1/leave-requests                 -- apply for leave
GET    /api/v1/leave-requests/{id}            -- view details
PUT    /api/v1/leave-requests/{id}            -- update (only if pending)
POST   /api/v1/leave-requests/{id}/approve    -- approve (manager/admin)
POST   /api/v1/leave-requests/{id}/reject     -- reject with reason
POST   /api/v1/leave-requests/{id}/cancel     -- cancel own request
GET    /api/v1/leave-requests/pending         -- pending approvals for manager
GET    /api/v1/leave-requests/calendar        -- calendar view (team leave overlay)

# Holidays
GET    /api/v1/holidays                       -- list org holidays
POST   /api/v1/holidays                       -- create holiday (admin)
PUT    /api/v1/holidays/{id}                  -- update
DELETE /api/v1/holidays/{id}                  -- delete
POST   /api/v1/holidays/import                -- bulk import (CSV or preset country)
```

#### Frontend Pages/Components Needed

| Page | Route | Roles |
|---|---|---|
| My Leaves | `/dashboard/leaves` | All |
| Apply Leave (dialog) | Modal from leaves page | All |
| Leave Calendar | `/dashboard/leaves/calendar` | All (see team overlay if manager) |
| Leave Approvals | `/dashboard/leaves/approvals` | Manager, Admin, Owner |
| Leave Types Setup | `/dashboard/settings/leave-types` | Admin, Owner |
| Leave Policies Setup | `/dashboard/settings/leave-policies` | Admin, Owner |
| Holiday Calendar Setup | `/dashboard/settings/holidays` | Admin, Owner |
| Leave Balance Admin | `/dashboard/settings/leave-balances` | Admin, Owner |

#### Key Workflows to Implement

1. **Apply for Leave:** Employee selects type, dates, half-day options, reason. System calculates total_days excluding weekends and holidays. Validates against balance. Creates request with status=pending. Notifies manager.

2. **Approve/Reject:** Manager sees pending requests. Can approve (deducts from balance) or reject (with reason). Employee notified. If rejected, pending_days restored to balance.

3. **Cancel Leave:** Employee can cancel pending or future approved leave. Balance restored. If leave already started, only future days cancelled.

4. **Year-End Carry Forward:** Admin triggers year-end process. For each user+leave_type: calculate unused days, apply carry_forward_max cap, create new year balance with carried_forward_days. Old balances frozen.

5. **Leave Calendar:** Month view showing team members' approved leaves. Color-coded by leave type. Click on day to see details. Holidays shown as markers.

6. **Attendance Integration:** When generating attendance report, cross-reference leave_requests to show "On Leave (Annual)" instead of "Absent" for approved leave days.

#### Acceptance Criteria

- [ ] Employee can apply for leave and see remaining balance update in real-time
- [ ] Manager receives notification and can approve/reject from dashboard
- [ ] Half-day leaves (first half / second half) compute as 0.5 days
- [ ] Weekends and org holidays are excluded from leave day calculation
- [ ] Leave balance cannot go negative (validation error on apply)
- [ ] Carry-forward respects max cap and optional expiry
- [ ] Leave calendar shows team view for managers, personal view for employees
- [ ] Attendance report shows "On Leave" status for approved leave days
- [ ] All tables scoped by organization_id
- [ ] All list endpoints paginated

---

### Module 2: Employee Records and Documents

**Status:** Partial -- users table has basic profile fields (job_title, phone, DOB, DOJ, bio, linkedin, github)
**Priority:** P0 -- foundational for all other HR modules; every HR workflow needs richer employee data
**Effort:** M (2-3 weeks)
**Dependencies:** None

#### What Exists Today

The `users` table has: name, email, role, timezone, avatar_url, job_title, phone, linkedin_url, github_url, date_of_birth, date_of_joining, bio, is_active, last_active_at, settings. This covers basic profile but lacks employment-specific data needed for HR (employee ID, department, reporting manager, salary info, emergency contacts, address, employment type, etc.).

#### Database Schema Needed

```sql
-- Departments (organizational hierarchy)
CREATE TABLE departments (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(20),
    parent_id UUID REFERENCES departments(id) ON DELETE SET NULL, -- tree structure
    head_id UUID REFERENCES users(id) ON DELETE SET NULL,         -- department head
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    UNIQUE(organization_id, code)
);

-- Positions / Designations
CREATE TABLE positions (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    level INTEGER,                         -- 1=IC, 2=Lead, 3=Manager, 4=Director, 5=VP, 6=C-suite
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Extended employee profile (1:1 with users, separate table to avoid bloating users)
CREATE TABLE employee_profiles (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    employee_id VARCHAR(50),               -- org-assigned employee ID (e.g., EMP-001)
    department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    position_id UUID REFERENCES positions(id) ON DELETE SET NULL,
    reporting_manager_id UUID REFERENCES users(id) ON DELETE SET NULL,
    employment_type VARCHAR(20) DEFAULT 'full_time', -- full_time | part_time | contract | intern
    employment_status VARCHAR(20) DEFAULT 'active',   -- active | probation | notice_period | terminated | resigned
    probation_end_date DATE,
    notice_period_days INTEGER DEFAULT 30,
    confirmation_date DATE,
    last_working_date DATE,
    work_location VARCHAR(255),            -- "Remote" | "Office - Sydney" | "Hybrid"
    address_line_1 VARCHAR(500),
    address_line_2 VARCHAR(500),
    city VARCHAR(100),
    state VARCHAR(100),
    country VARCHAR(100),
    postal_code VARCHAR(20),
    emergency_contact_name VARCHAR(255),
    emergency_contact_phone VARCHAR(30),
    emergency_contact_relationship VARCHAR(50),
    bank_name VARCHAR(255),
    bank_account_number VARCHAR(100),       -- encrypted at rest
    bank_routing_number VARCHAR(50),        -- encrypted at rest
    tax_id VARCHAR(100),                    -- TFN in Australia, SSN in US, encrypted
    nationality VARCHAR(100),
    gender VARCHAR(20),
    marital_status VARCHAR(20),
    blood_group VARCHAR(5),
    custom_fields JSON,                     -- org-defined custom fields
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    UNIQUE(organization_id, user_id),
    UNIQUE(organization_id, employee_id)
);

-- Employee documents (ID proofs, contracts, certificates)
CREATE TABLE employee_documents (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL,          -- identity | contract | certificate | visa | other
    name VARCHAR(255) NOT NULL,
    description TEXT,
    file_path VARCHAR(500) NOT NULL,        -- S3 path
    file_size INTEGER,
    mime_type VARCHAR(100),
    expiry_date DATE,                       -- for visa, certifications, etc.
    is_verified BOOLEAN DEFAULT FALSE,
    verified_by UUID REFERENCES users(id),
    verified_at TIMESTAMP,
    uploaded_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Employment history within the organization (promotions, transfers)
CREATE TABLE employment_history (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type VARCHAR(30) NOT NULL,        -- joined | promoted | transferred | role_changed | resigned | terminated
    effective_date DATE NOT NULL,
    old_department_id UUID REFERENCES departments(id),
    new_department_id UUID REFERENCES departments(id),
    old_position_id UUID REFERENCES positions(id),
    new_position_id UUID REFERENCES positions(id),
    old_reporting_manager_id UUID REFERENCES users(id),
    new_reporting_manager_id UUID REFERENCES users(id),
    notes TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

#### API Endpoints Needed

```
# Departments
GET    /api/v1/departments                          -- list (tree or flat)
POST   /api/v1/departments                          -- create
PUT    /api/v1/departments/{id}                     -- update
DELETE /api/v1/departments/{id}                     -- deactivate

# Positions
GET    /api/v1/positions                            -- list
POST   /api/v1/positions                            -- create
PUT    /api/v1/positions/{id}                       -- update
DELETE /api/v1/positions/{id}                       -- deactivate

# Employee Profiles
GET    /api/v1/employees                            -- list with filters (department, status, type)
GET    /api/v1/employees/{id}                       -- full profile detail
PUT    /api/v1/employees/{id}                       -- update profile (admin/self for some fields)
GET    /api/v1/employees/{id}/history               -- employment history

# Employee Documents
GET    /api/v1/employees/{id}/documents             -- list docs for user
POST   /api/v1/employees/{id}/documents             -- upload document
GET    /api/v1/employees/{id}/documents/{docId}     -- download
DELETE /api/v1/employees/{id}/documents/{docId}     -- delete
POST   /api/v1/employees/{id}/documents/{docId}/verify -- mark verified
GET    /api/v1/documents/expiring                   -- docs expiring within N days (admin)

# Org Chart
GET    /api/v1/org-chart                            -- hierarchical org chart data
```

#### Frontend Pages/Components Needed

| Page | Route | Roles |
|---|---|---|
| Employee Directory | `/dashboard/employees` | Manager, Admin, Owner |
| Employee Detail | `/dashboard/employees/{id}` | Manager, Admin, Owner (limited self-view for employees) |
| My Profile (extended) | `/dashboard/profile` | All |
| Department Management | `/dashboard/settings/departments` | Admin, Owner |
| Position Management | `/dashboard/settings/positions` | Admin, Owner |
| Org Chart | `/dashboard/org-chart` | All |
| Document Expiry Dashboard | `/dashboard/hr/documents/expiring` | Admin, Owner |

#### Key Workflows to Implement

1. **Employee Onboarding Data Collection:** When a new user accepts an invitation, create an `employee_profiles` row. Admin fills in department, position, reporting manager. Employee fills in personal details, emergency contact, bank info via self-service form.

2. **Document Upload and Verification:** Employee or admin uploads documents. Admin can verify. System tracks expiry dates and sends alerts N days before expiry.

3. **Employment History Tracking:** When department, position, or reporting manager changes, auto-create an `employment_history` record. Provides full audit trail of an employee's journey.

4. **Org Chart Generation:** Query departments + users with reporting_manager_id to build a tree. Frontend renders as hierarchical chart. Click node to view employee summary.

#### Acceptance Criteria

- [ ] Every user in the org has an employee_profiles row (auto-created on invitation accept)
- [ ] Admin can assign department, position, reporting manager
- [ ] Employee can edit own personal fields (address, emergency contact, bank info) but not department/position
- [ ] Sensitive fields (bank account, tax ID) encrypted at rest using Laravel's `encrypted` cast
- [ ] Document upload to S3 with virus scan (ClamAV or similar)
- [ ] Document expiry alerts fire 30/14/7 days before expiry
- [ ] Org chart renders correctly for up to 500 employees
- [ ] Department tree supports N levels of nesting
- [ ] All endpoints scoped by organization_id

---

### Module 3: Attendance (HR Layer)

**Status:** Partial -- attendance report exists (first_seen/last_seen/total_hours from time entries), shifts exist (with days_of_week, user assignment)
**Priority:** P0 -- bridges time tracking (existing) to HR (new); required for payroll and leave
**Effort:** M (2-3 weeks)
**Dependencies:** Module 1 (Leave Management) for leave integration, Module 2 (Employee Records) for department filtering

#### What Exists Today

1. `ReportService::attendance()` -- aggregates time entries to show user_id, date, first_seen, last_seen, total_seconds per day. No concept of "present," "absent," "late," "early leave."
2. `Shift` model -- defines shift times (start_time, end_time, days_of_week) with user assignment via `user_shifts` pivot.
3. No overtime calculation, no late/early detection, no regularization, no payroll-ready attendance summaries.

#### Database Schema Needed

```sql
-- Daily attendance record (materialized from time entries + shifts + leaves)
CREATE TABLE attendance_records (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    shift_id UUID REFERENCES shifts(id),
    expected_start TIME,                    -- from shift definition
    expected_end TIME,
    actual_start TIMESTAMP,                 -- first time entry start of the day
    actual_end TIMESTAMP,                   -- last time entry end of the day
    total_worked_seconds INTEGER DEFAULT 0,
    total_break_seconds INTEGER DEFAULT 0,  -- gaps between time entries
    overtime_seconds INTEGER DEFAULT 0,
    status VARCHAR(20) NOT NULL,            -- present | absent | half_day | on_leave | holiday | weekend | not_scheduled
    late_minutes INTEGER DEFAULT 0,         -- how many minutes after shift start
    early_leave_minutes INTEGER DEFAULT 0,  -- how many minutes before shift end
    is_late BOOLEAN DEFAULT FALSE,
    is_early_leave BOOLEAN DEFAULT FALSE,
    leave_request_id UUID REFERENCES leave_requests(id),
    source VARCHAR(20) DEFAULT 'auto',      -- auto (from time entries) | manual | regularized
    notes TEXT,
    regularized_by UUID REFERENCES users(id),
    regularized_at TIMESTAMP,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    UNIQUE(organization_id, user_id, date)
);

-- Overtime rules per org
CREATE TABLE overtime_rules (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    daily_threshold_hours DECIMAL(4,2) DEFAULT 8.0,  -- overtime starts after N hours/day
    weekly_threshold_hours DECIMAL(4,2) DEFAULT 40.0, -- overtime starts after N hours/week
    multiplier DECIMAL(3,2) DEFAULT 1.5,               -- 1.5x pay
    weekend_multiplier DECIMAL(3,2) DEFAULT 2.0,       -- 2x pay on weekends
    holiday_multiplier DECIMAL(3,2) DEFAULT 2.0,       -- 2x pay on holidays
    requires_approval BOOLEAN DEFAULT TRUE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Attendance regularization requests
CREATE TABLE attendance_regularizations (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    attendance_record_id UUID NOT NULL REFERENCES attendance_records(id),
    date DATE NOT NULL,
    requested_start TIME,
    requested_end TIME,
    reason TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',   -- pending | approved | rejected
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP,
    reviewer_notes TEXT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

#### API Endpoints Needed

```
# Attendance Records
GET    /api/v1/attendance                           -- daily attendance list (filters: date range, user, department, status)
GET    /api/v1/attendance/summary                   -- monthly summary (present/absent/late counts per user)
POST   /api/v1/attendance/generate                  -- trigger attendance generation for date range (admin, cron)
GET    /api/v1/attendance/my                        -- my attendance for date range (employee self-view)

# Regularization
POST   /api/v1/attendance/regularize                -- request regularization (employee)
GET    /api/v1/attendance/regularizations            -- list pending regularizations (manager)
POST   /api/v1/attendance/regularizations/{id}/review -- approve/reject

# Overtime Rules
GET    /api/v1/overtime-rules                       -- list rules
POST   /api/v1/overtime-rules                       -- create
PUT    /api/v1/overtime-rules/{id}                  -- update
DELETE /api/v1/overtime-rules/{id}                  -- delete
```

#### Frontend Pages/Components Needed

| Page | Route | Roles |
|---|---|---|
| Attendance Dashboard | `/dashboard/attendance` | Manager, Admin, Owner |
| My Attendance | `/dashboard/attendance/me` | All |
| Attendance Regularization | Dialog from attendance page | All |
| Regularization Approvals | `/dashboard/attendance/regularizations` | Manager, Admin, Owner |
| Overtime Rules Setup | `/dashboard/settings/overtime` | Admin, Owner |

#### Key Workflows to Implement

1. **Daily Attendance Generation (Background Job):** Scheduled job runs at end of each day (per org timezone). For each user: query time entries for the day, find their assigned shift, compute actual_start/actual_end/total_worked, compare against shift times for late/early detection, check leave_requests for on_leave status, apply overtime rules. Create/update attendance_record.

2. **Late Detection:** If actual_start > expected_start + grace_period (configurable, default 15 min), mark is_late=true, compute late_minutes.

3. **Overtime Calculation:** If total_worked_seconds > daily_threshold * 3600, overtime_seconds = total_worked - threshold. Apply multiplier for payroll.

4. **Regularization:** Employee sees "Absent" or "Late" on a day they worked but forgot to track. They request regularization with corrected times and reason. Manager approves, attendance_record updated with source=regularized.

5. **Integration with Leave:** When generating attendance, check leave_requests for approved leaves on that date. Mark status=on_leave, link leave_request_id.

#### Acceptance Criteria

- [ ] Attendance auto-generated daily from time entries + shift data
- [ ] Late and early-leave detection with configurable grace period
- [ ] Overtime computed based on org-level rules
- [ ] Leaves reflected as "On Leave" in attendance (not "Absent")
- [ ] Weekends and holidays correctly marked (not counted as absent)
- [ ] Regularization workflow with manager approval
- [ ] Monthly summary: total present/absent/late/half_day/leave per user
- [ ] Filters by department, team, date range
- [ ] Scales to 10,000 employees without timeout (batch processing)

---

### Module 4: Payroll and Salary

**Status:** Minimal -- payroll report exists (total hours * project hourly rate = earnings), no salary structures, deductions, payslips
**Priority:** P1 -- high value but complex; depends on attendance and leave data
**Effort:** XL (4-6 weeks)
**Dependencies:** Module 1 (Leave), Module 2 (Employee Records for bank info), Module 3 (Attendance for overtime)

#### What Exists Today

`ReportService::payroll()` computes total_seconds and earnings per user based on approved time entries and project hourly rates. This is a billing/invoicing view, not a payroll system. No concept of base salary, allowances, deductions, tax, or payslips.

#### Database Schema Needed

```sql
-- Salary structures (templates)
CREATE TABLE salary_structures (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,            -- "Standard Full-Time"
    description TEXT,
    pay_frequency VARCHAR(20) DEFAULT 'monthly', -- weekly | biweekly | monthly
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Pay components (basic salary, HRA, transport, etc.)
CREATE TABLE pay_components (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(20) NOT NULL,
    type VARCHAR(20) NOT NULL,             -- earning | deduction | employer_contribution
    calculation_type VARCHAR(20) NOT NULL,  -- fixed | percentage_of_basic | formula
    percentage_of_basic DECIMAL(5,2),       -- if type is percentage
    is_taxable BOOLEAN DEFAULT TRUE,
    is_statutory BOOLEAN DEFAULT FALSE,     -- superannuation, tax, etc.
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    UNIQUE(organization_id, code)
);

-- Link salary structure to its components with default amounts
CREATE TABLE salary_structure_components (
    id UUID PRIMARY KEY,
    salary_structure_id UUID NOT NULL REFERENCES salary_structures(id) ON DELETE CASCADE,
    pay_component_id UUID NOT NULL REFERENCES pay_components(id) ON DELETE CASCADE,
    default_amount DECIMAL(12,2),
    formula TEXT,                           -- e.g., "basic * 0.12" for employer super
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Employee salary assignment
CREATE TABLE employee_salaries (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    salary_structure_id UUID NOT NULL REFERENCES salary_structures(id),
    annual_ctc DECIMAL(12,2),              -- cost to company
    effective_from DATE NOT NULL,
    effective_to DATE,                      -- NULL = current
    currency VARCHAR(3) DEFAULT 'AUD',
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Employee salary component breakdown
CREATE TABLE employee_salary_components (
    id UUID PRIMARY KEY,
    employee_salary_id UUID NOT NULL REFERENCES employee_salaries(id) ON DELETE CASCADE,
    pay_component_id UUID NOT NULL REFERENCES pay_components(id),
    amount DECIMAL(12,2) NOT NULL,          -- monthly amount
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Pay runs
CREATE TABLE pay_runs (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,            -- "March 2026 Payroll"
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    pay_date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'draft',    -- draft | processing | finalized | paid
    total_gross DECIMAL(14,2) DEFAULT 0,
    total_deductions DECIMAL(14,2) DEFAULT 0,
    total_net DECIMAL(14,2) DEFAULT 0,
    total_employer_cost DECIMAL(14,2) DEFAULT 0,
    finalized_by UUID REFERENCES users(id),
    finalized_at TIMESTAMP,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Individual payslips within a pay run
CREATE TABLE payslips (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    pay_run_id UUID NOT NULL REFERENCES pay_runs(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    employee_salary_id UUID NOT NULL REFERENCES employee_salaries(id),
    worked_days DECIMAL(5,1) NOT NULL,
    leave_days DECIMAL(5,1) DEFAULT 0,
    absent_days DECIMAL(5,1) DEFAULT 0,
    overtime_hours DECIMAL(6,2) DEFAULT 0,
    gross_pay DECIMAL(12,2) NOT NULL,
    total_deductions DECIMAL(12,2) DEFAULT 0,
    net_pay DECIMAL(12,2) NOT NULL,
    employer_contributions DECIMAL(12,2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'draft',    -- draft | finalized | sent
    sent_at TIMESTAMP,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    UNIQUE(pay_run_id, user_id)
);

-- Payslip line items (individual component amounts for that payslip)
CREATE TABLE payslip_items (
    id UUID PRIMARY KEY,
    payslip_id UUID NOT NULL REFERENCES payslips(id) ON DELETE CASCADE,
    pay_component_id UUID NOT NULL REFERENCES pay_components(id),
    type VARCHAR(20) NOT NULL,             -- earning | deduction | employer_contribution
    amount DECIMAL(12,2) NOT NULL,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Reimbursement claims
CREATE TABLE reimbursements (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL,         -- travel | meals | equipment | other
    description TEXT NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'AUD',
    receipt_path VARCHAR(500),             -- S3 path
    status VARCHAR(20) DEFAULT 'pending',  -- pending | approved | rejected | paid
    pay_run_id UUID REFERENCES pay_runs(id), -- linked when included in payroll
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

#### API Endpoints Needed

```
# Salary Structures & Components (admin)
GET    /api/v1/salary-structures
POST   /api/v1/salary-structures
PUT    /api/v1/salary-structures/{id}
GET    /api/v1/pay-components
POST   /api/v1/pay-components
PUT    /api/v1/pay-components/{id}

# Employee Salary
GET    /api/v1/employees/{id}/salary             -- current salary breakdown
POST   /api/v1/employees/{id}/salary             -- assign/revise salary
GET    /api/v1/employees/{id}/salary/history      -- salary revision history

# Pay Runs
GET    /api/v1/pay-runs                          -- list pay runs
POST   /api/v1/pay-runs                          -- create new pay run
GET    /api/v1/pay-runs/{id}                     -- detail with payslips
POST   /api/v1/pay-runs/{id}/calculate           -- compute all payslips (pulls attendance, leave, overtime)
POST   /api/v1/pay-runs/{id}/finalize            -- lock pay run
POST   /api/v1/pay-runs/{id}/send-payslips       -- email payslips to employees

# Payslips
GET    /api/v1/payslips                          -- my payslips (employee)
GET    /api/v1/payslips/{id}                     -- payslip detail
GET    /api/v1/payslips/{id}/pdf                 -- download PDF

# Reimbursements
GET    /api/v1/reimbursements                    -- list (my or all)
POST   /api/v1/reimbursements                    -- submit claim
POST   /api/v1/reimbursements/{id}/review        -- approve/reject
```

#### Frontend Pages/Components Needed

| Page | Route | Roles |
|---|---|---|
| My Payslips | `/dashboard/payslips` | All |
| Payslip Detail | `/dashboard/payslips/{id}` | All (own) |
| Pay Run Management | `/dashboard/payroll` | Admin, Owner |
| Pay Run Detail | `/dashboard/payroll/{id}` | Admin, Owner |
| Salary Structures Setup | `/dashboard/settings/salary` | Admin, Owner |
| Reimbursements | `/dashboard/reimbursements` | All |
| Reimbursement Approvals | `/dashboard/reimbursements/approvals` | Manager, Admin, Owner |

#### Key Workflows to Implement

1. **Pay Run Creation:** Admin creates pay run for a period. System pulls all active employees, their salary structures, attendance records, approved leaves, overtime, and approved reimbursements. Computes gross pay, applies deductions, calculates net. All as draft.

2. **Pay Run Calculation:** Worked_days = total working days - absent_days - leave_days. For hourly employees: gross = hours_worked * hourly_rate + overtime_hours * rate * multiplier. For salaried: gross = monthly_salary * (worked_days / total_working_days). Deductions computed from pay components.

3. **Payslip PDF Generation:** Generate branded PDF payslip with company logo, employee details, earnings breakdown, deductions breakdown, net pay, YTD totals.

4. **Integration with Time Tracking:** The existing payroll report data (hours * rate from time entries) becomes one input to the payroll calculation for hourly/billable employees.

#### Acceptance Criteria

- [ ] Salary structure with multiple components (earnings + deductions) assignable to employees
- [ ] Pay run auto-computes payslips from attendance + leave + overtime data
- [ ] Payslip shows itemized breakdown matching salary components
- [ ] PDF payslip generation and email delivery
- [ ] Reimbursements included in pay run when approved
- [ ] Salary revision history maintained with effective dates
- [ ] YTD totals on payslips
- [ ] All financial amounts stored as DECIMAL(12,2), never float
- [ ] Bank details encrypted at rest

---

### Module 5: Employee Onboarding

**Status:** Minimal -- invitation system exists (email invite, accept, role assignment), but no pre-boarding, checklists, or document collection
**Priority:** P1 -- first impression matters; reduces admin overhead
**Effort:** M (2-3 weeks)
**Dependencies:** Module 2 (Employee Records for document collection), Module 1 (Leave for initial balance setup)

#### What Exists Today

`Invitation` model with email, role, token, accepted_at, expires_at. When accepted, user is created with basic fields. No checklists, no document requests, no probation tracking, no welcome workflows.

#### Database Schema Needed

```sql
-- Onboarding templates (reusable per role/department)
CREATE TABLE onboarding_templates (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,            -- "Engineering New Hire"
    description TEXT,
    applies_to_departments JSON,            -- NULL = all, or [dept_id, dept_id]
    applies_to_roles JSON,                  -- NULL = all, or ["employee", "manager"]
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Checklist items within a template
CREATE TABLE onboarding_checklist_items (
    id UUID PRIMARY KEY,
    onboarding_template_id UUID NOT NULL REFERENCES onboarding_templates(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    category VARCHAR(50) DEFAULT 'general', -- general | document | training | access | equipment
    assignee_type VARCHAR(20) DEFAULT 'employee', -- employee | manager | hr | it
    due_days_after_joining INTEGER DEFAULT 7, -- due N days after joining
    is_required BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- User-specific onboarding progress
CREATE TABLE onboarding_progress (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    onboarding_template_id UUID NOT NULL REFERENCES onboarding_templates(id),
    status VARCHAR(20) DEFAULT 'in_progress', -- in_progress | completed | overdue
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    UNIQUE(organization_id, user_id)
);

-- User-specific checklist item completion
CREATE TABLE onboarding_checklist_progress (
    id UUID PRIMARY KEY,
    onboarding_progress_id UUID NOT NULL REFERENCES onboarding_progress(id) ON DELETE CASCADE,
    checklist_item_id UUID NOT NULL REFERENCES onboarding_checklist_items(id),
    is_completed BOOLEAN DEFAULT FALSE,
    completed_at TIMESTAMP,
    completed_by UUID REFERENCES users(id),
    notes TEXT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    UNIQUE(onboarding_progress_id, checklist_item_id)
);
```

#### API Endpoints Needed

```
# Onboarding Templates (admin)
GET    /api/v1/onboarding/templates
POST   /api/v1/onboarding/templates
PUT    /api/v1/onboarding/templates/{id}
DELETE /api/v1/onboarding/templates/{id}

# Onboarding Progress
GET    /api/v1/onboarding                         -- list all active onboardings (admin/manager)
GET    /api/v1/onboarding/my                      -- my onboarding checklist (new employee)
POST   /api/v1/onboarding/{userId}/start          -- trigger onboarding for a user (admin)
POST   /api/v1/onboarding/items/{itemId}/complete -- mark item done
GET    /api/v1/onboarding/overdue                 -- items past due date (admin)
```

#### Frontend Pages/Components Needed

| Page | Route | Roles |
|---|---|---|
| My Onboarding | `/dashboard/onboarding` | New employees |
| Onboarding Management | `/dashboard/hr/onboarding` | Admin, Owner, Manager |
| Onboarding Templates | `/dashboard/settings/onboarding` | Admin, Owner |

#### Key Workflows to Implement

1. **Auto-Trigger on Invitation Accept:** When user accepts invitation, match onboarding template by role/department. Create onboarding_progress + checklist_progress rows. Notify employee + manager + HR.

2. **Checklist Completion:** Different items assigned to different people (employee submits docs, IT sets up accounts, manager assigns buddy). Each marks their items complete. Progress bar shows overall completion.

3. **Probation Tracking:** employee_profiles.employment_status = 'probation' until probation_end_date. When date passes, admin confirms to 'active'. Notification to manager 7 days before probation ends.

4. **Overdue Alerts:** Background job checks for incomplete required items past due date. Sends reminders.

#### Acceptance Criteria

- [ ] Onboarding auto-triggered when new employee joins
- [ ] Checklist items assignable to employee, manager, HR, or IT
- [ ] Progress tracked as percentage complete
- [ ] Overdue items highlighted with reminder notifications
- [ ] Probation end date tracked with advance notification
- [ ] Admin can customize templates per department/role
- [ ] New employee sees onboarding checklist as first dashboard experience

---

### Module 6: Performance Management

**Status:** Not Started
**Priority:** P2 -- important for retention but not operationally blocking
**Effort:** L (3-4 weeks)
**Dependencies:** Module 2 (Employee Records for reporting lines), Module 3 (Attendance data for performance context)

#### What Exists Today

Nothing. Activity scores from time tracking provide raw productivity data, but there is no performance review system, goal tracking, or feedback mechanism.

#### Database Schema Needed

```sql
-- Review cycles (annual, quarterly, etc.)
CREATE TABLE review_cycles (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,            -- "2026 Annual Review"
    type VARCHAR(20) NOT NULL,             -- annual | quarterly | probation | ad_hoc
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    review_deadline DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'draft',    -- draft | active | in_review | completed
    settings JSON,                          -- { self_review: true, peer_review: true, manager_review: true }
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Review questions / competency framework
CREATE TABLE review_templates (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    sections JSON NOT NULL,                 -- [{ title, questions: [{ text, type: rating|text|scale, weight }] }]
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Individual reviews
CREATE TABLE performance_reviews (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    review_cycle_id UUID NOT NULL REFERENCES review_cycles(id) ON DELETE CASCADE,
    reviewee_id UUID NOT NULL REFERENCES users(id),
    reviewer_id UUID NOT NULL REFERENCES users(id),
    review_type VARCHAR(20) NOT NULL,       -- self | manager | peer | skip_level
    review_template_id UUID REFERENCES review_templates(id),
    responses JSON,                         -- answers to template questions
    overall_rating DECIMAL(3,1),            -- 1.0 - 5.0
    summary TEXT,
    strengths TEXT,
    areas_for_improvement TEXT,
    status VARCHAR(20) DEFAULT 'pending',   -- pending | in_progress | submitted | acknowledged
    submitted_at TIMESTAMP,
    acknowledged_at TIMESTAMP,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Goals / OKRs
CREATE TABLE goals (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES goals(id),    -- for cascading OKRs
    title VARCHAR(500) NOT NULL,
    description TEXT,
    type VARCHAR(20) DEFAULT 'individual',  -- individual | team | company
    metric_type VARCHAR(20),                -- percentage | number | currency | boolean
    target_value DECIMAL(12,2),
    current_value DECIMAL(12,2) DEFAULT 0,
    start_date DATE,
    due_date DATE,
    status VARCHAR(20) DEFAULT 'on_track',  -- on_track | at_risk | behind | completed | cancelled
    progress_percentage INTEGER DEFAULT 0,
    review_cycle_id UUID REFERENCES review_cycles(id),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Performance Improvement Plans (PIPs)
CREATE TABLE pips (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    initiated_by UUID NOT NULL REFERENCES users(id),
    reason TEXT NOT NULL,
    improvement_areas JSON NOT NULL,         -- [{ area, expected_outcome, support_provided }]
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    check_in_frequency VARCHAR(20) DEFAULT 'weekly',
    status VARCHAR(20) DEFAULT 'active',    -- active | extended | completed_success | completed_fail
    outcome TEXT,
    completed_at TIMESTAMP,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

#### API Endpoints Needed

```
# Review Cycles (admin)
GET    /api/v1/review-cycles
POST   /api/v1/review-cycles
PUT    /api/v1/review-cycles/{id}
POST   /api/v1/review-cycles/{id}/launch      -- activate and create individual reviews

# Performance Reviews
GET    /api/v1/reviews                          -- my reviews to complete
GET    /api/v1/reviews/{id}
PUT    /api/v1/reviews/{id}                     -- save progress
POST   /api/v1/reviews/{id}/submit              -- submit review
GET    /api/v1/reviews/team                     -- team review summary (manager)

# Goals
GET    /api/v1/goals
POST   /api/v1/goals
PUT    /api/v1/goals/{id}
PUT    /api/v1/goals/{id}/progress              -- update progress
DELETE /api/v1/goals/{id}

# PIPs (admin/manager)
GET    /api/v1/pips
POST   /api/v1/pips
PUT    /api/v1/pips/{id}
POST   /api/v1/pips/{id}/check-in              -- record check-in note
POST   /api/v1/pips/{id}/complete              -- close PIP with outcome
```

#### Frontend Pages/Components Needed

| Page | Route | Roles |
|---|---|---|
| My Reviews | `/dashboard/reviews` | All |
| Review Form | `/dashboard/reviews/{id}` | All |
| Goals / OKRs | `/dashboard/goals` | All |
| Team Reviews | `/dashboard/reviews/team` | Manager, Admin, Owner |
| Review Cycles Admin | `/dashboard/settings/review-cycles` | Admin, Owner |
| PIP Management | `/dashboard/hr/pips` | Admin, Owner, Manager |

#### Key Workflows to Implement

1. **Review Cycle Launch:** Admin creates cycle, selects template, scope (all or department). System creates individual review records: self-review for each employee, manager-review for each reportee, optional peer reviews. Employees notified.

2. **Review Submission Flow:** Employee completes self-review. Manager completes manager-review. When both submitted, manager schedules 1:1 discussion. After discussion, employee acknowledges. Final rating computed.

3. **Goal Tracking:** Employees set goals aligned to team/company OKRs. Regular progress updates. Goals linked to review cycles for performance evaluation context.

4. **Activity Data Integration:** Performance review dashboard can surface average activity score, total tracked hours, project distribution from existing time tracking data as supporting context (not as the review itself -- activity data informs but doesn't replace human judgment).

#### Acceptance Criteria

- [ ] Review cycle creates individual reviews for all in-scope employees
- [ ] Self and manager reviews with configurable question templates
- [ ] Rating scale 1-5 with weighted scoring across competencies
- [ ] Goals with measurable targets and progress tracking
- [ ] PIP workflow with check-in cadence and outcome tracking
- [ ] Time tracking data surfaced as context in review (hours tracked, activity score averages)
- [ ] Review data private -- employees see only their own reviews

---

### Module 7: Offboarding

**Status:** Not Started
**Priority:** P2 -- important for compliance and smooth exits
**Effort:** M (2-3 weeks)
**Dependencies:** Module 2 (Employee Records), Module 4 (Payroll for FnF), Module 1 (Leave for encashment)

#### What Exists Today

Users can be deactivated (`is_active = false`), but there is no formal offboarding workflow, no final settlement, no exit interview, no asset recovery tracking.

#### Database Schema Needed

```sql
-- Offboarding records
CREATE TABLE offboarding_records (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    initiated_by UUID NOT NULL REFERENCES users(id),
    type VARCHAR(20) NOT NULL,              -- resignation | termination | retirement | contract_end
    resignation_date DATE,
    last_working_date DATE NOT NULL,
    notice_period_days INTEGER,
    notice_period_served_days INTEGER,
    reason TEXT,
    status VARCHAR(20) DEFAULT 'in_progress', -- in_progress | completed | cancelled
    completed_at TIMESTAMP,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    UNIQUE(organization_id, user_id)
);

-- Offboarding checklist (reuses similar pattern to onboarding)
CREATE TABLE offboarding_checklist_items (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    category VARCHAR(50) DEFAULT 'general', -- general | access_revocation | asset_return | knowledge_transfer | finance
    assignee_type VARCHAR(20) DEFAULT 'hr', -- employee | manager | hr | it | finance
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

CREATE TABLE offboarding_checklist_progress (
    id UUID PRIMARY KEY,
    offboarding_record_id UUID NOT NULL REFERENCES offboarding_records(id) ON DELETE CASCADE,
    checklist_item_id UUID NOT NULL REFERENCES offboarding_checklist_items(id),
    is_completed BOOLEAN DEFAULT FALSE,
    completed_at TIMESTAMP,
    completed_by UUID REFERENCES users(id),
    notes TEXT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    UNIQUE(offboarding_record_id, checklist_item_id)
);

-- Exit interviews
CREATE TABLE exit_interviews (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    offboarding_record_id UUID NOT NULL REFERENCES offboarding_records(id),
    user_id UUID NOT NULL REFERENCES users(id),
    conducted_by UUID REFERENCES users(id),
    conducted_at TIMESTAMP,
    responses JSON,                         -- structured interview answers
    overall_sentiment VARCHAR(20),          -- positive | neutral | negative
    primary_reason_for_leaving VARCHAR(100),
    would_recommend BOOLEAN,
    notes TEXT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Final settlement (FnF)
CREATE TABLE final_settlements (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    offboarding_record_id UUID NOT NULL REFERENCES offboarding_records(id),
    user_id UUID NOT NULL REFERENCES users(id),
    pending_salary DECIMAL(12,2) DEFAULT 0,
    leave_encashment DECIMAL(12,2) DEFAULT 0,
    bonus DECIMAL(12,2) DEFAULT 0,
    deductions DECIMAL(12,2) DEFAULT 0,
    notice_period_recovery DECIMAL(12,2) DEFAULT 0,
    reimbursements_pending DECIMAL(12,2) DEFAULT 0,
    gratuity DECIMAL(12,2) DEFAULT 0,
    total_settlement DECIMAL(12,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'draft',     -- draft | approved | paid
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP,
    paid_at TIMESTAMP,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

#### API Endpoints Needed

```
POST   /api/v1/offboarding                         -- initiate offboarding
GET    /api/v1/offboarding                          -- list active offboardings
GET    /api/v1/offboarding/{id}                     -- detail with checklist
POST   /api/v1/offboarding/{id}/checklist/{itemId}  -- complete checklist item
POST   /api/v1/offboarding/{id}/complete            -- finalize offboarding

# Exit Interviews
POST   /api/v1/offboarding/{id}/exit-interview      -- record interview
GET    /api/v1/exit-interviews                       -- list all (admin, for analytics)

# Final Settlement
GET    /api/v1/offboarding/{id}/settlement           -- view FnF
POST   /api/v1/offboarding/{id}/settlement           -- calculate FnF
POST   /api/v1/offboarding/{id}/settlement/approve   -- approve
```

#### Frontend Pages/Components Needed

| Page | Route | Roles |
|---|---|---|
| Offboarding Dashboard | `/dashboard/hr/offboarding` | Admin, Owner, Manager |
| Offboarding Detail | `/dashboard/hr/offboarding/{id}` | Admin, Owner, Manager |
| Exit Interview Form | `/dashboard/hr/offboarding/{id}/exit-interview` | HR/Admin |
| Final Settlement | `/dashboard/hr/offboarding/{id}/settlement` | Admin, Owner |

#### Key Workflows to Implement

1. **Initiate Offboarding:** Admin triggers for a user with type (resignation/termination), last working date. System creates offboarding_record, assigns checklist items, notifies all stakeholders.

2. **Checklist Execution:** IT revokes system access, manager handles knowledge transfer, finance calculates FnF, HR conducts exit interview. Each marks their items done.

3. **Final Settlement Calculation:** Pull pending salary days, unused leave balance (for encashment), pending reimbursements, deductions (notice period shortfall, asset recovery). Generate total.

4. **Account Deactivation:** On offboarding completion, set user.is_active = false, revoke all API tokens, stop any running timers, archive their data (don't delete for audit compliance).

#### Acceptance Criteria

- [ ] Offboarding workflow with role-specific checklists
- [ ] Exit interview with structured responses and sentiment tracking
- [ ] FnF calculation pulling data from salary, leave, reimbursements
- [ ] Account automatically deactivated on completion
- [ ] All API tokens revoked on offboarding completion
- [ ] Attrition analytics: reason breakdown, tenure distribution, sentiment trends

---

### Module 8: HR Communication and Helpdesk

**Status:** Not Started
**Priority:** P2 -- reduces ad-hoc Slack/email HR queries
**Effort:** M (2-3 weeks)
**Dependencies:** Module 2 (Employee Records)

#### What Exists Today

Nothing. No announcement system, no ticketing, no internal communication.

#### Database Schema Needed

```sql
-- Company announcements
CREATE TABLE announcements (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    content TEXT NOT NULL,
    type VARCHAR(20) DEFAULT 'general',     -- general | policy | urgent | celebration
    target_audience JSON,                    -- NULL=all, or { departments: [...], roles: [...] }
    published_at TIMESTAMP,
    expires_at TIMESTAMP,
    is_pinned BOOLEAN DEFAULT FALSE,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

CREATE TABLE announcement_reads (
    id UUID PRIMARY KEY,
    announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at TIMESTAMP NOT NULL,
    UNIQUE(announcement_id, user_id)
);

-- HR Helpdesk tickets
CREATE TABLE hr_tickets (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    ticket_number VARCHAR(20) NOT NULL,     -- auto-generated: HR-000001
    user_id UUID NOT NULL REFERENCES users(id),
    category VARCHAR(50) NOT NULL,          -- payroll | leave | benefits | policy | other
    subject VARCHAR(500) NOT NULL,
    description TEXT NOT NULL,
    priority VARCHAR(20) DEFAULT 'medium',  -- low | medium | high | urgent
    status VARCHAR(20) DEFAULT 'open',      -- open | in_progress | waiting_on_employee | resolved | closed
    assigned_to UUID REFERENCES users(id),
    resolved_at TIMESTAMP,
    closed_at TIMESTAMP,
    sla_due_at TIMESTAMP,                   -- based on priority
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    UNIQUE(organization_id, ticket_number)
);

CREATE TABLE hr_ticket_comments (
    id UUID PRIMARY KEY,
    hr_ticket_id UUID NOT NULL REFERENCES hr_tickets(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    is_internal BOOLEAN DEFAULT FALSE,      -- internal notes visible only to HR
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

#### API Endpoints Needed

```
# Announcements
GET    /api/v1/announcements                     -- list (with unread count)
POST   /api/v1/announcements                     -- create (admin/owner)
PUT    /api/v1/announcements/{id}                -- update
DELETE /api/v1/announcements/{id}                -- delete
POST   /api/v1/announcements/{id}/read           -- mark as read

# HR Tickets
GET    /api/v1/hr-tickets                        -- list (my tickets or all for HR)
POST   /api/v1/hr-tickets                        -- create ticket
GET    /api/v1/hr-tickets/{id}                   -- detail with comments
PUT    /api/v1/hr-tickets/{id}                   -- update (assign, change status)
POST   /api/v1/hr-tickets/{id}/comments          -- add comment
GET    /api/v1/hr-tickets/stats                  -- SLA metrics, open/resolved counts
```

#### Frontend Pages/Components Needed

| Page | Route | Roles |
|---|---|---|
| Announcements Feed | `/dashboard/announcements` | All |
| Create Announcement | Dialog from announcements page | Admin, Owner |
| My HR Tickets | `/dashboard/hr-tickets` | All |
| HR Ticket Detail | `/dashboard/hr-tickets/{id}` | All (own) / HR (all) |
| HR Helpdesk Dashboard | `/dashboard/hr/helpdesk` | Admin, Owner |

#### Acceptance Criteria

- [ ] Announcements with targeted audience (department/role filtering)
- [ ] Read tracking with unread badge on sidebar
- [ ] Tickets with auto-generated ticket numbers
- [ ] SLA tracking based on priority (urgent=4h, high=8h, medium=24h, low=48h)
- [ ] Internal notes visible only to HR team
- [ ] Email notifications on ticket updates

---

### Module 9: Recruitment / ATS

**Status:** Not Started
**Priority:** P3 -- nice-to-have; most orgs use dedicated ATS tools (Greenhouse, Lever)
**Effort:** XL (4-6 weeks)
**Dependencies:** Module 2 (Employee Records for conversion to employee)

#### What Exists Today

Nothing.

#### Database Schema Needed

```sql
-- Job postings
CREATE TABLE job_postings (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    department_id UUID REFERENCES departments(id),
    position_id UUID REFERENCES positions(id),
    description TEXT NOT NULL,
    requirements TEXT,
    employment_type VARCHAR(20),            -- full_time | part_time | contract | intern
    location VARCHAR(255),
    salary_range_min DECIMAL(12,2),
    salary_range_max DECIMAL(12,2),
    currency VARCHAR(3) DEFAULT 'AUD',
    status VARCHAR(20) DEFAULT 'draft',     -- draft | published | paused | closed | filled
    published_at TIMESTAMP,
    closes_at DATE,
    hiring_manager_id UUID REFERENCES users(id),
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Applicants
CREATE TABLE applicants (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    job_posting_id UUID NOT NULL REFERENCES job_postings(id),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(30),
    resume_path VARCHAR(500),
    cover_letter TEXT,
    source VARCHAR(50),                     -- direct | referral | linkedin | indeed | other
    referred_by UUID REFERENCES users(id),
    stage VARCHAR(30) DEFAULT 'applied',    -- applied | screening | interview | assessment | offer | hired | rejected | withdrawn
    rating DECIMAL(3,1),                    -- aggregate interviewer rating
    rejection_reason TEXT,
    notes TEXT,
    converted_user_id UUID REFERENCES users(id), -- when hired, link to created user
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Interview schedule
CREATE TABLE interviews (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    applicant_id UUID NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
    interviewer_id UUID NOT NULL REFERENCES users(id),
    scheduled_at TIMESTAMP NOT NULL,
    duration_minutes INTEGER DEFAULT 60,
    type VARCHAR(20) DEFAULT 'video',       -- phone | video | in_person | panel
    location_or_link VARCHAR(500),
    status VARCHAR(20) DEFAULT 'scheduled', -- scheduled | completed | cancelled | no_show
    scorecard JSON,                         -- [{ criterion, rating, notes }]
    overall_recommendation VARCHAR(20),      -- strong_yes | yes | neutral | no | strong_no
    feedback TEXT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Offer letters
CREATE TABLE offer_letters (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    applicant_id UUID NOT NULL REFERENCES applicants(id),
    job_posting_id UUID NOT NULL REFERENCES job_postings(id),
    salary_offered DECIMAL(12,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'AUD',
    joining_date DATE,
    expiry_date DATE,
    terms TEXT,
    status VARCHAR(20) DEFAULT 'draft',     -- draft | sent | accepted | declined | expired
    sent_at TIMESTAMP,
    responded_at TIMESTAMP,
    document_path VARCHAR(500),
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

#### API Endpoints Needed

```
# Job Postings
CRUD   /api/v1/jobs
POST   /api/v1/jobs/{id}/publish
POST   /api/v1/jobs/{id}/close

# Applicants
CRUD   /api/v1/applicants
PUT    /api/v1/applicants/{id}/stage           -- move through pipeline
POST   /api/v1/applicants/{id}/convert         -- convert to employee (creates user + invitation)

# Interviews
CRUD   /api/v1/interviews
POST   /api/v1/interviews/{id}/scorecard       -- submit feedback

# Offer Letters
CRUD   /api/v1/offers
POST   /api/v1/offers/{id}/send
```

#### Acceptance Criteria

- [ ] Kanban pipeline view for applicant stages
- [ ] Interview scheduling with calendar integration
- [ ] Scorecard-based evaluation with aggregate ratings
- [ ] Offer letter generation and tracking
- [ ] Applicant-to-employee conversion (creates user, triggers onboarding)
- [ ] Source tracking for recruitment analytics

---

### Module 10: Benefits and Compensation

**Status:** Not Started
**Priority:** P3 -- complex and jurisdiction-specific; most orgs use dedicated benefits platforms
**Effort:** L (3-4 weeks)
**Dependencies:** Module 4 (Payroll), Module 2 (Employee Records)

#### What Exists Today

Nothing.

#### Database Schema Needed

```sql
-- Benefit plans offered by the org
CREATE TABLE benefit_plans (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,              -- health | dental | vision | life | retirement | wellness | other
    provider VARCHAR(255),
    description TEXT,
    employer_contribution DECIMAL(12,2),
    employee_contribution DECIMAL(12,2),
    coverage_details JSON,
    enrollment_start DATE,
    enrollment_end DATE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Employee benefit enrollments
CREATE TABLE benefit_enrollments (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    benefit_plan_id UUID NOT NULL REFERENCES benefit_plans(id),
    status VARCHAR(20) DEFAULT 'active',    -- active | pending | cancelled | expired
    start_date DATE NOT NULL,
    end_date DATE,
    dependents JSON,                         -- [{ name, relationship, dob }]
    employee_contribution DECIMAL(12,2),
    employer_contribution DECIMAL(12,2),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Total compensation statements
CREATE TABLE compensation_statements (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    base_salary DECIMAL(12,2),
    bonus DECIMAL(12,2),
    equity_value DECIMAL(12,2),
    benefits_value DECIMAL(12,2),
    total_compensation DECIMAL(12,2),
    statement_data JSON,                     -- detailed breakdown
    generated_at TIMESTAMP,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    UNIQUE(organization_id, user_id, year)
);
```

#### API Endpoints Needed

```
CRUD   /api/v1/benefit-plans
CRUD   /api/v1/benefit-enrollments
GET    /api/v1/compensation-statements              -- my statements
POST   /api/v1/compensation-statements/generate     -- generate for year (admin)
```

#### Acceptance Criteria

- [ ] Benefit plans with enrollment windows
- [ ] Employee self-enrollment with dependent management
- [ ] Deductions auto-feed into payroll
- [ ] Annual total compensation statement generation

---

### Module 11: Compliance and Reporting

**Status:** Partial -- audit logs exist (enterprise feature), no statutory reports or policy acknowledgments
**Priority:** P2 -- critical for regulated industries
**Effort:** M (2-3 weeks)
**Dependencies:** Module 4 (Payroll), Module 1 (Leave), Module 3 (Attendance)

#### What Exists Today

Audit logs track user actions with IP, user agent, and action details. Data privacy features include data export, account deletion, consent management. No statutory/compliance reports, no policy acknowledgment tracking.

#### Database Schema Needed

```sql
-- Organization policies (handbook, code of conduct, etc.)
CREATE TABLE policies (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    content TEXT,
    document_path VARCHAR(500),
    version VARCHAR(20) NOT NULL,
    effective_date DATE NOT NULL,
    requires_acknowledgment BOOLEAN DEFAULT TRUE,
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Employee policy acknowledgments
CREATE TABLE policy_acknowledgments (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    policy_id UUID NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    acknowledged_at TIMESTAMP NOT NULL,
    ip_address VARCHAR(45),
    created_at TIMESTAMP,
    UNIQUE(policy_id, user_id)
);

-- Compliance report definitions
CREATE TABLE compliance_reports (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,              -- headcount | turnover | diversity | leave_utilization | overtime | attendance_summary
    parameters JSON,                         -- date range, filters
    generated_data JSON,
    file_path VARCHAR(500),                  -- exported PDF/CSV
    generated_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

#### API Endpoints Needed

```
# Policies
CRUD   /api/v1/policies
POST   /api/v1/policies/{id}/acknowledge          -- employee acknowledges
GET    /api/v1/policies/{id}/acknowledgments       -- who has/hasn't acknowledged (admin)
GET    /api/v1/policies/pending                    -- my pending acknowledgments

# Compliance Reports
GET    /api/v1/compliance-reports/types             -- available report types
POST   /api/v1/compliance-reports/generate          -- generate report
GET    /api/v1/compliance-reports                    -- list generated reports
GET    /api/v1/compliance-reports/{id}               -- download
```

#### Frontend Pages/Components Needed

| Page | Route | Roles |
|---|---|---|
| Policy Hub | `/dashboard/policies` | All |
| Policy Acknowledgment | Dialog on policy page | All |
| Policy Management | `/dashboard/settings/policies` | Admin, Owner |
| Compliance Reports | `/dashboard/hr/compliance` | Admin, Owner |

#### Acceptance Criteria

- [ ] Policy creation with versioning
- [ ] Mandatory acknowledgment tracking with timestamps
- [ ] Pre-built compliance reports (headcount, turnover, diversity, leave utilization, overtime)
- [ ] PDF/CSV export for all compliance reports
- [ ] Dashboard showing unacknowledged policies per employee

---

### Module 12: Organization Structure

**Status:** Partial -- teams exist (flat, with manager), but no departments, no hierarchy, no positions, no org chart
**Priority:** P1 -- foundational for department-based filtering in leave, attendance, payroll, reports
**Effort:** S (1-2 weeks)
**Dependencies:** None (but is a dependency FOR many other modules)

Note: The schema for this module (departments, positions) is already defined in Module 2 (Employee Records). This module focuses on the org chart UI, position management workflows, and workforce planning.

#### What Exists Today

`teams` table with name and manager_id. `team_user` pivot for membership. No departments, no hierarchical structure, no positions/designations, no org chart.

#### Additional Schema Beyond Module 2

```sql
-- Workforce planning: headcount targets per department
CREATE TABLE headcount_plans (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    department_id UUID NOT NULL REFERENCES departments(id),
    position_id UUID REFERENCES positions(id),
    fiscal_year INTEGER NOT NULL,
    planned_headcount INTEGER NOT NULL,
    current_headcount INTEGER DEFAULT 0,     -- maintained via triggers/jobs
    budget DECIMAL(14,2),
    status VARCHAR(20) DEFAULT 'planned',    -- planned | approved | frozen
    notes TEXT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

#### API Endpoints Needed

```
# (Departments and Positions are in Module 2)

# Org Chart
GET    /api/v1/org-chart                            -- full hierarchy (departments + users + reporting lines)
GET    /api/v1/org-chart/department/{id}             -- subtree for a department

# Workforce Planning (admin)
GET    /api/v1/headcount-plans
POST   /api/v1/headcount-plans
PUT    /api/v1/headcount-plans/{id}
GET    /api/v1/headcount-plans/summary               -- planned vs actual per department
```

#### Frontend Pages/Components Needed

| Page | Route | Roles |
|---|---|---|
| Org Chart (interactive tree) | `/dashboard/org-chart` | All |
| Department Management | `/dashboard/settings/departments` | Admin, Owner |
| Position Management | `/dashboard/settings/positions` | Admin, Owner |
| Workforce Planning | `/dashboard/hr/workforce` | Admin, Owner |

#### Acceptance Criteria

- [ ] Interactive org chart with expand/collapse, click to view employee card
- [ ] Department hierarchy (unlimited nesting)
- [ ] Position/designation catalog linked to departments
- [ ] Workforce planning: planned vs. actual headcount per department
- [ ] Existing teams model integrates with (but does not replace) departments -- teams are cross-functional, departments are structural

---

## Phased Roadmap

### Phase 1 -- Foundation (Month 1-2)

**Goal:** Lay the structural foundations that all other HR modules depend on.

| Module | Scope | Effort |
|---|---|---|
| Module 12: Organization Structure | Departments, positions, org chart | 1-2 weeks |
| Module 2: Employee Records | Extended profiles, documents, employment history | 2-3 weeks |
| Module 1: Leave Management | Leave types, policies, balances, apply/approve, calendar | 3-4 weeks |

**Why this order:** Departments and positions must exist before employee profiles can reference them. Employee records must exist before leave balances can be assigned. Leave is the single most requested HR feature and can ship independently.

**Deliverables:**
- Department and position management in settings
- Interactive org chart
- Employee directory with extended profiles
- Document upload with expiry tracking
- Complete leave management system (types, policies, balances, requests, approvals, calendar)

### Phase 2 -- Core HR (Month 2-4)

**Goal:** Connect time tracking data to HR workflows. This is where TrackFlow's competitive advantage lies -- no other time tracking tool has this depth of HR integration.

| Module | Scope | Effort |
|---|---|---|
| Module 3: Attendance (HR Layer) | Auto-attendance from time entries, late/early detection, overtime, regularization | 2-3 weeks |
| Module 5: Employee Onboarding | Templates, checklists, auto-trigger on invite accept | 2-3 weeks |
| Module 4: Payroll | Salary structures, pay runs, payslips, reimbursements | 4-6 weeks |

**Why this order:** Attendance builds directly on existing time entries + shifts (already in the DB). Payroll needs attendance + leave data to compute correctly. Onboarding can run in parallel as it has no dependency on payroll.

**Deliverables:**
- Daily attendance auto-computed from time tracking data
- Overtime calculation with configurable rules
- Attendance regularization workflow
- Onboarding templates with auto-triggered checklists
- Full payroll: salary structures, pay run calculation, payslips with PDF generation

### Phase 3 -- Advanced HR (Month 4-6)

**Goal:** Employee lifecycle management and internal communication.

| Module | Scope | Effort |
|---|---|---|
| Module 6: Performance Management | Review cycles, goals/OKRs, PIPs | 3-4 weeks |
| Module 7: Offboarding | Exit workflow, checklists, FnF, exit interviews | 2-3 weeks |
| Module 8: HR Communication | Announcements, HR helpdesk ticketing | 2-3 weeks |
| Module 11: Compliance | Policies, acknowledgments, statutory reports | 2-3 weeks |

**Deliverables:**
- Performance review cycles with self + manager reviews
- Goal/OKR tracking
- Complete offboarding workflow with final settlement
- Company announcements with read tracking
- HR helpdesk with SLA tracking
- Policy management with acknowledgment tracking

### Phase 4 -- Full Platform (Month 6+)

**Goal:** Feature completeness for enterprise market.

| Module | Scope | Effort |
|---|---|---|
| Module 9: Recruitment / ATS | Job postings, applicant pipeline, interviews, offers | 4-6 weeks |
| Module 10: Benefits | Benefit plans, enrollment, compensation statements | 3-4 weeks |

**Deliverables:**
- Complete ATS with Kanban pipeline
- Benefits enrollment with payroll integration
- Total compensation statements

---

## Integration Points with Existing Time Tracking

This is where TrackFlow has a genuine competitive moat. No Hubstaff/Time Doctor competitor has native HR integration. These integration points must be built thoughtfully:

| Existing Feature | HR Integration | Implementation |
|---|---|---|
| **Time entries** | Auto-generate daily attendance records | Background job queries time entries per user per day, maps to attendance_records |
| **Shifts** | Define expected work hours for attendance | attendance_records.expected_start/end comes from user's assigned shift |
| **Activity scores** | Context in performance reviews | API endpoint returns avg activity score for a date range, surfaced in review form |
| **Timesheets** | Timesheet approval feeds payroll "worked days" | Pay run calculation checks timesheet status for the pay period |
| **Projects (billable)** | Hourly billing feeds payroll for contractors | Existing payroll report data becomes one input to pay run |
| **Screenshots** | Evidence for attendance disputes | Link to screenshots for a specific date when regularization is disputed |
| **Teams** | Cross-functional overlay on department hierarchy | Teams remain for project assignment; departments for HR/reporting |
| **Idle detection** | Contextual attendance data | Large idle periods noted in attendance record for transparency |
| **Audit logs** | HR action tracking | All HR actions (leave approval, salary change, offboarding) logged via existing AuditService |
| **Billing (Stripe)** | HR module as premium feature | Gate HR modules behind plan tier (e.g., "Business" plan includes leave + attendance, "Enterprise" includes all HR) |

---

## Technical Constraints and Decisions

### 1. Multi-Tenancy (Non-Negotiable)
Every new table gets `organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`. Every new Eloquent model uses `BelongsToOrganization` trait. Every new controller query is scoped. No exceptions.

### 2. UUID Primary Keys
All tables use UUID PKs consistent with existing schema. Use the `HasUuids` trait on all new models.

### 3. Sensitive Data Encryption
Bank account numbers, tax IDs, and salary amounts at the row level should use Laravel's `encrypted` cast. At rest, the database volume should be encrypted (infrastructure concern). In transit, all API calls are HTTPS.

### 4. Background Jobs for Heavy Computation
- Attendance generation: runs as a scheduled job, not on every API request
- Pay run calculation: dispatched as a job (can take minutes for large orgs)
- Compliance report generation: dispatched as a job
- Document expiry checks: daily scheduled job

All jobs must follow existing patterns: `$tries`, `$timeout`, `$backoff`, `failed()` handler.

### 5. Notification System
HR workflows require notifications (leave request submitted, approved, rejected; review cycle launched; document expiring). Use Laravel Notifications with database + mail channels. Add a `notifications` table if not already present. Consider Reverb WebSocket for real-time notification bell in the web dashboard.

### 6. File Storage
Employee documents, receipts, offer letters, policy documents all go to S3 (same bucket as screenshots, different prefix). Use signed URLs for secure access. Virus scanning on upload.

### 7. PDF Generation
Payslips, offer letters, compliance reports require PDF generation. Use `barryvdh/laravel-dompdf` or `spatie/laravel-pdf` (Browsershot-based for better rendering). Generate in background jobs, store in S3.

### 8. Permissions
New HR permissions to add to the permission system:

```
# Leave Management
leave.view_own, leave.apply, leave.view_team, leave.approve, leave.manage_types, leave.manage_policies, leave.manage_balances

# Employee Records
employee.view_directory, employee.view_detail, employee.edit_own, employee.edit_all, employee.manage_documents

# Attendance
attendance.view_own, attendance.view_team, attendance.regularize, attendance.approve_regularization, attendance.manage_rules

# Payroll
payroll.view_own_payslip, payroll.manage_salary, payroll.run_payroll, payroll.view_all

# Onboarding
onboarding.view, onboarding.manage_templates, onboarding.complete_items

# Performance
performance.view_own, performance.review_team, performance.manage_cycles, performance.manage_goals

# Offboarding
offboarding.initiate, offboarding.manage, offboarding.view_settlement

# HR Admin
hr.manage_departments, hr.manage_positions, hr.manage_policies, hr.manage_announcements, hr.manage_tickets, hr.manage_benefits, hr.manage_recruitment
```

### 9. API Versioning
All new endpoints under `/api/v1/`. If breaking changes are needed later, create `/api/v2/` rather than modifying v1.

### 10. Frontend Navigation
The sidebar currently has 3 nav groups (Main / Analytics / Team). Add a 4th group: **HR** (visible based on role and plan). Contains: Leaves, Attendance, Payroll, Employees, Performance, and sub-items. Use the existing shadcn Sidebar component with role-based filtering.

### 11. Plan Gating
HR features should be gated by organization plan tier:

| Plan | HR Features Included |
|---|---|
| Free / Starter | None (time tracking only) |
| Professional | Leave management, attendance |
| Business | + Payroll, onboarding, offboarding, employee records |
| Enterprise | + Performance, recruitment, benefits, compliance, helpdesk |

Check plan in middleware or policy layer, not in controllers.

### 12. Migration Strategy
New migrations should follow the existing naming convention: `YYYY_MM_DD_NNNNNN_description.php`. Group related tables into single migration files where they have foreign key dependencies (e.g., leave_types + leave_policies + leave_balances + leave_requests in one migration). This keeps rollback atomic.

---

## Summary of Effort Estimates

| Module | Priority | Effort | Backend | Frontend | Timeline |
|---|---|---|---|---|---|
| 12. Organization Structure | P1 | S | 1w | 1w | Month 1 |
| 2. Employee Records | P0 | M | 2w | 1w | Month 1-2 |
| 1. Leave Management | P0 | L | 2w | 2w | Month 1-2 |
| 3. Attendance (HR) | P0 | M | 2w | 1w | Month 2-3 |
| 5. Onboarding | P1 | M | 1.5w | 1w | Month 3 |
| 4. Payroll | P1 | XL | 3w | 2w | Month 3-4 |
| 6. Performance | P2 | L | 2w | 2w | Month 4-5 |
| 7. Offboarding | P2 | M | 1.5w | 1w | Month 5 |
| 8. HR Communication | P2 | M | 1.5w | 1w | Month 5-6 |
| 11. Compliance | P2 | M | 1.5w | 1w | Month 5-6 |
| 9. Recruitment / ATS | P3 | XL | 3w | 3w | Month 6-7 |
| 10. Benefits | P3 | L | 2w | 1.5w | Month 7-8 |

**Total estimated engineering effort:** ~23 backend-weeks + ~16 frontend-weeks

**Recommended team size:** 2 backend engineers + 1 frontend engineer = ~8 months calendar time with buffer for testing, iteration, and integration work.
