# TrackFlow Product Guide

## The Complete Workforce Management Platform

---

## Executive Overview

Every growing company hits the same inflection point: spreadsheets stop working. Time tracking lives in one tool, leave requests in email threads, payroll in Excel, and attendance in a biometric system that nobody trusts. Managers spend hours reconciling data across systems instead of leading their teams. Employees resent the friction of logging into five different portals to do basic things like checking their leave balance or viewing a payslip.

TrackFlow replaces all of it with a single platform.

TrackFlow is a workforce time tracking, activity monitoring, and HR management platform built for companies with distributed teams. It combines the precision of a desktop time tracker with the depth of an HR suite, so organizations can manage time, monitor productivity, process payroll, handle leave requests, and maintain compliance from one unified system.

### Who TrackFlow Is For

- **Remote-first companies** that need visibility into distributed team productivity without invasive surveillance
- **IT services and consulting firms** billing clients by the hour and needing accurate, auditable time records
- **Growing companies (50-500 employees)** outgrowing spreadsheets for HR processes but not ready for enterprise-grade complexity
- **Agencies and freelancer teams** managing multiple projects across multiple clients
- **Companies with hybrid or shift-based workforces** that need attendance tracking, shift scheduling, and overtime management

### What Problem TrackFlow Solves

The average mid-size company uses 4-6 separate tools for workforce management: a time tracker, an HR system, a payroll tool, a leave management spreadsheet, a shift scheduler, and an attendance system. These tools do not talk to each other. Data is duplicated, reconciled manually, and inevitably wrong.

TrackFlow consolidates these into one platform where time entries feed attendance records, attendance feeds payroll, leave balances update automatically, and every piece of data flows to the right report without manual intervention.

---

## Platform Overview

TrackFlow runs on three surfaces, each designed for a specific user and context.

### Web Dashboard

The web dashboard is the command center for managers, HR teams, and administrators. Built with server-side rendering for fast initial loads, it provides real-time visibility into team activity, comprehensive reporting, and full HR management capabilities.

Managers see their team's status at a glance: who is online, what they are working on, current activity levels, and hours logged today. HR administrators manage the complete employee lifecycle from the same interface: onboarding, leave management, attendance, shifts, payroll, and offboarding.

Employees use the web dashboard for self-service: applying for leave, viewing payslips, checking attendance records, submitting regularization requests, and managing their own profile and documents.

### Desktop Agent

The desktop agent is a lightweight application that runs on macOS, Windows, and Linux. It captures time, activity, and screenshots with minimal system impact.

The agent is built on a local-first architecture. Every timer start, stop, and activity measurement is written to a local database before syncing to the server. If the network drops, the agent continues tracking. When connectivity returns, it reconciles automatically. No data is lost, even if the laptop crashes or the WiFi goes down for hours.

The agent runs in the system tray and stays out of the way. Employees interact with it primarily to start and stop timers, switch projects, and respond to idle alerts.

### Mobile (Coming Soon)

A mobile application for iOS and Android is in development, bringing time tracking, leave applications, and approval workflows to phones and tablets. GPS-based attendance and on-site clock-in capabilities will be included.

---

## Feature Deep-Dive

### Time Tracking

TrackFlow's time tracker is built for accuracy and reliability above all else.

**Live Timer with Local-First Architecture**
Start a timer, and it begins recording immediately on your device. The timestamp is written to a local database before the server is contacted. This means your time is captured even if the network fails at the exact moment you click "Start." When the server is reachable, the local timestamp is synchronized and becomes the authoritative record. Duplicate entries are impossible thanks to unique idempotency keys on every timer event.

**Project and Task Switching**
Switch between projects with a single click. The transition is atomic: your current entry stops and the new one starts in a single operation with no time gap. There is no lost time between projects.

**Manual Time Entry**
Need to log time after the fact? Manual entries can be submitted with project, task, date, time range, and notes. Organizations can enable or disable manual entry at the admin level. All manual entries go through an approval workflow so managers maintain oversight.

**Timesheet Review**
Employees submit timesheets for manager review. Managers can approve, request changes, or reject entries with comments. The entire approval chain is logged.

**Smart Safeguards**
A 12-hour maximum cap prevents runaway timers. If you forget to stop tracking at the end of the day, the system catches it. Real-time elapsed time displays on the dashboard so you always know where you stand.

### Activity Monitoring

TrackFlow measures productivity without being invasive. Every monitoring feature is configurable at the organization level, so companies choose the level of visibility that fits their culture.

**Activity Scoring**
Activity is measured in active seconds using the same model as industry leaders. Every 30 seconds, the system checks whether there was keyboard or mouse input. The result is expressed as a percentage: 80% activity in an hour means 48 minutes of active input detected. This approach counts engagement, not raw keystroke volume. An employee thoughtfully composing an email and one rapidly clicking through tabs both register as active.

**Application and Window Tracking**
TrackFlow records which applications and window titles are active during tracked time. This data appears in reports so managers can see time distribution across tools. Application tracking uses platform-native methods: AppleScript on macOS, PowerShell on Windows, and xdotool on Linux, for reliable detection without elevated permissions.

**URL Tracking**
For organizations that need browser-level visibility, URL tracking captures which websites are visited during work hours. This feature is off by default and must be explicitly enabled at the organization level.

**Idle Detection**
TrackFlow detects when a user stops providing input and handles it intelligently. The idle detector runs a configurable state machine with three modes:

- **Prompt mode**: After a configurable idle period, the employee is asked whether to keep the idle time, discard it, or reassign it to a different project
- **Always keep**: Idle time is automatically counted as work (suitable for roles involving reading, phone calls, or in-person meetings)
- **Never track**: Idle time is automatically discarded

### Screenshot Capture

Screenshots provide visual verification of work activity. TrackFlow's screenshot system is built for reliability, privacy, and fairness.

**Multi-Monitor Capture**
Each connected display is captured individually as a separate image. This is more accurate than the composited approach used by some competitors, where multiple monitors are stitched into a single image that is difficult to read.

**Configurable Intervals**
Screenshots are captured at configurable intervals: every 5, 10, or 15 minutes. A first-capture delay prevents an immediate screenshot when the timer starts, giving employees a moment to prepare their workspace.

**Privacy Controls**
Organizations can enable screenshot blur, which applies a privacy filter to captured images. The blur is applied server-side, so the original image never leaves the processing pipeline unprotected. Screenshots are accessible only through time-limited signed URLs, never through direct links.

**Reliability**
A circuit breaker prevents the screenshot system from consuming resources when captures are failing (for example, due to permission issues). After 5 consecutive failures, the system pauses for 5 minutes before retrying. This prevents the agent from degrading system performance.

### Offline Resilience

TrackFlow is designed for the real world, where WiFi drops in coffee shops, VPNs disconnect, and laptops go to sleep mid-session.

**Local-First Data Storage**
All tracking data is stored locally before being sent to the server. Timer events, activity measurements, and screenshot files are queued in a local database. The queue syncs with exponential backoff: 5 seconds, then 15, then 30, then 60, up to a 2-minute cap. When the connection is restored, the backoff resets and data flows immediately.

**Sleep and Wake Handling**
When a laptop goes to sleep, TrackFlow records the moment of suspension. On wake, it calculates the gap and compares it to the idle threshold. A long sleep triggers the idle prompt. A short sleep resumes tracking normally. After any wake event, the system reconciles local and server state.

**Platform-Aware Networking**
Network detection varies by operating system. On macOS and Linux, the system uses native connectivity checks. On Windows, where native checks can report false positives, TrackFlow adds a ping-based fallback to verify actual internet access before attempting to sync.

### Reports and Analytics

TrackFlow provides eight report types that cover every angle of workforce productivity.

**Summary Report**: Organization-wide or per-employee overview of hours, activity, and projects for any date range.

**Team Report**: Per-user breakdown within a team, showing individual hours, activity percentages, and project distribution side by side.

**Project Report**: Hours logged per project with member-level detail. Essential for client billing and project budget tracking.

**Application Usage Report**: Time spent in each application, ranked by duration. Helps identify tool adoption and potential distractions.

**Day Timeline**: Hour-by-hour visualization of a single day, showing tracked periods, idle gaps, activity levels, and screenshots in context.

**Activity by Day of Week**: Weekly pattern analysis showing which days are most and least productive across the team.

**Detailed Time Logs**: Paginated, filterable list of every time entry with project, task, duration, and activity score.

**Payroll Report**: Hours and earnings calculated per employee for a pay period, ready for payroll processing.

All reports can be exported as PDF or CSV. Exports run asynchronously so large datasets do not block the interface.

### HR Suite

TrackFlow's HR modules transform the platform from a time tracker into a complete workforce management system.

#### Leave Management

Employees apply for leave through a self-service portal that shows their current balance by leave type before they submit. The system validates the request against available balance, checks for overlapping approved leaves, and flags if too many team members are already off on the requested dates.

Managers review leave requests with full context: the employee's leave history, team calendar, and current balance. Approvals and rejections include comments and are logged with timestamps.

Organizations configure their own leave types (annual, sick, casual, maternity, paternity, compensatory off, and more), each with its own balance rules, accrual rates, and carryover policies. Public holidays are managed per organization and automatically excluded from leave calculations.

Self-approval is prevented at the system level. A manager cannot approve their own leave request regardless of their permission level.

#### Employee Records and Documents

Every employee has a digital profile containing personal, professional, and financial information. Financial fields like bank account numbers and tax IDs are encrypted at rest using AES-256-GCM. The raw values never appear in API responses.

Employees upload documents (ID cards, certifications, tax forms) through the self-service portal. HR verifies and approves submissions. All documents are stored securely with access controlled through time-limited signed URLs. The original file paths are never exposed.

Confidential employee notes are visible only to authorized HR personnel, with filtering based on the viewer's role.

#### Attendance

Daily attendance records are generated automatically from time tracking data. The system evaluates each employee's tracked hours against their assigned shift and marks them as present (4+ hours), half-day (2-4 hours), or absent (under 2 hours). Public holidays, weekends, and approved leave days are recognized automatically.

When an employee forgets to clock in or has a discrepancy, they submit a regularization request with a reason. Their manager reviews and approves or rejects the correction.

Overtime rules are configurable per organization: daily overtime thresholds, weekly caps, and multiplier rates. The attendance system calculates overtime automatically based on these rules.

#### Shift Management

Organizations define shift templates with start time, end time, break duration, grace period, and timezone. Shifts are assigned to employees with overlap prevention: the system will not allow an employee to be assigned to two shifts simultaneously.

A 7-day roster view shows the entire team's schedule at a glance. Shift swap requests let employees exchange shifts with manager approval.

Grace periods are deducted from late calculations, so an employee arriving 5 minutes late to a shift with a 10-minute grace period is not marked as late.

#### Payroll

TrackFlow includes a payroll engine that processes salary calculations from attendance and time tracking data.

Salary structures define compensation models: monthly, hourly, or daily. Pay components break down earnings and deductions: base salary, housing allowance, transport allowance, tax deductions, insurance, bonuses, and more. Each component can be a fixed amount or a percentage of base salary.

Payroll periods move through a controlled workflow: draft, processing, approved, and paid. Running payroll generates individual payslips with line-item breakdowns. Payslips include gross earnings, itemized deductions, itemized allowances, and net pay.

Access is controlled through seven granular permissions covering viewing (own payslips, team payslips, all payslips), running payroll, managing structures, managing components, and approving payroll.

### Organization Structure

Departments are organized in a recursive hierarchy. The org tree endpoint renders the full structure in a single call for visualization. Positions are defined within departments with encrypted salary bands that are never exposed in API responses.

### Access Control and Permissions

TrackFlow uses role-based access control with hierarchical scopes. Permissions operate at three levels: own (the employee's own data), team (the manager's direct reports), and organization (all data within the org).

Administrators create custom roles and assign specific permissions. The frontend enforces permissions through a gate component that prevents unauthorized content from rendering, while the backend enforces them through policy classes on every API endpoint.

---

## Security and Compliance

### Data Encryption
All sensitive data is encrypted at rest. Employee financial information (bank accounts, tax IDs) uses AES-256-GCM encryption. Salary band data on positions is encrypted. Custom base salary assignments are encrypted. Data is decrypted only at the service layer and never exposed raw in API responses.

### Authentication
TrackFlow supports three authentication methods:
- Email and password with secure token management
- Google OAuth for both web and desktop (desktop uses system browser flow)
- SAML2 Enterprise SSO with support for Okta, Azure AD, and OneLogin

Access tokens expire after 24 hours. Refresh tokens last 30 days. Token refresh is proactive: the system refreshes before expiration to prevent session interruption.

### Multi-Tenancy
Every database query is scoped by organization. A global scope on all models ensures that data from one organization is never accessible to another. This isolation is enforced at the ORM level, not just the application level.

### GDPR Compliance
TrackFlow provides full GDPR support:
- **Data Export**: Employees can export all their personal data in a portable format
- **Account Deletion**: Deletion anonymizes personally identifiable information while preserving aggregate records needed for compliance
- **Data Retention**: Configurable retention periods with automated enforcement
- **Consent Recording**: All consent actions are logged with timestamps

### Audit Trail
Every significant action in the system is logged: data changes, approvals, access events, permission changes, and administrative actions. The audit log covers 30+ action types and retains records for 2 years. This provides a complete chain of accountability for compliance audits.

### Desktop Security
The desktop agent runs with strict security settings: context isolation is enabled, Node.js integration is disabled in renderer processes, and all communication between the interface and the system layer goes through a secure bridge. Token storage uses AES-256-GCM encryption rather than OS keychain integration, ensuring consistent behavior across all platforms without permission popups.

---

## Platform Requirements

### Web Dashboard
- Any modern browser (Chrome, Firefox, Safari, Edge)
- No installation required

### Desktop Agent
- **macOS**: 10.15 (Catalina) or later
- **Windows**: Windows 10 or later
- **Linux**: Ubuntu 18.04+, Fedora 30+, or equivalent
- Automatic updates delivered through the application

### Server Infrastructure
- Self-hosted or cloud-hosted options
- PostgreSQL database
- Redis for caching and real-time features
- S3-compatible storage for screenshots and documents

---

## Getting Started

### Step 1: Create Your Organization
Sign up at trackflow.app with your work email. Your organization is created automatically, and you receive a 14-day free trial with full access to all features.

### Step 2: Invite Your Team
Navigate to Team Management and send email invitations to your team members. Each invitation includes a role assignment (employee, manager, or administrator). Invitations expire after a configurable period and can be resent.

### Step 3: Set Up Projects
Create projects that reflect your work structure. If you bill by the hour, create a project per client. If you manage internal teams, create projects per department or initiative. Assign team members to the relevant projects.

### Step 4: Install the Desktop Agent
Download the desktop agent for your operating system from the Settings page. The agent installs in under a minute and appears in your system tray. Sign in with your TrackFlow credentials or Google account.

### Step 5: Start Tracking
Click "Start" in the desktop agent, select your project, and begin working. The agent captures time, activity, and screenshots according to your organization's settings. Your data appears on the web dashboard in real time.

### Step 6: Configure HR Modules
If your organization uses TrackFlow for HR management, set up departments, positions, leave types, shift templates, and salary structures through the web dashboard. These modules are optional and can be enabled as your needs grow.

### Step 7: Review and Report
Use the dashboard to monitor team activity, review timesheets, and generate reports. Export data for client billing, payroll processing, or compliance documentation.

---

## Pricing

TrackFlow uses per-seat pricing with a 14-day free trial. All features are included in every plan. Billing is managed through a self-service dashboard with full invoice history. Contact sales@trackflow.app for enterprise pricing on teams of 100+.

---

*TrackFlow. Time tracking, activity monitoring, and HR management. One platform. Every team.*
