# Configurable roles and permissions: design (not yet built)

Status: decisions agreed (see "Agreed answers"). All five build steps are written. The web screens are checked in the cloud only (type-check, build), not in a browser. It exists so the decisions below can be agreed before touching access control, which every endpoint depends on.

## Goal

A company owner can create their own roles (for example "Recruiter", "Payroll reviewer", "Branch HR") made of a chosen set of permissions, and assign them to people, without a code change. The five built-in roles keep working exactly as they do today.

## Where things stand today

- `Membership.roles` holds values from a fixed list (`COMPANY_OWNER`, `HR_ADMIN`, `MANAGER`, `EMPLOYEE`, `PAYROLL_ADMIN`).
- `ROLE_PERMISSIONS` in `modules/auth/permissions.ts` is a static map from role to permissions. `permissionsFor(roles)` and `hasPermission(roles, p)` read it.
- 43 call sites call `hasPermission(ctx.roles, ...)` (39 on `ctx.roles`, 3 on `req.tenantCtx!.roles`, 1 on a local `roles`). `requirePermission` and `/auth/me` use the same helpers.
- Module entitlements already remove permissions of modules a company has not been given.

## Decisions proposed

1. **Custom roles are additive.** A custom role only adds permissions; it never removes anything a built-in role grants. This keeps the existing matrix untouched and makes "what can this person do" easy to answer: built-in permissions plus the union of their custom roles.
2. **Storage.** New tenant collection `CustomRole { tenantId, name, description, permissions[], createdBy, timestamps }`, unique on `(tenantId, name)`, at most 20 per company. `Membership` gains `customRoleIds` (at most 3 per person). Built-in role names are reserved.
3. **Resolution.** `resolveTenant` loads the person's custom roles once per request and puts the combined set on the tenant context. `hasPermission` takes the context instead of the roles array, so the 43 call sites change mechanically from `hasPermission(ctx.roles, p)` to `hasPermission(ctx, p)`. Changes take effect on the next request; no re-login.
4. **Grantable permissions are a whitelist, not "everything".** Some permissions stay locked to built-in roles and cannot be put in a custom role:
   - `tenant:update`, `employee:roles` and the new role-management permission (company owner only).
   - `employee:sensitive:update` and `payroll:publish` are proposed as locked in the first release, because they move money or identity data. They can be opened later as an explicit decision.
   - Everything else (read, manage, review permissions per module) is grantable.
5. **No privilege escalation.** Only the company owner can create, edit or delete custom roles. The owner and HR admins can assign them, but an HR admin can assign a custom role only if every permission in it is one the HR admin already holds, and can never assign a role to themselves. Roles can include only whitelisted permissions.
6. **Modules still win.** A permission belonging to a module the company has not been given is dropped from the result, exactly as for built-in roles today.
7. **Safe deletion.** A role that is assigned to anyone cannot be deleted (409 with the count); it must be unassigned first. Every create, edit, delete and assignment is audited with before/after.
8. **Visibility.** `/auth/me` already returns the effective permission list, and the web `can()` already reads it, so custom permissions reach the UI without UI rewrites. Only the role-management screen is new.

## Build order (each step shippable and tested on its own)

1. DONE: mechanical refactor. `hasPermission` takes the tenant context (a bare roles array still works), `requirePermission` passes the context, and the context type has an optional `extraPermissions` set. No behaviour change; the existing tests are the safety net.
2. DONE: `CustomRole` model, `customRoleIds` on `Membership`, resolution in `resolveTenant` and in login / `/auth/me`, the lock list and module filtering (`modules/auth/customRoles.ts`), new owner-only `role:manage` permission. No way to create a role yet (that is step 3).
3. DONE: owner-only CRUD routes plus assignment, with the whitelist, limits, audit and 409 on deleting a role in use.
4. DONE (`tests/roles.test.ts`): tenant isolation (company A cannot see or use company B's roles), no escalation (HR cannot create or assign), locked permissions rejected, module gating, effect without re-login, authz-matrix extended.
5. DONE: web. A Roles page (owner only, under Company setup) and a Company roles picker in the employee Access tab. Settings > Roles (list, create/edit with grouped permission checkboxes, assign from the employee dialog).

## Agreed answers

- Payroll publishing and editing bank/ID details stay locked to built-in roles in the first release.
- The owner and HR admins may assign custom roles (with the no-escalation rule above); only the owner creates them.
- Limits of 20 roles per company and 3 per person stand unless you say otherwise.

## Not in scope

Per-record or per-department scoping (for example "HR for the Pune branch only"). That is a different mechanism (data scope, not permissions) and would be designed separately.
