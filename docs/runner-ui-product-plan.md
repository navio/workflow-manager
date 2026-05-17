# Runner UI Product Plan

## Product direction

Build a same-origin local dashboard for `wfm run` so users can watch, inspect, approve, resume, and cancel workflow execution without copying tokens into a separate web app.

The usability-first path is to serve the UI from the Runner API process itself:

```bash
wfm run ./workflow.json --ui --port 8765
# Runner UI: http://127.0.0.1:8765/ui/#runId=<run-id>&token=<ephemeral-token>
```

This keeps the normal user flow local, one-click, and CORS-free. The UI reads bootstrap data from the URL fragment, stores it only for the current tab/session, and calls the same-origin Runner API with the bearer token.

## Product goals

- Visualize the workflow as a color-coded graph with the current step highlighted.
- Show live run progress, step metadata, event history, and per-step logs.
- Let users approve, resume, or cancel a waiting run from the browser.
- Make the happy path one command plus one dashboard link.
- Keep the API local-only, in-memory, and ephemeral for this delivery.

## Non-goals for first delivery

- Starting workflows from the UI.
- Multi-run dashboards or persisted run history.
- Remote hosted access to local runners.
- Multi-user auth beyond the existing ephemeral bearer token.
- Editing workflow definitions in the UI.

## User experience

1. User starts a workflow with `--ui`.
2. CLI prints a dashboard URL and keeps running.
3. User opens the URL.
4. UI connects automatically from URL-fragment bootstrap data.
5. UI shows run header, graph, selected step detail, logs, and timeline.
6. If the run waits for approval, UI presents approve, resume, and cancel controls with optional note/actor fields.
7. UI updates live until the run succeeds, fails, or is cancelled.

## Core capabilities

- Same-origin static UI served at `/ui/*` by the Runner API.
- Bootstrap via URL fragment so token is not sent in HTTP logs or referrers.
- React Flow graph driven by `RunSnapshot` plus per-step details.
- SSE event stream with reconnect using `sinceSequence`.
- Snapshot refresh after meaningful events so the API remains the source of truth.
- Step detail drawer with dependencies, adapter, validation, attempts, timestamps, and config summary.
- Logs panel filtered by selected step.
- Event timeline with type, step, actor, time, and payload summary.
- Approval/resume/cancel controls with conflict handling.

## Known constraints

- Runner API currently represents one run per process.
- API state is in-memory and disappears when the runner exits.
- Graph dependencies require fetching `/runs/:runId/steps/:stepKey` for each step.
- Browser and runner are expected to be on the same machine because the API binds to `127.0.0.1`.
- Terminal prompts and UI actions can race; the UI must display 409 conflicts clearly.

## Milestones

### Milestone 1: Product contract

Deliverables:

- Finalize dashboard URL format: `/ui/#runId=<id>&token=<token>`.
- Define CLI flags: `--ui`, `--no-ui`, and optional later `--open-ui`.
- Define UI bootstrap behavior when fragment data is missing or invalid.
- Confirm API endpoints used by the UI:
  - `GET /session`
  - `GET /runs/:runId`
  - `GET /runs/:runId/steps/:stepKey`
  - `GET /runs/:runId/logs`
  - `GET /runs/:runId/events`
  - `POST /runs/:runId/approve`
  - `POST /runs/:runId/resume`
  - `POST /runs/:runId/cancel`

Definition of done:

- Product behavior is documented.
- API contract gaps are listed before UI build starts.
- Security model is explicit: local-only plus ephemeral bearer token.

### Milestone 2: Runner API static UI serving

Status: implemented in the runner API layer. The UI app assets are still produced by Milestone 3.

Deliverables:

- Serve bundled UI assets under `/ui/*` from the Runner API server.
- Ensure API routes continue to require `Authorization` except `/health` and static UI assets.
- Add safe static file handling for path traversal, content types, cache headers, and SPA fallback.
- Print `Runner UI: ...` when UI serving is enabled.
- Keep CORS optional rather than required for the same-origin happy path.

Definition of done:

- `GET /ui/` returns the app shell.
- `GET /ui/assets/...` returns static assets.
- API endpoints remain token-protected.
- Root runner tests cover static serving and auth boundaries.

### Milestone 3: Runner UI app foundation

Deliverables:

- Create `apps/runner-ui` with React, Vite, TypeScript, React Flow, and Bun tests.
- Build a small design system aligned with the existing product language.
- Implement bootstrap parsing from URL fragment and session-only storage.
- Implement a typed Runner client for snapshots, step details, logs, controls, and SSE.

Definition of done:

- UI can connect to a running API using URL bootstrap.
- UI shows an empty/loading/error state clearly.
- `bun --cwd apps/runner-ui build` succeeds.

### Milestone 4: Visual workflow graph MVP

Deliverables:

- Render steps as React Flow nodes.
- Render dependency edges from step details.
- Apply status colors:
  - `pending`: muted
  - `runnable`: accent outline
  - `running`: animated highlight
  - `waiting_for_approval`: warning halo
  - `succeeded`: success
  - `failed`: error
  - `cancelled`: muted strike state
- Highlight `currentStepKey` with a distinct ring.
- Select a node to open step details.

Definition of done:

- Users can understand workflow structure and current progress at a glance.
- Graph remains readable for linear workflows and small DAGs.
- Tests assert node status and current-step attributes.

### Milestone 5: Control UX

Deliverables:

- Show approval/resume/cancel bar when `waitingForApproval` is present.
- Include approval preview items when available.
- Add actor and note fields with defaults.
- Call approve, resume, or cancel endpoints with `source: "runner-ui"`.
- Display clear errors for 401, 404, and 409 responses.

Definition of done:

- A waiting run can continue from the UI.
- A waiting run can be cancelled from the UI.
- Race conditions with terminal approval produce a helpful conflict message.

### Milestone 6: Observability and review

Deliverables:

- Event timeline with live updates and replay from `sinceSequence`.
- Logs panel with stdout/stderr styling and step filter.
- Final summary after succeeded, failed, or cancelled status.
- Reconnect banner when SSE disconnects and recovery succeeds.

Definition of done:

- Users can review what happened before, during, and after execution.
- Log and event streams survive transient disconnects.
- Final state is visible without reading terminal output.

### Milestone 7: Packaging and CLI integration

Deliverables:

- Add root scripts for runner UI development, test, lint, and build.
- Build UI assets as part of package preparation.
- Include only required UI assets in published package contents.
- Add CLI output and flags for UI mode.
- Keep `dist/` and generated UI assets out of commits unless release policy requires them.

Definition of done:

- Source checkout flow works with Bun.
- Packed package contains the UI assets needed at runtime.
- `npm pack --dry-run` output is reviewed.

### Milestone 8: Test and validation suite

Deliverables:

- Runner API tests for `/ui` serving, SPA fallback, content types, and auth boundaries.
- Runner client tests for authorization headers, errors, controls, and SSE parsing.
- Graph rendering tests with `react-test-renderer`.
- Approval bar tests for request payloads and error display.
- Manual smoke checklist for mock and approval workflows.

Validation commands:

```bash
bun run lint
bun test tests/runnerApi.test.ts
bun --cwd apps/runner-ui test
bun --cwd apps/runner-ui build
bun run build
bun run package:check
```

Definition of done:

- Automated tests cover the critical product paths.
- Manual smoke confirms the one-command, one-link UX.

### Milestone 9: Documentation and beta release

Deliverables:

- Add a user guide for Runner UI usage.
- Update README quickstart with `--ui` flow.
- Document limitations, troubleshooting, and security model.
- Mark first release as local beta until large workflow UX is validated.

Definition of done:

- New users can discover and use the dashboard without reading source code.
- Known limitations are visible before adoption.
- The feature is ready for iterative product feedback.

## Strong implementation sequence

1. Implement static UI serving and dashboard URL output first.
2. Scaffold the UI and connect to `/session` plus `/runs/:runId`.
3. Add graph visualization with mocked and real snapshots.
4. Add approval/resume/cancel controls.
5. Add SSE, logs, and timeline.
6. Add packaging and docs.
7. Run full validation and manual smoke.

This order keeps each step demonstrable and prevents investing in graph polish before the same-origin product loop is proven.

## Risk register

- React Flow may be too heavy for package size; review bundle output after MVP.
- N+1 step detail fetches may be slow for large workflows; consider a future batch endpoint.
- URL fragment token is usable by page JavaScript; mitigate by same-origin local serving, no third-party scripts, and session-only storage.
- Static asset serving from the runner must avoid path traversal and should have focused tests.
- Large event/log streams may need UI virtualization in a later milestone.

## Future roadmap

- Batch step details endpoint.
- UI launch/open command.
- Run start form for local workflow files.
- Persisted local run archives.
- Graph search and minimap for large workflows.
- Export run report as JSON or Markdown.
