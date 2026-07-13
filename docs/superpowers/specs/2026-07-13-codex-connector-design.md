# Codex connector — design decision (2026-07-13)

## Problem

`adapterKey: codex` existed in the schema but had no real execution path: the engine
routes all non-pi agents through ACP, and codex had no ACP preset (the codex CLI has
no native ACP mode). Codex steps silently fell back to the mock executor unless the
author hand-wired `payload.acpCommand`.

## Options considered

1. **ACP preset via the `codex-acp` bridge** (chosen) — add `codex` to
   `ACP_COMMAND_PRESETS` pointing at the `codex-acp` binary from
   `@agentclientprotocol/codex-acp` (the maintained successor to
   `@zed-industries/codex-acp`). Everything downstream (engine routing, preflight,
   mock-fallback warnings, doctor) keys off the preset table, so the change is small
   and consistent with the repo's "all non-pi agents run through ACP" direction.
2. **Bespoke `codex exec` subprocess executor** — a `codexExecutor.ts` modeled on the
   deprecated claude-code/opencode executors, spawning `codex exec --json`. First-party
   interface, but reintroduces a bespoke protocol the repo explicitly deprecated in
   favor of ACP. Kept as a fallback if the bridge proves unreliable.

Both bridge packages were smoke-tested with a live ACP initialize handshake before
deciding; `@agentclientprotocol/codex-acp` 1.1.2 handshakes cleanly and exposes codex's
own auth methods (ChatGPT login / API key), so no API key env vars are inferred for
codex steps — same policy as pi and other ACP agents.

## Decisions

- `codex` preset: `{ command: "codex-acp", args: [] }`. Install with
  `npm install -g @agentclientprotocol/codex-acp`. Overridable per step via
  `payload.acpCommand` / `acpArgs` or `WFM_ACP_COMMAND`.
- Default permissions stay `acpPermissions: allow` (workspace-write behavior): codex
  can read/edit files and run commands in the step's cwd unattended.
- `wfm doctor` gains an optional `codex-acp` binary check.
- The ACP client library was migrated from the deprecated
  `@zed-industries/agent-client-protocol@0.4.5` to `@agentclientprotocol/sdk@1.2.1`
  (same API surface, import rename only). The old library rejected codex-acp's
  `session_info_update` notification with a noisy JSON-RPC "Invalid params" dump on
  every codex step; the current SDK understands it.

## Verification

- TDD: preset/preflight assertions written first, full unit suite green (209 tests).
- Live e2e: a one-step workflow with `adapterKey: codex`, `useRealAdapter: true` ran
  a real codex turn through the bridge and returned the expected output in ~3s.
