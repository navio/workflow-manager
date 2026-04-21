# Supabase Foundation

This directory contains the local and remote Supabase foundation for the remote registry project.

## Local development

Start the local stack:

```bash
bun run supabase:start
```

Reset the local database and apply migrations/seeds:

```bash
bun run supabase:db:reset
```

Show local service status:

```bash
bun run supabase:status
```

Stop the local stack:

```bash
bun run supabase:stop
```

## Current remote project

- project name: `workflow-manager-remote-registry`
- project ref: `whairnylpdvxxgbygbzu`
- region: `us-east-1`
- project url: `https://whairnylpdvxxgbygbzu.supabase.co`

## Deployed Edge Functions

- `create-cli-token` (custom token/JWT auth)
- `auth-whoami` (custom token/JWT auth)
- `list-cli-tokens` (custom token/JWT auth)
- `manage-workflow` (custom token/JWT auth)
- `refresh-workflow-stats` (custom token/JWT auth)
- `revoke-cli-token` (custom token/JWT auth)
- `publish-workflow` (custom token/JWT auth)
- `pull-workflow` (public + custom token/JWT auth)
- `search-workflows` (public + custom token/JWT auth)
- `workflow-analytics` (custom token/JWT auth)

Redeploy all current functions:

```bash
bun run supabase:functions:deploy
```

## Milestone 1 scope

- project config in `supabase/config.toml`
- schema migrations in `supabase/migrations/`
- seed data in `supabase/seed.sql`
- Edge Functions in `supabase/functions/`

## Milestone 5 ops additions

- aggregation SQL functions for `workflow_daily_stats`
- `rate_limit_events` table for action throttling
- `registry_operation_logs` table for operational visibility
- `refresh-workflow-stats` function for owner-triggered analytics refresh
