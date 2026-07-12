---
name: workflow-author
description: >
  Author repeatable wfm workflows from a task description, validate them, run
  them, and narrate progress as the workflow executes. Load this skill when a
  user describes a multi-step task that should run the same way every time —
  turn it into a wfm workflow file, validate it, and then drive `wfm run`
  while translating status polls and approval gates into plain-language
  updates for the user.
type: core
library: "@workflow-manager/runner"
sources:
  - "navio/workflow-manager:src/parser.ts"
  - "navio/workflow-manager:src/types.ts"
  - "navio/workflow-manager:src/engine.ts"
  - "navio/workflow-manager:src/index.ts"
  - "navio/workflow-manager:src/sessionFile.ts"
  - "navio/workflow-manager:doc/guide/workflow-schema.md"
  - "navio/workflow-manager:doc/guide/runner-api.md"
---

# workflow-author

Turn a natural-language task description into a `wfm` workflow file: a static, reviewable, re-runnable artifact instead of a one-off chat session. This skill is the authoring + operating counterpart to `workflow-manager-cli` — read that skill for the general command reference; this one is about *deciding what to build* and *narrating a run to a human*.

## 1. When to use

Use this skill when the user has a task that:

- has more than one meaningful step, with a clear order or dependency between steps
- should produce the **same shape of result** every time it runs — not a bespoke plan improvised fresh each session
- benefits from an explicit quality gate (an objective check, a human sign-off, or both) before moving on
- is worth sharing: a teammate, a CI job, or a future session should be able to run it unchanged

Do **not** reach for a workflow file for a single ad-hoc question, a one-shot investigation, or a task whose steps genuinely can't be known in advance. Ad-hoc orchestration (just doing the work directly) is cheaper than authoring a workflow when there is nothing to repeat. The signal to watch for: the user says some version of "every time we do X" or "we need a repeatable way to Y."

## 2. The authoring loop

Follow this sequence; do not skip validation.

1. **Elicit the task and success criteria.** Ask (or infer from context) what "done" looks like for the overall task, and for each step you expect to need. Concrete, checkable criteria beat vague ones — "the change satisfies the objective and includes tests" is checkable; "does a good job" is not.
2. **Decompose into chronological steps.** Every step gets a stable, kebab-case `key` (`implement-fix`, not `Step 1`). Wire `dependsOn` to express strict order — the engine resolves dependencies deterministically and rejects cycles, so an explicit `dependsOn: [previous-step]` is safer than relying on array order.
3. **Choose a quality gate per step.** For each step's `validation` (or an `approval` step's `approvalSpec.validation`), pick one:
   - `mode: agent` with concrete `criteria` — an objective, checkable condition a second agent call can verify against the step's output (tests pass, files changed match scope, no TODOs left). Prefer this whenever the check can be phrased as a fact about the artifact.
   - a dedicated `kind: approval` step — a human judgment call (does this look right, is this the right tradeoff, are we comfortable shipping this). Use for genuinely subjective or high-stakes decisions.
   - `mode: external` — an outside system resolves the step (a webhook, a deploy pipeline finishing).
   - `mode: none` — mechanical steps with no interesting failure mode (formatting, a fixed notification).
4. **Write the workflow.** Prefer the Markdown frontmatter format — humans (and you, later) can read the body notes alongside the machine-readable frontmatter; use JSON only for machine-generated definitions. Start from a scaffold:
   ```bash
   wfm scaffold --template agent-validated my-flow.md
   ```
   This drops a working three-step example (agent-validated task → approval → finalize) that you edit in place rather than writing from a blank file.
5. **Validate, and keep validating.** `wfm validate my-flow.md` — fix every reported line, one at a time, until it prints `Validation OK`. Never hand a workflow to the user (or run it) with unresolved validation errors.
6. **Dry-run adapter-heavy workflows with mocks.** If steps use real adapters (`pi-agent`, `claude-code`, `opencode`, `acp`), set `taskSpec.payload.mockResult: success` (or `retry` / `rollback` / `fail` to test routing) and `taskSpec.adapterKey: mock` temporarily, or `wfm doctor my-flow.md` to check host requirements without executing. This confirms dependency wiring and approval gating before spending a real adapter call.
7. **Done.** The file *is* the reusable artifact — no further "session state" to preserve. Re-running it later reproduces the same step sequence.

## 3. Schema cheat-sheet

Everything here matches `src/types.ts` on this branch — do not invent fields.

**Top level** (required: `key`, `title`, `steps`):

```yaml
key: my-workflow            # stable external identifier
title: My Workflow          # default run objective
description: optional summary
objectives: [optional, run-level, objectives]
defaultRetryPolicy: { maxAttempts: 2 }
skills:                     # named skills resolvable by taskSpec.init.skills
  my-skill:
    source: ./skills/my-skill/SKILL.md   # must match skills/**/SKILL.md under the workflow dir
steps: [ ... ]
```

**Step** (required: `key`, `kind`):

```yaml
- key: my-step                     # stable, kebab-case
  kind: task                       # task | approval | system
  title: optional display title
  objective: optional step-level objective
  dependsOn: [other-step-key]
  timeoutSec: optional
  retryPolicy: { maxAttempts: 2 }
  validation:                      # gates confirmation for THIS step's own record
    mode: none | human | external | agent
    required: true
    autoConfirm: false
    agent:                         # only when mode: agent
      adapterKey: pi-agent | mock | opencode | codex | claude-code | acp   # default: this step's adapter
      criteria: "plain-language acceptance criteria the validator checks against"
      init: { model, skills, mcps, systemPrompts, context }
      payload: { mockResult: success }   # lets mock drive the validator in tests
  taskSpec:                        # required when kind: task
    adapterKey: pi-agent | mock | opencode | codex | claude-code | acp    # omit -> pi-agent
    init:
      model: openrouter/anthropic/claude-sonnet-4
      skills: [skill-name]
      mcps: [mcp://endpoint]
      systemPrompts: [Focus on X]
      context: { any: json }
    payload:
      mockResult: success | retry | rollback | restart | yield | fail   # mock adapter only
  approvalSpec:                    # required when kind: approval
    autoApprove: false
    validation: { mode: human, required: true, autoConfirm: false }
```

**Critical gotcha** (verified on this branch, `src/parser.ts`): the parser fills an *unset* step-level `validation` with `{ mode: "none", required: false, autoConfirm: true }` by default — **even on `approval` steps**. `canConfirm` in `src/engine.ts` checks `step.validation?.autoConfirm` *before* `step.approvalSpec?.validation?.autoConfirm`. If you only set `approvalSpec.validation` and leave the step's own top-level `validation` unset, the default `autoConfirm: true` wins and the gate **silently auto-approves** instead of waiting for a human. Always set both `validation` and `approvalSpec.validation` on an approval step with matching `mode`/`required`/`autoConfirm` — see the worked example below.

**Validation rules the CLI enforces:** unique step keys; every `dependsOn` references an existing step; no dependency cycles; `kind` is `task | approval | system`; `taskSpec.adapterKey` (if set) is one of the supported adapters; `validation.mode` is `none | human | external | agent`; `mode: agent` is **not allowed** on approval steps (`approvalSpec.validation`).

**Agent validation routing:** a validator agent's verdict becomes a QA action — `PROCEED` (continue), `RETRY_CURRENT` (rerun this step with feedback), `ROLLBACK_PREVIOUS` (rerun an earlier step), or `RESTART_ALL` (restart the run) — bounded by the step's `retryPolicy.maxAttempts`.

## 4. Running and narrating (the agent-as-UI protocol)

Once a workflow validates, you are the UI for the run: start it detached, poll its state, and turn each transition into a short update instead of dumping raw JSON at the user.

**Start it detached, with a session file:**

```bash
wfm run my-flow.md --session-file .wfm/session.json &
```

The session file is written the moment the attach API is listening — `{ baseUrl, attachToken, runId, pid, startedAt }` — and rewritten with `endedAt` + `status` when the run finishes. It is never deleted, so it doubles as your "is this still running" signal. Every attach command below accepts `--session-file .wfm/session.json` instead of separate `--url`/`--token`.

**Poll on a cadence and narrate transitions**, not raw payloads:

```bash
wfm status --session-file .wfm/session.json
```

Read `status` and `currentStepKey` off the JSON, and translate: `"running"` + `currentStepKey: "implement-fix"` becomes something like *"step 1/3 (implement-fix) is running, attempt 1..."*. Don't re-poll faster than the work can plausibly progress — a few seconds between polls is usually plenty; back off further once a step has been running a while.

**Use `events` for incremental detail** between polls instead of re-reading the whole snapshot:

```bash
wfm events --session-file .wfm/session.json --since 4
```

Track the last `nextSequence` you saw and pass it back as `--since` next time. Add `--include-logs` only when you actually want `agent.stdout`/`agent.stderr` chunks inline.

**Use `logs` when the user asks what a step is doing right now:**

```bash
wfm logs --session-file .wfm/session.json --step implement-fix --limit 50
```

**Detect and handle `waitingForApproval`.** When `status`'s top-level `status` is `"waiting_for_approval"`, the JSON includes a `waitingForApproval` object with `stepKey`, `reason`, and a `preview` (`summary` plus `items` describing what's being reviewed, including dependency outputs). Summarize that preview for the user in plain language. Then either:

- relay the decision the user gives you, or
- if the user has explicitly delegated authority for this gate ("auto-approve the review steps," "you decide"), decide yourself and act:

```bash
wfm approve --session-file .wfm/session.json --step review-gate --note "why you approved"
wfm cancel  --session-file .wfm/session.json --step review-gate --note "why you're stopping the run"
```

Never approve on the user's behalf without either their live input or a standing delegation they gave you for that specific gate — it is a QA checkpoint, not decoration.

**On terminal status, report the outcome** by reading `endedAt` and `status` back from the session file (the run process has exited by then, so the attach API is gone — the session file is the only source left):

```bash
cat .wfm/session.json   # { ..., "endedAt": "...", "status": "succeeded" }
```

**Exit codes** (for the `wfm run` process itself, if you're waiting on it directly rather than polling): `0` — run succeeded; `2` — run finished but not successfully (failed, cancelled, or ended waiting); `1` — validation or runtime error before/during execution, not a normal terminal status.

## 5. Repeatability rules

- Never rename or remove a published workflow's step keys — other automation and history may reference them. Add new steps or a new workflow `key`/version instead of mutating shape in place.
- `key` (workflow) and step `key`s are stable external identifiers; change them only deliberately, and treat it as a breaking change for anything that depends on them.
- Keep `taskSpec.payload` deterministic — avoid embedding timestamps, random IDs, or environment-specific paths that would make two runs diverge for reasons unrelated to the actual task.
- Prefer `validation.mode: agent` criteria that a validator can check as a fact about the output (tests pass, a file exists, a diff touches only expected paths) over criteria that require taste. Save taste calls for `approval` steps.

## 6. Install/share

```bash
wfm skill install workflow-author                    # this skill -> ./.claude/skills/
wfm skill install workflow-author --agent opencode    # -> ./.opencode/skill/
wfm skill install workflow-author --global            # -> ~/.claude/skills/
```

To share the workflow *file* itself (not this skill) with teammates, use the remote registry — `wfm publish my-flow.md` / `wfm pull owner/slug`; see the `workflow-manager-cli` skill and `doc/guide/` for the full registry contract.

## Worked example

A repeatable "fix a flaky test" workflow: an agent-validated implementation step, a human sign-off gate, then a finalize step. Validated on this branch with `wfm validate` (`Validation OK`) and executed end-to-end with the mock adapter.

```yaml
---
key: fix-flaky-login-test
title: Fix Flaky Login Test
description: Diagnose and fix an intermittently failing login test, with a human sign-off before landing the fix
objectives:
  - the login test passes reliably and the fix is reviewed before merge
defaultRetryPolicy:
  maxAttempts: 2
steps:
  - key: implement-fix
    kind: task
    objective: Reproduce the flake in tests/login.test.ts, diagnose the root cause, and fix it
    dependsOn: []
    retryPolicy:
      maxAttempts: 2
    validation:
      mode: agent
      required: true
      autoConfirm: false
      agent:
        criteria: >-
          tests/login.test.ts passes 20 consecutive local runs, the fix
          addresses a root cause (not a retry/sleep workaround), and no
          unrelated files changed.
        init:
          model: openrouter/anthropic/claude-sonnet-4
          systemPrompts:
            - Check the diff against the criteria; call out any retry/sleep workaround explicitly
    taskSpec:
      adapterKey: mock
      init:
        context:
          repo: example/webapp
        skills: [debugging, testing]
        systemPrompts: [Find the root cause before writing a fix; add a regression test]
      payload:
        mockResult: success
  - key: review-gate
    kind: approval
    objective: Human sign-off on the fix before it merges
    dependsOn: [implement-fix]
    # validation must be set here too, not just under approvalSpec — an unset
    # step.validation defaults to autoConfirm: true, which would silently skip
    # this gate. See the schema cheat-sheet above.
    validation:
      mode: human
      required: true
      autoConfirm: false
    approvalSpec:
      autoApprove: false
      validation:
        mode: human
        required: true
        autoConfirm: false
  - key: finalize
    kind: task
    objective: Open a PR with the fix, the regression test, and a summary of the root cause
    dependsOn: [review-gate]
    validation:
      mode: none
      required: false
      autoConfirm: true
    taskSpec:
      adapterKey: mock
      init:
        systemPrompts: [Open a PR summarizing the root cause, the fix, and the new regression test]
      payload:
        mockResult: success
---

# Fix Flaky Login Test

Repeatable workflow for chasing down a flaky test: implement a fix (agent-validated
against explicit, checkable criteria), get a human sign-off, then finalize.
```

### Simulated narration transcript

```
$ wfm run fix-flaky-login-test.md --session-file .wfm/session.json &
Attach API: http://127.0.0.1:43121 (token b354...)

[agent] Started the workflow in the background — I'll check in as it progresses.

$ wfm status --session-file .wfm/session.json
{"status":"running","currentStepKey":"implement-fix", ...}

[agent] step 1/3 (implement-fix) is running, attempt 1 — reproducing the flake and writing a fix.

$ wfm status --session-file .wfm/session.json
{"status":"waiting_for_approval","currentStepKey":"review-gate",
 "waitingForApproval":{"stepKey":"review-gate",
   "reason":"confirmation required for review-gate",
   "preview":{"summary":"Approve this gate to continue after implement-fix.",
     "items":[{"title":"Dependency implement-fix","status":"succeeded",
       "summary":"Reproduce the flake in tests/login.test.ts, diagnose the root cause, and fix it"}]}}}

[agent] implement-fix passed agent validation (tests green, real root-cause fix,
no unrelated files touched) and is now waiting on you: review-gate wants a
human sign-off before finalize runs. Want me to look at the diff summary, or
are you approving as-is?

[user] approve it

$ wfm approve --session-file .wfm/session.json --step review-gate --note "Fix looks correct, root cause addressed"
approved review-gate

[agent] Approved review-gate. finalize is running now (opening the PR)...

$ cat .wfm/session.json
{ ..., "endedAt": "2026-07-11T13:35:40.756Z", "status": "succeeded" }

[agent] Done — the workflow succeeded. implement-fix and finalize both ran
clean, and your sign-off on review-gate is recorded in the run's approval
audit trail.
```
