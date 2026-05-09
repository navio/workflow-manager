# Workflow Schema

Workflow definitions can be provided as:

- Markdown files with YAML frontmatter (`.md`)
- JSON files (`.json`)

The parser expects `key`, `title`, and `steps` at minimum.

## Minimal examples

Markdown:

```md
---
key: minimal-demo
title: Minimal Demo
steps:
  - key: plan
    kind: task
    taskSpec:
      adapterKey: mock
---
```

JSON:

```json
{
  "key": "minimal-demo",
  "title": "Minimal Demo",
  "steps": [
    {
      "key": "plan",
      "kind": "task",
      "taskSpec": {
        "adapterKey": "mock"
      }
    }
  ]
}
```

## Top-level fields

- `key` (required): unique workflow identifier
- `title` (required): default run objective
- `description`: optional summary
- `objectives`: optional list of run-level objectives
- `inputSchema`: optional JSON schema-like shape for inputs
- `outputSchema`: optional JSON schema-like shape for outputs
- `defaultRetryPolicy.maxAttempts`: fallback retry attempts for steps
- `skills`: optional map of portable skill definitions keyed by skill name
- `steps` (required): ordered list of step definitions

## Skill fields

Top-level `skills` entries let workflows declare the skill markdown needed by adapter steps.

```json
{
  "skills": {
    "demo": {
      "source": "./skills/demo/SKILL.md",
      "content": "# Demo\n\nUse this guidance.",
      "contentSha256": "64-char lowercase hex SHA-256",
      "upstream": {
        "repo": "github.com/acme/skills",
        "ref": "main",
        "path": "demo/SKILL.md"
      }
    }
  }
}
```

- `source`: optional local authoring path under `./skills/**/SKILL.md`
- `content`: optional embedded skill markdown
- `contentSha256`: optional integrity hash for embedded `content`
- `upstream.repo`, `upstream.ref`, `upstream.path`: optional audit metadata
- each skill must define `content` or `source`
- `workflow-manager publish` embeds local skill content and writes `contentSha256`
- pulled workflows must include embedded skill content for declared skills

## Step fields

- `key` (required): step id
- `kind` (required): `task | approval | system`
- `objective`: optional step-level objective
- `dependsOn`: list of prerequisite step keys
- `retryPolicy.maxAttempts`: step-level retry override
- `validation.mode`: `none | human | external`
- `validation.required`, `validation.autoConfirm`
- `taskSpec.adapterKey`: `mock | opencode | codex | claude-code`
- `taskSpec.init.context`
- `taskSpec.init.skills`
- `taskSpec.init.mcps`
- `taskSpec.init.systemPrompts`
- `taskSpec.init.model`
- `taskSpec.payload.mockResult`: `success | retry | rollback | restart | yield | fail`
- `approvalSpec.autoApprove`, `approvalSpec.validation`

## Validation rules enforced by the CLI

- step keys must be unique
- every dependency must reference an existing step
- `kind` must be one of `task`, `approval`, `system`
- adapter key must be one of the supported adapters
- validation mode must be `none`, `human`, or `external`
- skill names must contain only letters, numbers, `_`, `.`, and `-`
- skill `source` paths must stay under `./skills/**/SKILL.md`
- skill `contentSha256` must be a lowercase 64-character SHA-256 and match embedded `content`
- list fields such as `objectives`, `dependsOn`, `taskSpec.init.skills`, `taskSpec.init.mcps`, and `taskSpec.init.systemPrompts` must contain strings
- retry `maxAttempts` values must be positive integers
