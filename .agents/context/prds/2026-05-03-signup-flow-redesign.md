Status: implemented
Owner: remote-registry
Last Updated: 2026-05-06
Related PR: #38

# Signup Flow Redesign (Auth + Onboarding)

## Why

Signup/auth needed to be safer and clearer end-to-end, with explicit guard rails and regression tests.

## Implemented Scope

- Auth route flow:
  - sign up,
  - check email screen,
  - email confirm callback,
  - sign in,
  - password reset request + confirm.
- Route guards:
  - `RequireAuth` redirects unauthenticated users to `/auth?next=...`.
  - `RequireHandle` enforces handle onboarding for authenticated users without a handle.
- Onboarding:
  - handle claim page and validation,
  - reserved names and format/length constraints,
  - username namespace consistency for publish/pull flows.
- Dashboard first-run experience:
  - dismissible first-run panel,
  - persisted dismissal state.
- OAuth behavior:
  - Google auth button is env-gated and hidden unless enabled/configured.
- Supabase local email templates:
  - confirmation + recovery template updates.

## Data/DB Changes

- Added handle constraints migration:
  - `supabase/migrations/20260503000000_handle_constraints.sql`

## Testing Added

- Auth guard unit coverage.
- `next` redirect sanitization coverage.
- Handle utility coverage.
- Local auth smoke (signup/confirm/signin/reset).
- Local publish/pull smoke with owner-slug checks.

## Production Notes

- DB migrations and Edge Functions deploy via GitHub workflow on merge to `main`.
- Supabase auth dashboard settings/templates are still manual (no `supabase config push` in release workflow).
