# Judging a workflow

`wfm judge` reviews a workflow definition with an LLM before you run it. It checks two things:

- **Model right-sizing** — each task step is categorized (coding, general, retrieval, review, orchestration, summarization) and its configured model is judged `ok`, `overkill`, or `underpowered` against a curated model catalog, with a cheaper or stronger suggestion where it matters.
- **Complexity** — workflow-level flags for steps that do too much, missing `stateFrom` scoping, oversized context, redundant steps, and vague objectives.

The judge runs once, at authoring time — it never adds cost to `wfm run`.

## Usage

```bash
wfm judge workflow.json
wfm judge workflow.md --adapter mock      # free dry-run, no LLM call
wfm judge workflow.json --model claude-haiku-4-5
wfm judge workflow.json --json            # machine-readable verdict
```

| Flag | Meaning |
| --- | --- |
| `--adapter <key>` | Adapter that executes the judge call (default `pi-agent`; `mock` for a dry-run) |
| `--model <model>` | Model used *for judging* (not the models being judged) |
| `--json` | Print the raw verdict JSON instead of the report |

The workflow is parsed and validated first; an invalid workflow exits with normal validation errors and never spends tokens.

## Applying suggestions

The judge is report-only. To apply its suggestions, pipe the JSON verdict to your coding agent:

```bash
wfm judge workflow.json --json > verdict.json
# then: "apply the model suggestions in verdict.json to workflow.json"
```

## Keeping the judge current

The judge's model knowledge lives in `src/modelCatalog.ts` — a small, hand-curated table of model tiers, relative cost bands, and strengths. When new models ship, update that table; the judge prompt is rendered from it.
