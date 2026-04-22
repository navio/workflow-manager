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

Shared helpers live in `_shared/`.

Operational helpers now include:

- rate limit enforcement
- registry operation logging
- workflow daily stats refresh hooks
- authenticated CLI run telemetry helpers
