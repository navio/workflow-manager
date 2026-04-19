# Remote Registry Agent Team

Status: proposed

This document defines the implementation agent team for the remote registry work inside the `workflow-manager` repository.

## Team Goal

Ship the remote workflow registry as an in-repo app plus CLI extension without breaking the existing local workflow engine.

## Team Structure

### Orchestrator

- Agent file: `.opencode/agent/remote-registry-orchestrator.md`
- Role: coordinate milestones, manage dependencies, and sequence cross-workstream deliveries

### Workstream A - Supabase Platform

- Agent file: `.opencode/agent/supabase-platform-engineer.md`
- Owns schema, migrations, RLS, seeds, and project bootstrap

### Workstream B - Edge Functions

- Agent file: `.opencode/agent/edge-functions-engineer.md`
- Owns token, publish, pull, search, and analytics APIs

### Workstream C - CLI Integration

- Agent file: `.opencode/agent/cli-registry-engineer.md`
- Owns `src/remote/`, config persistence, and CLI remote commands

### Workstream D - Web App

- Agent file: `.opencode/agent/remote-registry-ui-engineer.md`
- Owns `apps/remote-registry/`, auth flows, public pages, and dashboard UX

### Workstream E - Analytics And Operations

- Agent file: `.opencode/agent/analytics-ops-engineer.md`
- Owns download events, aggregation, observability, and abuse protection

### Workstream F - QA And Release

- Agent file: `.opencode/agent/qa-release-engineer.md`
- Owns integration tests, onboarding, previews, and release readiness

## Working Contract

- All agents work in the same git repository.
- The web product is an app under `apps/remote-registry/`.
- The CLI stays in the existing `workflow-manager` codebase.
- Supabase config lives in `supabase/`.
- The orchestrator owns milestone sequencing and handoff quality.

## First Implementation Slice

The team should validate the thinnest end-to-end path first:

1. Supabase schema for profiles, workflow namespaces, versions, and tokens
2. Edge Function for CLI token issuance
3. Edge Functions for publish and pull
4. CLI `auth login`, `publish`, and `pull`
5. Minimal `apps/remote-registry/` page for token creation

## Handoff Rules

- Schema changes land before API logic depends on them.
- Edge Function DTOs are reviewed with the CLI and UI agents before implementation expands.
- CLI and UI agents consume the same API shapes.
- QA and analytics agents review real integration flows before wider rollout.

## Agent Files

- `.opencode/agent/remote-registry-orchestrator.md`
- `.opencode/agent/supabase-platform-engineer.md`
- `.opencode/agent/edge-functions-engineer.md`
- `.opencode/agent/cli-registry-engineer.md`
- `.opencode/agent/remote-registry-ui-engineer.md`
- `.opencode/agent/analytics-ops-engineer.md`
- `.opencode/agent/qa-release-engineer.md`
