Status: active
Owner: remote-registry
Last Updated: 2026-05-06

# Remote Registry Business Context

## Product Goal

Provide a reliable workflow registry where creators can:

- authenticate securely,
- publish and manage workflows,
- share workflows publicly,
- pull and run workflows from CLI/web safely.

## Core User Journeys

- Creator signs up, confirms email, claims handle, then publishes.
- Existing creator signs in and manages versions, metadata, and tokens.
- Public user searches/pulls published workflows.

## Guardrails

- Handle ownership is a durable namespace contract.
- Public consumers must only receive published versions.
- Owners can see latest drafts for their own workflows.
- Auth and publish flows must have automated regression coverage.
