export const MAN_PAGE_SOURCE = `.TH WFM 1 "April 2026" "@workflow-manager/runner" "User Commands"
.SH NAME
wfm \\- run markdown or json workflows from the CLI
.SH SYNOPSIS
.B wfm
.I command
[options]
.SH DESCRIPTION
wfm parses a workflow definition file, validates it, and executes
it with deterministic in-memory orchestration.

Workflow files can be Markdown with YAML frontmatter or JSON.
.SH COMMANDS
.TP
.B doctor [workflow.md|workflow.json] [--json]
Inspect host adapter setup, LLM access keys, and current adapter implementation status. When a workflow path is provided, also validate schema and runtime requirements without executing steps.
.TP
.B skill list
List the agent skills bundled with the npm package.
.TP
.B skill install [name ...] [--agent claude|opencode] [--global] [--dir path] [--all] [--force]
Install bundled agent skills into an agent skill directory. Defaults to the workflow-manager-cli skill and the project-level Claude Code directory (./.claude/skills). Existing skills are not overwritten unless --force is passed.
.TP
.B scaffold [path] [--format markdown|json] [--template default|agent-validated]
Create a starter workflow file. Format defaults to markdown unless the output
path ends in .json. Template defaults to default (the general multi-step example);
agent-validated scaffolds a compact pipeline demonstrating first-class agent
validation (validation.mode: agent with a validator agent and criteria).
.TP
.B validate <workflow.md|workflow.json>
Validate workflow structure and report schema errors.
.TP
.B run <workflow.md|workflow.json> [--input input.json] [--objective text] [--confirm list] [--auto-confirm-all] [--port number] [--session-file path] [--verbose] [--json] [--ui]
Run the workflow with live CLI progress and optional JSON output.
.TP
.B approve [--url value] [--token value] [--session-file path] [--run-id value] [--step value] [--actor value] [--note text]
Approve the current waiting runner step through the local attach API.
.TP
.B resume [--url value] [--token value] [--session-file path] [--run-id value] [--step value] [--actor value] [--note text]
Alias for approve, intended for external resume flows.
.TP
.B cancel [--url value] [--token value] [--session-file path] [--run-id value] [--step value] [--actor value] [--note text]
Cancel the current waiting runner step through the local attach API.
.TP
.B status [--url value] [--token value] [--session-file path] [--run-id value] [--step key]
Print the current run snapshot (or one step detail with --step) as JSON on stdout.
.TP
.B logs [--url value] [--token value] [--session-file path] [--run-id value] [--step key] [--limit number] [--cursor value]
Print buffered agent stdout/stderr chunks as JSON on stdout.
.TP
.B events [--url value] [--token value] [--session-file path] [--run-id value] [--since sequence] [--include-logs]
Print run events as JSON on stdout in a single poll (no streaming). Log events are excluded unless --include-logs is passed.
.TP
.B auth <login|whoami|logout> [--token value]
Manage remote registry authentication for CLI publish and pull flows.
.TP
.B publish <workflow.md|workflow.json> [--slug slug] [--title text] [--description text] [--visibility public|private] [--version label] [--tag a,b] [--draft]
Publish a validated local workflow to the remote registry.
.TP
.B pull <owner/slug> [--version label] [--output path]
Download a remote workflow and write it to a local file.
.TP
.B search [query]
Search public workflows from the remote registry.
.TP
.B remote info <owner/slug>
Show metadata and source information for a remote workflow.
.TP
.B man
Open this man page.
.TP
.B --version, -v, version
Print the installed wfm version and exit.
.SH RUN OPTIONS
.TP
.B --input <path>
JSON file merged into global workflow input state.
.TP
.B --objective <text>
Override the default run objective.
.TP
.B --confirm <stepA,stepB:human,...>
Provide explicit confirmations for steps that require validation.
.TP
.B --auto-confirm-all
Bypass confirmation gating for all steps.
.TP
.B --port <number>
Bind the local attach API to a specific port. If omitted, the OS assigns a free port on 127.0.0.1.
.TP
.B --session-file <path>
Write attach connection details (base URL, bearer token, run id, pid, timestamps) to a JSON file with mode 0600 when the run starts, and rewrite it with endedAt and the final status when the run finishes. Attach commands (approve, resume, cancel, status, logs, events) accept the same flag to read those details back.
.TP
.B --verbose
Stream per-step agent output and execution updates to stderr while the workflow runs.
.TP
.B --json
Print the final run result as JSON on stdout while keeping live progress on stderr.
.TP
.B --ui
Full-screen terminal UI (requires a TTY; falls back to standard output).
.TP
Human approval steps in an interactive terminal show an inline review prompt so they can be approved or cancelled without a separate HTTP client.
.TP
.B --url <value>
Runner attach API base URL for approve, resume, cancel, status, logs, or events commands.
.TP
.B --token <value>
Runner attach API bearer token for approve, resume, cancel, status, logs, or events commands.
.TP
.B --run-id <value>
Runner id to control. If omitted, the CLI reads it from /session.
.TP
.B --step <value>
Optional step key when controlling a specific waiting step, or when scoping status and logs output.
.TP
.B --limit <number>
Maximum number of log chunks returned by the logs command. Defaults to 200.
.TP
.B --cursor <value>
Pagination cursor for the logs command, taken from a previous nextCursor value.
.TP
.B --since <sequence>
Only return events with a sequence greater than this value in the events command.
.TP
.B --include-logs
Include agent.stdout and agent.stderr events in the events command output.
.TP
.B --actor <value>
Actor name recorded in approval audit events.
.TP
.B --note <text>
Optional approval or cancellation note recorded in the event payload.
.SH EXAMPLES
.TP
Validate markdown workflow:
.B wfm validate ./example-workflow.md
.TP
Validate json workflow:
.B wfm validate ./example-workflow.json
.TP
Scaffold json workflow file:
.B wfm scaffold ./new-workflow.json --format json
.TP
Scaffold an agent-validated pipeline example:
.B wfm scaffold ./agent-validated.md --template agent-validated
.TP
Authenticate with a CLI token:
.B wfm auth login --token wm_exampletoken
.TP
Publish a workflow:
.B wfm publish ./example-workflow.json --visibility public --tag example,automation
.TP
Pull a remote workflow:
.B wfm pull alice/remote-bunny --output ./remote-bunny.json
.TP
Search the remote registry:
.B wfm search bunny
.TP
Run with explicit confirmations:
.B wfm run ./example-workflow.json --confirm discover:human,qa_gate:human
.TP
Run with a session file for attach clients:
.B wfm run ./example-workflow.json --session-file ./run-session.json
.TP
Observe and control the run through the session file:
.B wfm status --session-file ./run-session.json && wfm approve --session-file ./run-session.json --step qa_gate
.TP
Inspect host setup:
.B wfm doctor
.TP
Check a workflow before running it:
.B wfm doctor ./example-workflow.json
.TP
Install the bundled CLI skill for Claude Code:
.B wfm skill install
.TP
Install every bundled skill globally:
.B wfm skill install --all --global
.SH FILES
.TP
.B man/wfm.1
The manual page source shipped with this repository.
.SH EXIT STATUS
.TP
.B 0
Successful command execution.
.TP
.B 1
Validation or runtime error.
.TP
.B 2
Run completed in non-success terminal status.
`;
