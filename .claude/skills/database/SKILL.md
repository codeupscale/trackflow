---
name: database
description: "Delegate database tasks to the database-architect agent. Use for schema design, migrations, query optimization, indexing strategy, data retention, or PostgreSQL performance tuning."
---

# Database Architect

Delegate this task to the `database-architect` agent using the Agent tool with `subagent_type: "database-architect"`.

## Scope

- Schema design and migrations (`backend/database/migrations/`)
- Index strategy and query optimization
- `EXPLAIN ANALYZE` for slow queries
- Multi-tenant data isolation (org_id scoping)
- Data retention policies
- PostgreSQL 18 features and tuning

## Rules the agent follows

- UUID primary keys on all tables
- `organization_id` on every tenant-scoped table
- Time entry queries (1M rows) must complete in <500ms
- Always provide `EXPLAIN ANALYZE` evidence for optimizations
- Migrations must be reversible (`down()` method)

## Invocation

```
/database <describe the database task>
```
