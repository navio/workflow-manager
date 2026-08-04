# Plan: Add DeepSeek and Kimi as new agent backends (2026-08-04)

Status: **draft — planning only, no source changes made.**
Branch: `workflow-manager/08-04-26/add-acx-deepseek-kimi` (this worktree).

## 0. Terminology finding — "ACX" does not exist in this codebase

The task brief asks to add DeepSeek and Kimi as "ACX clients/agent backends." I searched
the full repo (`grep -ril acx`, case-insensitive, including `.ts`/`.md`/`.json`/`.yml`),
the entire git history (`git log --all --oneline | grep -i acx`), and all branches. **The
string "ACX" appears nowhere** — not in source, docs, tests, commit messages, or branch
names other than this task's own branch/slug.

The repo's actual pluggable-agent-backend abstraction is **ACP — the [Agent Client
Protocol](https://agentclientprotocol.com)** (`src/acpExecutor.ts`, `AdapterKey` value
`"acp"`, dependency `@agentclientprotocol/sdk`). ACP is what lets `wfm` drive
`claude-code`, `opencode`, `gemini`, and `codex` as real coding-agent backends over a
JSON-RPC/stdio protocol, via `ACP_COMMAND_PRESETS` in `src/acpExecutor.ts:41-46`. Given
the branch slug `add-acx-deepseek-kimi` and the phrase "clients/agent backends," this
plan proceeds on the assumption that **"ACX" is a typo/shorthand for "ACP"** and that the
intent is: *add DeepSeek and Kimi as new pluggable agent backends, following the same
extension pattern already used for `codex` (PR #110, commit `e6c6381`) and `opencode`
(PR #112, commit `e838dd6`).*

**This is stated as an assumption, not fact — confirm with the user before implementing
if there is any doubt.** If "ACX" instead refers to something outside this repo (e.g. a
specific product name), this plan does not apply and needs re-scoping.

## 1. Research: what DeepSeek and Kimi actually are here

Per the task brief's instruction not to guess, I checked whether DeepSeek/Kimi are
providers, CLI clients, SDK/API clients, or adapter keys, using the live ACP registry
(`https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json`, maintained by
the `agentclientprotocol` GitHub org) and each project's own repo, as of 2026-08-04. The
two are **not symmetric** and should not be added the same way:

### Kimi — has an official, first-party ACP-speaking CLI

- Moonshot AI ships **Kimi CLI** (`MoonshotAI/kimi-cli`, binary/command `kimi`),
  listed in the ACP registry (v1.49.0 there) with **native** ACP support: running
  `kimi acp` starts it as an ACP agent server over stdio — no bridge package required.
  This is structurally identical to the existing `opencode acp` and
  `gemini --experimental-acp` presets already in `ACP_COMMAND_PRESETS`.
  - Reference config from Kimi CLI's own docs: `{ "command": "kimi", "args": ["acp"] }`.
  - Kimi CLI manages its own authentication (`kimi` then `/login` inside the CLI, or
    an API key it stores itself) — same self-managed-credentials story as `pi`,
    `opencode`, `codex-acp`, and `claude-code-acp` already have in this repo. **No new
    env var plumbing is needed for Kimi.**
- Verdict: **Kimi maps directly onto a new ACP preset/adapter, exactly like `codex`.**
  High confidence.

### DeepSeek — no official first-party ACP agent exists (as of 2026-08-04)

- DeepSeek (the company) does not publish an official CLI coding agent, ACP or
  otherwise. What exists are third-party/community projects — "DeepSeek-TUI" (early,
  first ACP support), "Deep Code CLI" (explicitly community-built, not an official
  DeepSeek product), "DeepSeek-Reasonix" — none of them is canonical, none is an
  `@agentclientprotocol`-org-maintained bridge (unlike `codex-acp` /
  `claude-code-acp`, which are official packages under that org), and the ACP
  registry has **no DeepSeek entry**.
- Hardcoding a preset command for one of these community tools would bake an
  unstable, third-party dependency into `ACP_COMMAND_PRESETS` under DeepSeek's name,
  which is a materially different (and riskier) commitment than the `codex`/
  `claude-code` presets, both of which point at officially maintained bridges.
- What **does** already work today, with zero code changes, for DeepSeek as an LLM
  *model* (as opposed to a full agentic CLI):
  - `taskSpec.adapterKey: "acp"` + `taskSpec.payload.acpCommand`/`acpArgs` pointing at
    whichever community DeepSeek ACP tool the workflow author has installed — the
    generic `acp` adapter already supports "any command that speaks ACP," which is
    exactly this case.
  - `taskSpec.adapterKey: "pi-agent"` (the default) + `taskSpec.init.model` set to a
    DeepSeek model id understood by the user's `pi` binary — DeepSeek models are
    broadly available through OpenRouter (e.g. `openrouter/deepseek/deepseek-chat`),
    which the preflight already recognizes via the `openrouter/` prefix
    (`requiredEnvFromModel` in `src/runtimePreflight.ts:88-105`) and requires
    `OPENROUTER_API_KEY` for.
- Verdict: **DeepSeek does not map cleanly onto a new bundled ACP preset today.** It
  maps onto (a) the existing generic `acp` escape hatch (no code change), and (b)
  optionally, better preflight support for DeepSeek's own direct API
  (`DEEPSEEK_API_KEY`, base URL `api.deepseek.com` — DeepSeek's own documented,
  stable convention) as a model-prefix addition to `requiredEnvFromModel`, for
  workflows that talk to DeepSeek directly rather than via OpenRouter.

**Open question for the user (do not implement until answered):** given this
asymmetry, do you want:
- (A) Kimi only, as a full ACP adapter (mirrors `codex`) — DeepSeek left to the
  existing generic `acp`/`pi-agent` paths, documented but not code-pathed by name; or
- (B) Kimi as in (A), plus a `deepseek` `requiredEnvFromModel` preflight addition
  (small, safe, no new `AdapterKey`); or
- (C) Both as full `AdapterKey`s with bundled presets, accepting that the DeepSeek
  preset will point at a named third-party community tool that may need to change
  later (specify which one, and I will re-verify it against its actual ACP handshake
  before adding it)?

This plan is written to make **(B)** the default/recommended path (it is fully
supported by evidence and requires no speculative preset), while keeping the Kimi
portion of (A)/(C) directly reusable. Section 6 lists the DeepSeek-as-full-adapter
work as an optional Track C if the user picks (C).

## 2. Architecture / data flow recap (for context)

```
workflow step (adapterKey: "kimi", payload.useRealAdapter: true)
  -> engine.ts routes task execution to an executor function (never inline logic)
  -> runtimePreflight.ts (`wfm run` / `wfm doctor <workflow>`) validates:
       - shouldUseRealAcp(step) -> true (opt-in gate)
       - resolveAcpCommand(step, env) -> preset lookup in ACP_COMMAND_PRESETS["kimi"]
       - command "kimi" must exist on PATH
  -> acpExecutor.ts `executeAcpStep`:
       - spawns `kimi acp`
       - ndJsonStream bridges child stdio <-> @agentclientprotocol/sdk ClientSideConnection
       - conn.initialize -> conn.newSession -> conn.prompt (the built prompt from
         composePrompt(), which folds in skills/system prompts/global state/previous
         output/step objective, same as every other ACP agent)
       - session updates stream back through hooks?.onStdout for live CLI rendering
       - stopReason mapped to OutputEnvelope via mapStopReason()
  -> OutputEnvelope returned to engine.ts, same QA routing (PROCEED/RETRY_CURRENT/...)
     as any other adapter
```

No new executor file is needed for Kimi — it rides entirely on the existing
`acpExecutor.ts` generic ACP client, the same way `opencode`, `codex`, and
`claude-code` do. The only new code is: a new `AdapterKey` value, a
`SUPPORTED_ADAPTERS` entry, an `ACP_COMMAND_PRESETS` entry, and preflight/doctor/docs
wiring that mirrors the `codex` addition line-for-line.

For DeepSeek (Track B), no execution-path code changes at all — only a preflight
env-var inference addition in `requiredEnvVars`/`requiredEnvFromModel`, which is pure
validation logic, not a new adapter or executor.

## 3. Exact files, symbols, and insertion points

### Track A — Kimi as a first-class ACP adapter

| # | File | Symbol / location | Change |
|---|------|--------------------|--------|
| A1 | `src/types.ts` | `AdapterKey` union, line 27 | Add `"kimi"` to the union: `"pi-agent" \| "mock" \| "opencode" \| "codex" \| "claude-code" \| "kimi" \| "acp"` |
| A2 | `src/adapters.ts` | `SUPPORTED_ADAPTERS` array, lines 5-11 | Add `"kimi"` (placement: after `"claude-code"`, before `"acp"`, matching the type union order) |
| A3 | `src/acpExecutor.ts` | `ACP_COMMAND_PRESETS`, lines 41-46 | Add `kimi: { command: "kimi", args: ["acp"] }`. Update the explanatory comment above (lines 35-40) to note Kimi CLI speaks ACP natively (like `opencode`/`gemini`), unlike `codex`/`claude-code` which need bridges — so readers don't assume every preset needs a bridge package |
| A4 | `src/runtimePreflight.ts` | `ACP_ROUTABLE_ADAPTERS`, line 9 | Add `"kimi"` to the `Set<AdapterKey>` |
| A5 | `src/runtimePreflight.ts` | `runtimeDoctorChecks()`, lines 251-273 | Add `commandCheck("kimi", "Kimi CLI", "kimi", false, env)` to the returned array (optional check, matching the `opencode`/`claude` pattern — not a bridge-binary check like `codex-acp`, since `kimi` itself is the ACP server) |
| A6 | `src/runtimePreflight.ts` | `adapterImplementationStatuses()`, lines 356-389 | Add an entry: `{ adapter: "kimi", status: "real", detail: "routed through ACP via the kimi CLI's native 'kimi acp' mode when useRealAdapter is true; kimi manages its own auth (kimi CLI's own /login flow)" }` |
| A7 | `supabase/functions/_shared/workflows.ts` | `supportedAdapters` Set, line 3 | Add `"kimi"` — **this is a second, independent allowlist** (confirmed by grep + the note in commit `e838dd6`, "registry allowlist gains `acp` (drift fix)", that this exact drift bit the team before). Forgetting this makes `wfm publish` reject any workflow using `adapterKey: kimi` even though local validation accepts it |

**Default real/mock gating decision needed:** `codex`/`claude-code` are opt-in
(`useRealAdapter: true` required); `opencode` is real-by-default
(`useRealAdapter: false` to opt out). Recommend **opt-in** for Kimi initially — it is
a brand-new integration with no in-repo verification yet, and opt-in is the safer,
more conservative default (also matches the more recent precedent, `codex`, rather
than the real-by-default `opencode` which was a deliberate breaking-change upgrade
made only after `opencode` had already proven itself as opt-in first). If the user
wants real-by-default instead, swap `shouldUseRealAcp`'s gating by adding `"kimi"` to
`REAL_BY_DEFAULT_ACP_ADAPTERS` in `src/acpExecutor.ts:129` instead of relying on the
default opt-in branch — flag this as a one-line decision point during implementation,
not a research gap.

### Track B — DeepSeek as a model-routing preflight addition (recommended default)

| # | File | Symbol / location | Change |
|---|------|--------------------|--------|
| B1 | `src/runtimePreflight.ts` | `requiredEnvFromModel()`, lines 88-105 | Add a branch recognizing DeepSeek model ids and returning `"DEEPSEEK_API_KEY"`. Needs a decision on exact prefix matching — recommend mirroring the existing dual-pattern used for OpenAI/Anthropic (both a `provider/` path prefix and bare well-known model name prefixes), i.e. match `normalized.startsWith("deepseek/")` (path-style, e.g. a hypothetical direct-DeepSeek adapter emitting `deepseek/deepseek-chat`) **and** `normalized.startsWith("deepseek-")` (bare model ids like `deepseek-chat`, `deepseek-reasoner`, matching DeepSeek's own model-naming convention, the same way `claude-` and `gpt-` are matched today). Do **not** intercept `openrouter/deepseek/...` — that already correctly resolves to `OPENROUTER_API_KEY` via the existing `openrouter/` branch, and DeepSeek-via-OpenRouter must keep using the OpenRouter key, not `DEEPSEEK_API_KEY` |
| B2 | `src/runtimePreflight.ts` | `runtimeDoctorChecks()`, lines 251-273 | Add `envCheck("deepseek-key", "DeepSeek API key", "DEEPSEEK_API_KEY", env)`, mirroring the existing `openrouter-key`/`openai-key`/`anthropic-key` entries |

No `AdapterKey`, `SUPPORTED_ADAPTERS`, `ACP_COMMAND_PRESETS`, or supabase allowlist
changes for DeepSeek under Track B — it is purely additive preflight inference on top
of adapters that already exist (`pi-agent` with `taskSpec.init.model`, or `acp` with
an explicit `acpCommand` a user supplies for whichever DeepSeek tool they use).

### Track C — DeepSeek as a full ACP adapter (optional, only if the user picks option (C) in §1)

Same shape as Track A (A1–A7) but for `"deepseek"`, **with the preset command left
unresolved pending the user naming a specific, stable DeepSeek ACP tool** to point
`ACP_COMMAND_PRESETS.deepseek` at. Do not guess a binary name — verify it speaks ACP
via a live handshake first (the same verification step the codex design doc,
`docs/superpowers/specs/2026-07-13-codex-connector-design.md`, describes doing before
committing to `codex-acp`). Treat as a separate follow-up task, not bundled into the
same PR as Kimi, since it has materially higher uncertainty.

## 4. Provider/model and credential handling summary

| Backend | Adapter path | Credential model | New env var? |
|---|---|---|---|
| Kimi (agentic CLI) | new `kimi` ACP adapter | Kimi CLI's own auth store (`/login` inside the CLI) — same policy as `pi`, `opencode`, `codex-acp`, `claude-code-acp` | No |
| DeepSeek via OpenRouter | existing `pi-agent` + `taskSpec.init.model: "openrouter/deepseek/..."` | `OPENROUTER_API_KEY` (already inferred today, no change) | No |
| DeepSeek direct API | existing `pi-agent`/`acp` + a `deepseek-*`/`deepseek/*` model id | `DEEPSEEK_API_KEY` (Track B adds preflight inference only — actual credential handling is inside `pi` or the user's ACP command, outside this repo) | New (preflight-only) |
| DeepSeek via community ACP tool | existing generic `acp` + `payload.acpCommand` | Whatever the chosen third-party tool requires (out of scope; user-supplied `acpCommand`/`acpArgs`/`acpAuthMethod`) | No (already generic) |

Important constraint from `AGENTS.md`: **"pi manages provider credentials in its own
auth store"** — this repo intentionally does *not* try to fully enumerate every
provider's env var. `requiredEnvFromModel` is a best-effort convenience check, already
skipped entirely for `pi-agent` and ACP steps (`runtimeRequirement()` in
`src/runtimePreflight.ts:141-161` only enforces `explicitRequiredEnv`, i.e.
`taskSpec.payload.requiredEnv`, for those). Track B's `DEEPSEEK_API_KEY` inference is
therefore cosmetic/best-effort by the same design, not a hard gate — consistent with
existing behavior, not a new pattern.

## 5. Compatibility and security considerations

- **Backward compatibility:** purely additive. New `AdapterKey` union members and new
  `SUPPORTED_ADAPTERS`/preset-map entries do not change behavior for any existing
  `adapterKey` value. No schema field is removed or renamed. Per `AGENTS.md`, "Step
  keys, workflow keys, and status strings are stable external identifiers — change
  cautiously; prefer additive, backward-compatible schema changes" — this plan
  satisfies that.
- **Two independent adapter allowlists must move together** (`src/adapters.ts` and
  `supabase/functions/_shared/workflows.ts`) — call this out explicitly in the PR
  description since it's a documented past source of drift (§3, row A7).
- **Security — command execution:** the `kimi` preset spawns a host binary with
  `stdio: ["pipe","pipe","pipe"]` and the full parent `env`
  (`acpExecutor.ts:337, spawn(resolved.command, resolved.args, ...)`), same as every
  other ACP preset already in the codebase — no new attack surface is introduced
  beyond what `codex`/`claude-code`/`opencode` already have. `acpPermissions` (default
  `"allow"`) governs whether Kimi can write files/run shell commands unattended,
  exactly as documented for other agents; nothing here needs a different default.
  Recommend documenting `acpPermissions: reads-only` as a suggested first-run setting
  for a not-yet-battle-tested adapter, but this is a docs recommendation, not a code
  change.
- **Security — credentials:** Track B only adds a *doctor/preflight visibility*
  check for `DEEPSEEK_API_KEY`; it never reads, logs, or forwards the key value
  itself (same as the existing `OPENROUTER_API_KEY`/`OPENAI_API_KEY`/
  `ANTHROPIC_API_KEY` checks, which only test `env[var]?.trim()` truthiness).
- **Supply-chain:** Kimi CLI is installed by the *user's host*, not as an npm
  dependency of this repo (same as `opencode`, `claude`, `codex-acp`) — no
  `package.json` change needed for Track A. (`codex-acp`/`claude-code-acp` are
  npm-installed bridges *because* codex/claude have no native ACP mode; Kimi does, so
  no bridge dependency applies here at all.)

## 6. Tests (concrete, mirroring existing patterns)

All new tests should follow the exact patterns already in the codebase for the
`codex` addition (grep hits below) — do not invent new test-file structure.

### `tests/acpExecutor.test.ts` (mirror lines 65-74, the codex preset tests)

- `resolveAcpCommand` returns the Kimi preset:
  ```ts
  it("falls back to a preset for kimi", () => {
    const cmd = resolveAcpCommand({ key: "s", kind: "task", taskSpec: { adapterKey: "kimi" } }, {});
    expect(cmd).toEqual({ command: "kimi", args: ["acp"] });
  });
  ```
- `shouldUseRealAcp` opt-in gating for kimi (mirror lines 70-74): true only with
  `payload.useRealAdapter: true`, false when adapterKey is bare `"kimi"` with no
  payload — **unless** the opt-in-vs-real-by-default decision in §3 is resolved as
  real-by-default, in which case mirror the `opencode` tests
  (`tests/acpExecutor.test.ts`, search for `isRealByDefaultAcpAdapter`) instead.

### `tests/runtimePreflight.test.ts`

- Mirror lines 225-232 (`"warns when codex (an ACP preset) is selected without
  useRealAdapter"` / `"does not warn when codex routes through ACP with
  useRealAdapter"`) for `kimi`.
- Mirror lines 305-315 (`"requires the codex-acp bridge on the host for real codex
  steps"`) for `kimi`, but asserting the error mentions `kimi` (the CLI itself, not a
  separate bridge binary):
  ```ts
  it("requires the kimi CLI on the host for real kimi steps", () => {
    const errors = validateRuntimeRequirements(
      workflow({ key: "s", kind: "task", taskSpec: { adapterKey: "kimi", payload: { useRealAdapter: true } } }),
      { PATH: "" }
    );
    expect(errors.some((e) => e.includes("kimi") && e.includes('command "kimi"'))).toBe(true);
  });
  ```
- New test for Track B, mirroring the existing OpenRouter/Anthropic model-inference
  tests in the same file (search for `"openrouter/anthropic/claude-sonnet-4"`,
  ~line 68, and the `claude-code`/`ANTHROPIC_API_KEY` test at line 121-139): assert a
  step with `taskSpec.init.model: "deepseek-chat"` (or `"deepseek/deepseek-chat"`,
  per whichever prefix convention is chosen in B1) against a non-`pi-agent`,
  non-ACP-real adapter requires `DEEPSEEK_API_KEY`, **and** assert a step with
  `taskSpec.init.model: "openrouter/deepseek/deepseek-chat"` requires
  `OPENROUTER_API_KEY`, not `DEEPSEEK_API_KEY` (regression guard against the two
  branches colliding — see the "Do not intercept openrouter/deepseek/..." note in B1).
- `adapterImplementationStatuses()` includes a `kimi` entry (simple snapshot-style
  assertion, mirroring how the existing five-adapter list is likely already asserted
  — check for an existing test asserting the full array length/contents before
  adding a new item, since a hardcoded length assertion elsewhere would need
  bumping).

### `tests/adapters.test.ts`

- `resolveTaskAdapter("kimi")` returns `"kimi"` (mirror the existing
  `resolveTaskAdapter("opencode")` test, line 11).
- `resolveValidatorAgentSpec` inherits/overrides with `adapterKey: "kimi"` in at
  least one case, mirroring the existing `opencode`/`claude-code` validator-spec
  tests (lines 31-48) — the validator machinery is adapter-agnostic, so a single
  substitution test is enough to confirm no `kimi`-specific special-casing broke it.

### `tests/parser.test.ts`

- Mirror line 140's codex acceptance test for `adapterKey: "kimi"`, and per
  `AGENTS.md`'s "cover both JSON and Markdown workflow paths when changing format
  support" rule, add both a JSON-format and Markdown-format parse test (check
  whether line 140's existing test is already parametrized across both formats or
  needs a sibling test for the other format — read the surrounding `describe` block
  before writing).

### Optional / stretch — live e2e

- `opencode`/`codex` both eventually got opt-in **real** e2e coverage (`tests/e2e:real`,
  `tests/acp-real.e2e.test.ts`, `WORKFLOW_MANAGER_REAL_OPENCODE=1`-style gating).
  Follow the same pattern for Kimi only if the `kimi` CLI is actually installed in a
  verification environment — gate behind a new env var (e.g.
  `WORKFLOW_MANAGER_REAL_KIMI=1`) so CI without the binary installed doesn't break.
  This is a nice-to-have, not required to close out the initial PR; call it out as a
  follow-up task rather than blocking on it.

## 7. Docs / config changes

Every file below already mentions `codex`/`claude-code`/`opencode` in an
adapter-enumeration context (confirmed via `grep -rln codex` across `.ts`/`.md`
excluding `dist`/`node_modules`) and needs the equivalent Kimi (and, for Track B,
DeepSeek env var) addition alongside the existing entries — **do not rewrite these
files, do minimal targeted edits at each existing enumeration point**:

- `README.md` — adapter bullet (~line 8: list of adapters and which are ACP presets)
  and the preflight/doctor section (~lines 75, 77: known-provider env var list and
  adapter implementation status list).
- `doc/guide/workflow-schema.md` — every enumeration hit found by
  `grep -n "codex" doc/guide/workflow-schema.md`: the `taskSpec.adapterKey` enum
  (line 71), the ACP payload fields section (line 85, `acpAgent` preset names, line
  88), `agent.adapterKey` enum (line 109), the runtime-preflight bullet on known
  provider models (line 151 — add `DEEPSEEK_API_KEY` here for Track B), and "Current
  adapter implementation status" (lines 156-165 — add a `kimi` bullet mirroring the
  `codex`/`claude-code` bullets, noting the native-ACP / no-bridge distinction from
  §1).
- `doc/guide/architecture.md`, `doc/guide/how-it-works.md`, `doc/guide/protocol.md`,
  `doc/guide/workflow-examples.md`, `doc/index.md` — each contains at least one
  `codex` reference (confirmed by the repo-wide grep in §research); check each for an
  adapter-enumeration list and add `kimi` alongside, following whatever phrasing that
  file already uses for `codex`/`claude-code`. Skip any hit that's just prose
  incidental to codex specifically (e.g., a worked example) rather than a general
  adapter list.
- `skills/workflow-manager-cli/SKILL.md`, `skills/workflow-author/SKILL.md`,
  `skills/doc-sync/SKILL.md` — same treatment; these are the skill docs bundled by
  `scripts/generate-bundled-skills.mjs` into `src/generated/bundledSkills.ts`. **Edit
  the source `skills/*.md` files, never `src/generated/bundledSkills.ts` directly**,
  then regenerate (confirm the exact npm script name in `package.json`, e.g. a
  `generate-bundled-skills`/`skills:generate`-style entry, before running it) so the
  generated file and its sources don't drift.
- `example-workflow.md` / `example-workflow.json` (repo root) — optional: consider
  adding a `kimi` step example alongside the existing `codex`/`claude-code`/`acp`
  examples for documentation completeness. Not required for functionality.
- `AGENTS.md` — pre-existing drift noted during research: its "Parser And Schema
  Conventions" section says "Supported adapters are currently `mock`, `opencode`,
  `codex`, and `claude-code`" — this is already stale (missing `pi-agent` and `acp`)
  independent of this task. Recommend fixing the full list while touching this file
  for the `kimi` addition, as a small opportunistic correction, but flag it separately
  in the PR description as "pre-existing doc drift fixed in passing" so it doesn't
  read as scope creep.
- Per `AGENTS.md`'s "Skills To Load Proactively": load `skills/doc-sync/SKILL.md`
  before finalizing any of the docs edits above, and `skills/repo-hygiene/SKILL.md` +
  `skills/commit-discipline/SKILL.md` before staging/committing the implementation.

Do **not** hand-edit `CHANGELOG.md` (release-please generated) or
`src/generated/bundledSkills.ts` (build-generated).

## 8. Rollout / verification sequence

Once a decision is made on the open questions in §1 and §3 (opt-in vs real-by-default
for Kimi; Track B vs Track C for DeepSeek), implementation should proceed as a single
worktree/branch per `AGENTS.md`'s branch policy, in this order:

1. **Track A (Kimi), source first, TDD-style** (matches the codex design doc's stated
   approach: "preset/preflight assertions written first"):
   - Write the new tests from §6 (A-related) against the not-yet-updated source; they
     should fail.
   - Apply A1–A7.
   - Re-run the new tests; they should pass.
2. **Track B (DeepSeek preflight), same TDD pattern**, applied independently of Track
   A so it can be reviewed/reverted separately if needed.
3. **Docs (§7)** — update every enumeration point found; do not skip files because
   they "probably" don't need it — verify with `grep -n "codex" <file>` per file
   before editing, and again after, to confirm the Kimi mention landed next to every
   codex mention that was itself in an adapter-list context.
4. **Regenerate bundled skills** if any `skills/*.md` source changed.
5. **Validation commands, in order** (per `AGENTS.md`'s "Engine or executor changes"
   sequence, since this touches `src/acpExecutor.ts` and `src/runtimePreflight.ts`):
   ```bash
   bun run lint
   bun test tests/acpExecutor.test.ts tests/runtimePreflight.test.ts tests/adapters.test.ts tests/parser.test.ts
   bun run test:unit
   bun run build
   bun run docs:build
   ```
   If `apps/remote-registry/` or the Supabase allowlist file changed (it does, A7),
   also run:
   ```bash
   bun run remote-registry:test && bun run remote-registry:build
   ```
6. **Manual/live verification (optional but recommended before merging Track A):**
   install the real `kimi` CLI on a host, run `wfm doctor` to confirm the new `kimi`
   check reports `ok`, then run a one-step workflow with
   `adapterKey: kimi, payload: { useRealAdapter: true }` end to end and confirm a real
   Kimi turn completes and the `OutputEnvelope` is well-formed — this is exactly the
   "live e2e" verification step the codex design doc recorded doing before merging.
7. **PR** — call out explicitly in the description: (a) the ACX→ACP terminology
   assumption from §0, (b) the Kimi/DeepSeek asymmetry rationale from §1, (c) the two
   allowlists that had to move together (§3, row A7), (d) the opt-in-vs-real-by-default
   choice made for Kimi and why.

## 9. Bite-sized sequential tasks

1. Confirm with the user: ACX = ACP assumption (§0), and pick a DeepSeek track,
   (A)/(B)/(C) from §1 — **blocking**, do before writing any code.
2. Add failing tests for Kimi preset resolution + opt-in gating
   (`tests/acpExecutor.test.ts`).
3. Implement A1 (`types.ts`), A2 (`adapters.ts`), A3 (`acpExecutor.ts` preset), A4
   (`runtimePreflight.ts` routable set) — get the Step-2 tests green.
4. Add failing tests for Kimi doctor check + mock-fallback warning + host-command
   preflight error (`tests/runtimePreflight.test.ts`).
5. Implement A5, A6 (`runtimePreflight.ts` doctor + implementation status) — get
   Step-4 tests green.
6. Add A7 (`supabase/functions/_shared/workflows.ts` allowlist) with a matching test
   or manual check that `wfm publish` accepts `adapterKey: kimi` (check whether
   `supabase/` has its own test suite covering this allowlist; if so, add there too).
7. If Track B chosen: add failing DeepSeek model-inference tests, implement B1/B2,
   get them green, including the OpenRouter-vs-direct regression test.
8. Add `resolveTaskAdapter`/`resolveValidatorAgentSpec` coverage for `kimi` in
   `tests/adapters.test.ts`.
9. Add JSON + Markdown parser acceptance tests for `adapterKey: kimi` in
   `tests/parser.test.ts`.
10. Update all docs/skills enumerations from §7; regenerate bundled skills if needed.
11. Run the full validation sequence from §8.6; fix any red output before proceeding.
12. Optional: add a gated live e2e test for Kimi (`WORKFLOW_MANAGER_REAL_KIMI=1`
    style) once a real `kimi` CLI is available to verify against.
13. Rebase onto latest `origin/main`, re-run lint + build per branch policy, open PR
    with the callouts listed in §8.7.

## 10. Assumptions and open questions (consolidated)

- **A1 (blocking):** "ACX" is read as a typo/shorthand for "ACP," this repo's actual
  pluggable-agent-backend protocol. Not verified with the user.
- **A2 (blocking):** Given DeepSeek has no official ACP CLI as of 2026-08-04, this
  plan recommends Track B (preflight-only DeepSeek support) over Track C (a
  speculative full adapter pointing at an unverified community tool). Needs a
  decision from the user before implementation.
- **A3:** Kimi's real-execution default should be opt-in (`useRealAdapter: true`),
  matching `codex`/`claude-code` rather than the real-by-default `opencode`. Proposed
  default, not confirmed.
- **A4:** DeepSeek's direct-API env var is assumed to be `DEEPSEEK_API_KEY` (DeepSeek's
  own documented, stable convention, independent of any single tool's choices) — not
  verified against the specific tool(s) a workflow author will actually configure via
  `acpCommand`, since that's user-chosen and out of this repo's control.
  `MOONSHOT_API_KEY`/Kimi API-key plumbing is deliberately **not** added, since Kimi is
  planned as a full self-authenticating ACP adapter (§1), not a bare model string.
- **A5:** The exact model-prefix matching rule for `requiredEnvFromModel` (B1) — this
  plan proposes matching both `deepseek/` and `deepseek-` prefixes but this is a
  design choice worth a second look during implementation, not a settled fact.
- **A6 (checked, resolved):** `apps/remote-registry/` (the dashboard UI) has **no**
  adapter-name references (`grep -rln "codex\|opencode\|claude-code"
  apps/remote-registry/src/` returns no hits) — the only allowlist outside
  `src/adapters.ts` is the Supabase Edge Function one (A7). No UI changes needed.
