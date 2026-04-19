# workflow-manager

`workflow-manager` is a CLI for defining and executing workflows from Markdown frontmatter.

It is designed for agentic and human-in-the-loop execution where each step can have:

- objective-driven prompts
- explicit dependencies
- adapter initialization (skills, MCPs, model, system prompts)
- validation and confirmation rules
- retry, rollback, and restart behavior

## Highlights

- Markdown-native workflow definitions
- Deterministic in-memory execution engine
- Event timeline output for auditability
- Validation support (`none`, `human`, `external`)
- Step adapters (`mock`, `opencode`, `codex`, `claude-code`)

## Quick links

- [Getting Started](/guide/getting-started)
- [How It Works](/guide/how-it-works)
- [Architecture](/guide/architecture)
- [Remote Registry Architecture](/remote-registry/)
- [Remote Registry Agent Team](/remote-registry/agents)
- [Remote Registry Tasks](/remote-registry/tasks)
- [ERD](/guide/erd)
- [Protocol](/guide/protocol)
- [Workflow Schema](/guide/workflow-schema)
- [Workflow Examples](/guide/workflow-examples)
