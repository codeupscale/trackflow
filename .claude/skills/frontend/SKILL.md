---
name: frontend
description: "Delegate Next.js web dashboard tasks to the frontend-engineer agent. Use for React components, pages, Zustand stores, TanStack Query hooks, styling, or any work in the /web directory."
---

# Frontend Engineer

Delegate this task to the `frontend-engineer` agent using the Agent tool with `subagent_type: "frontend-engineer"`.

## Scope

- Next.js pages (`web/src/app/(dashboard)/*/page.tsx`)
- React components (`web/src/components/`)
- Zustand stores (`web/src/stores/`)
- API client (`web/src/lib/api.ts`)
- TanStack Query hooks and mutations
- Tailwind CSS styling, shadcn/ui components
- Real-time subscriptions (Laravel Echo)

## Rules the agent follows

- Data fetching: TanStack Query only (never raw `useEffect + fetch`)
- State: Zustand stores, cleanup on unmount/logout
- SSR safety: `typeof window !== 'undefined'` guards
- Error handling: every query renders loading + error states
- Role-based: early return for unauthorized roles

## Invocation

```
/frontend <describe the frontend task>
```
