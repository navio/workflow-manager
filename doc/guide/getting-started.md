# Getting Started

## Install

```bash
npm install
npm run build
npm link
```

## CLI Commands

```bash
workflow-manager questions
workflow-manager scaffold ./example-workflow.md
workflow-manager validate ./example-workflow.md
workflow-manager run ./example-workflow.md --confirm discover,qa_gate:human
```

## Docs site

```bash
npm run docs:dev
npm run docs:build
npm run docs:preview
```

## Deploy to Netlify

This repo includes a root `netlify.toml` file configured for VitePress:

- Build command: `npm run docs:build`
- Publish directory: `doc/.vitepress/dist`

When you connect the repository in Netlify, these settings are picked up automatically.
