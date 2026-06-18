# Web — Saving Timezone in Settings Empties the Sidebar

**Status:** ✅ FIXED 2026-06-18 (on branch `chore/desktop-electron-42-upgrade`, uncommitted) — `web` typecheck clean.
**Reported:** 2026-06-18 (QA, production instance)
**Investigated:** 2026-06-18

## Resolution summary (2026-06-18)

The fix targets the systemic root cause (destructive auth-state mutators), not the timezone trigger:

1. **`fetchUser()` is no longer destructive on transient failures** — `web/src/stores/auth-store.ts`.
   The `catch` now clears `user`/`permissions` **only on HTTP 401/403** (genuine auth rejection). Network
   errors, timeouts, 5xx, and cancelled/aborted requests (axios `ERR_CANCELED`, no `response.status`) leave
   the session intact. The success path only calls `setPermissions` when the response carries a **non-empty**
   permission map, so a 200 that omits permissions can't blank the nav. (Uses `axios.isAxiosError`.)
2. **`setUser()` no longer blanks permissions** — `web/src/stores/auth-store.ts`. It now calls
   `setPermissions` only when the user object carries a non-empty map. Profile/timezone update responses
   that omit `permissions` (fed in via `saveProfileMutation` / the timezone merge) no longer empty the sidebar.
3. **Timezone mutation merges locally instead of re-fetching** — `web/src/app/(dashboard)/settings/page.tsx`.
   `updateProfileMutation` now uses the `PATCH /auth/me` response (or a local `{ ...user, timezone }` merge)
   via `setUser`, removing the `fetchUser()` round-trip for a write that can't affect permissions/org.
   The org-settings `updateMutation` still calls `fetchUser()` (it needs the refreshed org name) — now safe
   because of fix #1.
4. **Layout self-heals** — `web/src/app/(dashboard)/layout.tsx`. The empty-permissions recovery effect is
   now keyed on the empty condition (`permissionsEmpty`), not just `isAuthenticated`, so the nav re-fetches
   whenever permissions go empty while authenticated — defence in depth behind fix #1.

**Verification:** `npx tsc --noEmit` clean in `/web`. Only pre-existing deprecation hints remain (unrelated).
**Files changed:** `web/src/stores/auth-store.ts`, `web/src/app/(dashboard)/settings/page.tsx`,
`web/src/app/(dashboard)/layout.tsx`.

---
**Scope:** Web dashboard (Next.js) — auth/permission state ↔ permission-gated sidebar nav
**Severity:** P1 — core navigation becomes unusable after a transient `fetchUser()` failure; only a full re-login recovers it.

## Symptom (as reported)

> "I opened the Settings tab on the web portal and updated the timezone and clicked Save.
> The side panel gets hidden — not hidden but becomes empty. It got fixed after logging out
> and logging back in."

The sidebar **shell still renders** (header/avatar/footer intact) but the **nav body is blank** —
every navigation group disappears. Logging out and back in restores it.

> **Important — the timezone save is the _trigger QA happened to hit_, not the bug.** The defect is a
> destructive `fetchUser()` that wipes auth + permission state on **any** failure. Any flow that runs
> `fetchUser()` and hits a transient error (cancelled in-flight request, 5xx, token-refresh race,
> a slow network, **or any other update API call**) produces the same blank sidebar. Scoping the fix to
> the timezone mutation would leave the rest of the app exposed.

## Root cause

The sidebar nav is filtered **entirely by the permission store** (`usePermissionStore.permissions`),
not by `user.role`. The real defect is that **`fetchUser()` is destructive on failure**: its `catch`
block **unconditionally** calls `set({ user: null, isAuthenticated: false })` **and** `clearPermissions()`
on _any_ error — no distinction between a genuine auth rejection (401/403) and a transient/aborted/5xx
request. Once `permissions` becomes `{}`, every nav group filters down to zero items and the sidebar
renders blank.

This is the same class of defect already fixed on the **desktop** side (per CLAUDE.md / `auth-and-idle-bugs.md`):
*do not treat a transient/aborted request as a genuine auth rejection.* The web `fetchUser()` never got
that guard.

### Blast radius — `fetchUser()` runs in three places, not just Settings

The timezone save is one of several triggers. `fetchUser()` is called from:

| Caller | When it runs | Why it matters |
|---|---|---|
| `web/src/app/(dashboard)/settings/page.tsx:213,224` | after timezone / org saves | the QA-reported trigger — but *any* settings update that ends in `fetchUser()` behaves identically |
| `web/src/app/(dashboard)/layout.tsx:81` | recovery effect on the dashboard layout | can re-trip the wipe it was meant to recover from |
| `web/src/hooks/use-auth-guard.ts:19` | **on essentially every dashboard mount** | a transient `/auth/me` blip on *any* page load blanks the sidebar — no settings save required |

Because `use-auth-guard` runs `fetchUser()` on routine navigation, this bug is reproducible **without
touching Settings at all** — a single flaky `/auth/me` (network hiccup, cancelled request, 5xx, refresh
race) is enough. The timezone path just makes it reliably reproducible because it forces a `fetchUser()`
immediately after another write.

### The chain

1. **Both timezone Save handlers call `fetchUser()` on success.**
   - "Your timezone" (General tab): `web/src/app/(dashboard)/settings/page.tsx:219-228`
     (`PATCH /auth/me { timezone }` → `await fetchUser()` at `:224`); button at `:722-734`.
   - Org "Save Changes" (Organization → Timezone): `web/src/app/(dashboard)/settings/page.tsx:207-217`
     (`PUT /settings` → `invalidateQueries(['org-settings'])` + `await fetchUser()` at `:212-213`); button at `:458-470`.
     The comment at `:213` ("Refresh auth store so sidebar/header shows updated org name") shows the intent —
     that refresh is exactly what corrupts the permission store.

2. **The sidebar is permission-gated, not role-gated.**
   `web/src/app/(dashboard)/layout.tsx:53` reads `permissions` from `usePermissionStore`; `:122-129` filters
   every group:
   ```ts
   const visibleItems = group.items.filter((item) =>
     item.requiredScope
       ? hasPermissionWithScope(item.requiredPermission, item.requiredScope)
       : hasPermission(item.requiredPermission)
   );
   if (visibleItems.length === 0) return null;   // line 129 — whole group vanishes
   ```
   Every item in `web/src/config/navigation.ts:46-110` declares a `requiredPermission`, and
   `hasPermission` (`web/src/stores/permission-store.ts:31-33`) is purely `key in permissions`. So
   `permissions === {}` ⇒ every item filtered out ⇒ every group returns `null` ⇒ empty `<SidebarContent>`.

3. **`fetchUser()` clears permissions on any error** — `web/src/stores/auth-store.ts:162-172`:
   ```ts
   fetchUser: async () => {
     try {
       const res = await api.get('/auth/me');
       set({ user: res.data.user, isAuthenticated: true });
       identifyUser(res.data.user);
       usePermissionStore.getState().setPermissions(
         res.data.user?.permissions ?? res.data.permissions ?? {});   // line 167 (falls back to {})
     } catch {
       set({ user: null, isAuthenticated: false });                   // line 169
       usePermissionStore.getState().clearPermissions();              // line 170 — wipes nav
     }
   }
   ```
   - **Path A (primary):** the bare `catch {}` has no status check — a transient/aborted `/auth/me`
     after save runs line 170 → `permissions = {}` → blank sidebar.
   - **Path B (secondary):** line 167 falls back to `{}` if `permissions` is absent on the response,
     overwriting a previously-good map. (The backend `userResponse()` *does* include `permissions` via
     `getPermissionMap()` — `backend/app/Http/Controllers/Api/V1/AuthController.php:681-712`,
     `backend/app/Services/PermissionService.php:35-42` — so Path B is unlikely on a healthy response,
     which points the finger at Path A.)

4. **Two persisted stores diverge.** `auth-store` persists `{ user, isAuthenticated }` under `auth-storage`
   (`auth-store.ts:259-262`); `permission-store` persists `{ permissions }` separately under
   `trackflow-permissions` (`permission-store.ts:52-56`). A failed `fetchUser()` wipes the permission store
   in memory while the auth store can still serve a logged-in `user` — producing the exact reported state:
   populated header/avatar, blank nav.

5. **Why logout/login fixes it.** `logout()` clears both stores (`auth-store.ts:146-160`); `login()`
   repopulates permissions from the fresh login response (`auth-store.ts:118-120`,
   `setPermissions(res.data.user?.permissions ?? …)`), which always carries the full map. So a fresh login
   deterministically restores the nav.

**Note:** this is *not* a partial-payload overwrite of `role`/`organization` — the persisted `user` stays
mostly intact. The defect is the **permission map being cleared** while the nav is **permission-gated**.

## Recommended fix

**THE fix (required) — make `fetchUser()` non-destructive on anything that isn't a genuine auth
rejection.** This is the only change that fixes the whole class of bug across all three callers
(Settings, layout recovery effect, and the per-mount auth guard). Mirror the desktop "don't logout on
network error" rule, `web/src/stores/auth-store.ts:168-171`:
```ts
} catch (err) {
  const status = (err as AxiosError)?.response?.status;
  // Only a genuine auth rejection (or an explicit cancellation we don't act on) clears state.
  if (status === 401 || status === 403) {
    set({ user: null, isAuthenticated: false });
    usePermissionStore.getState().clearPermissions();
  }
  // Transient errors (network, timeout, 5xx, cancelled/aborted request) MUST NOT wipe
  // user/permissions — the existing session is still valid. Optionally log + leave state intact.
}
```
Note the cancelled-request case explicitly: a `fetchUser()` that is aborted mid-flight (component
re-render, navigation, React strict-mode double-invoke, TanStack Query cancellation) throws an axios
`ERR_CANCELED` with **no** `response.status` — under the old `catch` that also wiped state. The guard
above (clear only on 401/403) covers it because a cancellation has no auth status.

**Supporting hardening (do alongside, not instead of, the above):**
- **Success path (`auth-store.ts:167`):** only call `setPermissions` when the response actually carries a
  permission map — never overwrite a good map with `{}`. Prevents the rare "200 with missing/empty
  permissions" from blanking the nav.
- **Don't over-fetch for writes that can't change auth state:** a timezone update changes neither
  permissions nor org name, so those mutations don't *need* a full `/auth/me` re-fetch. Replacing
  `await fetchUser()` at `settings/page.tsx:213,224` with a local `setUser({ ...user, timezone })` merge
  (as `saveProfileMutation` already does at `settings/page.tsx:263-266`) removes one trigger — but this is
  **a reduction of blast radius, NOT the fix.** The auth guard (`use-auth-guard.ts:19`) still runs
  `fetchUser()` on every dashboard mount, so without the `catch` guard the bug remains live on plain
  navigation. Do not ship this as the sole change.
- The layout's empty-permissions recovery effect (`layout.tsx:79-84`) is keyed only on `isAuthenticated`,
  so it won't re-run after a wipe. If kept as a safety net, add `Object.keys(permissions).length` to its
  trigger — but with the `catch` guard in place the wipe shouldn't happen in the first place.

## Key file:line references

| What | Location |
|---|---|
| "Your timezone" Save mutation (`PATCH /auth/me` → `fetchUser`) | `web/src/app/(dashboard)/settings/page.tsx:219-228`, button `:722-734` |
| Org "Save Changes" mutation (`PUT /settings` → `fetchUser`) | `web/src/app/(dashboard)/settings/page.tsx:207-217`, button `:458-470` |
| Auth store `fetchUser` (clears permissions on any error) | `web/src/stores/auth-store.ts:162-172` (catch `:168-171`) |
| Auth store persistence (separate from permissions) | `web/src/stores/auth-store.ts:259-262` |
| Permission store + persistence | `web/src/stores/permission-store.ts:23-58` (`hasPermission` `:31-33`) |
| Sidebar permission-based nav filtering | `web/src/app/(dashboard)/layout.tsx:122-129` (store read `:53`) |
| Nav config (every item permission-gated) | `web/src/config/navigation.ts:46-110` |
| Empty-permissions recovery effect (keyed only on `isAuthenticated`) | `web/src/app/(dashboard)/layout.tsx:79-84` |
| Backend response includes permissions (rules out payload-shape cause) | `backend/app/Http/Controllers/Api/V1/AuthController.php:681-712`; `backend/app/Services/PermissionService.php:35-42` |

All line references verified on branch `chore/desktop-electron-42-upgrade` (2026-06-18) — re-verify before fixing.
