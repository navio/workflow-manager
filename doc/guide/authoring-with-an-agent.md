# Authoring Workflows With an Agent

Some tasks come up more than once and should run the same way every time: a repeatable release checklist, a triage flow with a quality gate, a "fix this class of bug" loop. Instead of re-explaining the steps to your coding agent each session, have the agent turn the task into a `wfm` workflow file once — a static, reviewable, re-runnable artifact with explicit chronology (`dependsOn`), an enforced quality gate per step (a human, an outside system, or a second agent call), and a full event history. The agent then drives the run and narrates progress instead of you polling raw JSON yourself.

This page walks through that loop end to end. For the full command reference, read [Runner API](/guide/runner-api) and [Workflow Schema](/guide/workflow-schema); this page is the story that ties them together.

## Install the authoring skill

The bundled `workflow-author` skill teaches a coding agent how to elicit a task, decompose it into steps, choose a quality gate per step, scaffold and validate the file, and then run and narrate it. Install it into your agent's skill directory:

```bash
wfm skill install workflow-author                    # -> ./.claude/skills/
wfm skill install workflow-author --agent opencode    # -> ./.opencode/skill/
wfm skill install workflow-author --global            # -> ~/.claude/skills/
```

It pairs with the general-purpose `workflow-manager-cli` skill (`wfm skill install`, no name) — that one is the command reference, `workflow-author` is about deciding what to build and narrating a run to a human. See `skills/workflow-author/SKILL.md` for the full guide the agent reads, including a worked example workflow and a simulated narration transcript.

## The authoring loop

Once the skill is loaded, describe the repeatable task in plain language. The agent works through:

1. **Elicit success criteria.** What does "done" look like for the overall task and for each step — concrete and checkable, not "does a good job."
2. **Decompose into chronological steps.** Each step gets a stable, kebab-case `key`; `dependsOn` expresses order explicitly rather than relying on array position.
3. **Choose a quality gate per step**: `validation.mode: agent` with checkable `criteria` (tests pass, diff matches scope), a dedicated `kind: approval` step for a human judgment call, `mode: external` for an outside system, or `mode: none` for mechanical steps with no interesting failure mode.
4. **Write the workflow**, usually starting from a scaffold:
   ```bash
   wfm scaffold --template agent-validated my-flow.md
   ```
   This drops a three-step example (agent-validated task → approval → finalize) to edit in place. See [`wfm scaffold --template agent-validated`](/guide/workflow-schema) for the shape it generates.
5. **Validate, and keep validating** — `wfm validate my-flow.md` until it prints `Validation OK`. The agent should never hand you a workflow, or run one, with unresolved validation errors.
6. **Dry-run with mocks** before spending a real adapter call — set `taskSpec.adapterKey: mock` and `taskSpec.payload.mockResult` temporarily, or run `wfm doctor my-flow.md` to check host requirements without executing anything.

The workflow file is the reusable artifact. There's no session state to preserve — running it again later reproduces the same step sequence.

## Running with `--session-file`, while the agent narrates

`wfm run <file> --session-file <path>` writes attach connection details the moment the run starts, and rewrites the same file with the final status when it ends — so an agent can start the run in the background, poll it with plain CLI calls, and keep talking to you in between. Full contract: [Runner API — Attach clients](/guide/runner-api#attach-clients).

A realistic session looks like this:

```
$ wfm run fix-flaky-login-test.md --session-file .wfm/session.json &
Attach API: http://127.0.0.1:43121 (token b354...)

[agent] Started the workflow in the background — I'll check in as it progresses.

$ wfm status --session-file .wfm/session.json
{"status":"running","currentStepKey":"implement-fix", ...}

[agent] step 1/3 (implement-fix) is running, attempt 1 — reproducing the flake and writing a fix.

$ wfm status --session-file .wfm/session.json
{"status":"waiting_for_approval","currentStepKey":"review-gate", ...}

[agent] implement-fix passed agent validation and is now waiting on you:
review-gate wants a human sign-off before finalize runs. Approve as-is,
or want me to pull the diff summary first?

[user] approve it

$ wfm approve --session-file .wfm/session.json --step review-gate --note "Fix looks correct"
approved review-gate

[agent] Approved review-gate. finalize is running now...

$ cat .wfm/session.json
{ ..., "endedAt": "2026-07-11T13:35:40.756Z", "status": "succeeded" }

[agent] Done — the workflow succeeded end to end.
```

The agent should poll `status` on a sensible cadence (not faster than the work can plausibly progress) and use `events --since <n>` for incremental detail between polls instead of re-fetching the whole snapshot. `logs --step <key>` answers "what is this step doing right now." All three print compact JSON on stdout, and connection details (`--session-file`, or `--url`/`--token`) work the same way across `status`, `logs`, `events`, `approve`, `resume`, and `cancel`.

## Approvals: human decides, or the agent decides for you

A `kind: approval` step pauses the run in `waiting_for_approval` with a `preview` describing what's being reviewed. From there:

- **You decide.** The agent relays the preview in plain language and waits for your answer, then calls `wfm approve --session-file ... --step <key>` or `wfm cancel --session-file ... --step <key>` with your decision.
- **The agent decides, if you've delegated it.** Only when you've given a standing instruction for that specific gate ("auto-approve the review steps," "you decide on this one") should the agent approve on its own — an approval gate is a QA checkpoint, not decoration, and the agent should never approve on your behalf without either live input or an explicit prior delegation.

**How the gate is resolved:** an approval step's gate is controlled by `approvalSpec.validation` whenever it sets `required: true` — the engine prefers it over the step's own top-level `validation`, so `approvalSpec.validation` alone is enough to make the gate wait for a human:

```yaml
- key: review-gate
  kind: approval
  dependsOn: [implement-fix]
  approvalSpec:
    autoApprove: false
    validation:
      mode: human
      required: true
      autoConfirm: false
```

Setting a matching top-level `validation` block too is harmless and can make the file easier to scan, but it's no longer required to avoid an auto-approve.

## Agent validation: a second agent checks the work

For steps where the check can be phrased as a fact about the output — tests pass, the diff stays in scope, no leftover TODOs — set `validation.mode: agent` instead of a human gate. The engine runs a second agent call against the step's output, and maps its verdict onto the same routing the engine already uses for self-reported QA results: `PROCEED` continues, `RETRY_CURRENT` reruns the step, `ROLLBACK_PREVIOUS` reruns an earlier step, `RESTART_ALL` restarts the run — all bounded by the step's `retryPolicy.maxAttempts`. `mode: agent` is not allowed on `approval` steps, and it runs unconditionally: `--auto-confirm-all` and step-level `autoConfirm` never skip it, since it's a QA gate rather than a human approval.

```yaml
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
```

`agent.adapterKey` defaults to the validated step's own adapter if omitted; `agent.payload.mockResult` lets a mock adapter drive the validator during dry runs. See [Workflow Schema — Validation](/guide/workflow-schema#validation) for the full field list and validation-rule details.

## Sharing the result

A workflow file authored this way is shareable like any other: `wfm publish my-flow.md` pushes it to the remote registry (inlining any local skill content with integrity hashes), and a teammate runs `wfm pull owner/slug` to pull and run it unchanged. See [Getting Started](/guide/getting-started) for the full publish/pull flow.
