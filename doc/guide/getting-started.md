# Getting Started

## Install and build

```bash
npm install
npm run build
npm link
```

## Core CLI commands

```bash
workflow-manager questions
workflow-manager scaffold ./example-workflow.md
workflow-manager validate ./example-workflow.md
workflow-manager run ./example-workflow.md --confirm discover,qa_gate:human
```

## Typical workflow

1. Run `workflow-manager questions` to gather design requirements for a new workflow.
2. Run `workflow-manager scaffold ./example-workflow.md` to generate a starter file.
3. Edit frontmatter with your steps, dependencies, validation, and adapter init config.
4. Run `workflow-manager validate ./example-workflow.md` until validation passes.
5. Run `workflow-manager run ./example-workflow.md` and inspect the JSON run report.

## Run docs locally

```bash
npm run docs:dev
npm run docs:build
npm run docs:preview
```
