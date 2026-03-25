---
name: backend
description: "Delegate Laravel backend tasks to the backend-engineer agent. Use for API endpoints, services, migrations, jobs, policies, query optimization, or any work in the /backend directory."
---

# Backend Engineer

Delegate this task to the `backend-engineer` agent using the Agent tool with `subagent_type: "backend-engineer"`.

## Scope

- Laravel API endpoints (`backend/app/Http/Controllers/Api/V1/`)
- Service layer (`backend/app/Services/`)
- Database migrations (`backend/database/migrations/`)
- Queue jobs (`backend/app/Jobs/`)
- Authorization policies (`backend/app/Policies/`)
- Route definitions (`backend/routes/api.php`)
- Query optimization, Eloquent models, relationships

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
