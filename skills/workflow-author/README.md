# workflow-author skill

Teaches a host coding agent (Claude Code, opencode, pi) how to turn a natural-language
task description into a repeatable `wfm` workflow, validate it, run it, and narrate
progress — including approval gates — back to the user.

This skill ships inside the root `@workflow-manager/runner` npm package alongside
`workflow-manager-cli`. Install it into an agent's skill directory with:

```bash
wfm skill install workflow-author                    # -> ./.claude/skills/
wfm skill install workflow-author --agent opencode    # -> ./.opencode/skill/
wfm skill install workflow-author --global            # -> ~/.claude/skills/
```

See `SKILL.md` for the full operating manual, and `doc/guide/workflow-schema.md` /
`doc/guide/runner-api.md` for the underlying schema and attach-API contract this
skill is built on.
