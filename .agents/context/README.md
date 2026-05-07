# Agent Context

This directory stores durable business/product context that future agent runs should read before making changes.

## Layout

- `business/`: stable product context and domain rules.
- `prds/`: implemented or approved PRDs that explain intent and constraints.
- `scratch/`: optional temporary notes that can be replaced or removed.

## How To Use

- Keep docs short, explicit, and decision-focused.
- Prefer one topic per file.
- Include dates and current status.
- When shipping a feature from a PRD, move it (or summarize it) into `prds/` so future runs can pick it up.

## Suggested Frontmatter (Optional)

```md
Status: implemented | active | draft
Owner: <team-or-person>
Last Updated: YYYY-MM-DD
Related PR: #<number>
```
