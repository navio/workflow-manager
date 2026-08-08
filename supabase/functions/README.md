# Supabase Edge Functions

This directory contains the remote-registry Edge Functions and shared helpers.

Implemented functions:

- `create-cli-token`
- `auth-whoami`
- `list-cli-tokens`
- `manage-workflow`
- `refresh-workflow-stats`
- `revoke-cli-token`
- `publish-workflow`
- `pull-workflow`
- `search-workflows`
- `workflow-analytics`
- `track-run-telemetry`
- `workflow-run-insights`
- `workflow-observability`

Shared helpers live in `_shared/`.

Operational helpers now include:

- rate limit enforcement
- registry operation logging
- workflow daily stats refresh hooks
- authenticated CLI run telemetry helpers

## workflow-run-insights vs workflow-observability

These two functions are intentionally separate, not layers of the same feature:

- `workflow-run-insights` is the authenticated caller's own-runs summary across every
  workflow they've run (their "My runs" view) — always their own raw rows.
- `workflow-observability` is scoped to one owned, published namespace/version and
  returns a two-part contract: an `owner` window (the owner's own runs of their own
  workflow — never suppressed, since it is already the requester's own data) and a
  `community` window plus `byRuntime`/`steps` breakdowns aggregated across *all* users,
  each independently suppressed below `k = 5` distinct authenticated users. See
  `doc/guide/observability.md` for the full privacy contract.

Do not merge these two response shapes — doing so risks quietly turning an owner's "my
runs" view into a vector for inferring another user's individual activity.
