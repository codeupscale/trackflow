---
name: backend
description: "Delegate Laravel backend tasks to the backend-engineer agent. Use for API endpoints, services, migrations, jobs, policies, query optimization, HR services (LeaveService, PayrollService, AttendanceService, OnboardingService, PerformanceService), or any work in the /backend directory."
---

# Backend Engineer

Delegate this task to the `backend-engineer` agent using the Agent tool with `subagent_type: "backend-engineer"`.

## Scope

- Laravel API endpoints (`backend/app/Http/Controllers/Api/V1/`)
- Service layer (`backend/app/Services/`) — thin controllers, thick services
- HR services: LeaveService, PayrollService, AttendanceService, OnboardingService, PerformanceService, RecruitmentService, DocumentService, OffboardingService, OrganizationService
- Database migrations (`backend/database/migrations/`)
- Queue jobs (`backend/app/Jobs/`) — always with $tries, $timeout, backoff(), failed()
- Authorization policies (`backend/app/Policies/`)
- FormRequest validation (`backend/app/Http/Requests/`)
- Route definitions (`backend/routes/api.php`)
- Encrypted casts for sensitive HR data (salary, bank details, tax IDs)
- Multi-step DB transactions for leave approval, pay run processing
- Query optimization, Eloquent models, relationships, eager loading

## Rules the agent follows

- Multi-tenancy: every query scoped by `organization_id`
- Thin controllers (max ~30 lines), thick services
- All list endpoints paginated (never `->get()` unbounded)
- Response envelope: `{ "data": [...], "meta": {...} }`
- Jobs must have `$tries`, `$timeout`, `$backoff`, `failed()` handler

## Invocation

```
/backend <describe the backend task>
```
