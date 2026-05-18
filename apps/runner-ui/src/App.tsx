import { useEffect, useMemo, useRef, useState } from "react";
import { Background, Controls, MiniMap, ReactFlow, type Edge, type Node } from "@xyflow/react";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { resolveBootstrap } from "./lib/bootstrap";
import { RunnerApiError, RunnerClient } from "./lib/runnerClient";
import type { RunnerEventEnvelope, RunnerLogList, RunnerSessionInfo, RunSnapshot, StepDetailSnapshot } from "./lib/runnerTypes";
import { Button, Eyebrow, Field, Panel, PanelHeader, StatusBanner } from "./ui";
import { StepNode, type StepNodeData } from "./StepNode";

type LoadState =
  | { phase: "empty"; message: string }
  | { phase: "loading"; message: string }
  | { phase: "error"; message: string }
  | {
      phase: "ready";
      message: string | null;
      session: RunnerSessionInfo;
      snapshot: RunSnapshot;
      stepDetails: StepDetailSnapshot[];
      lastEvent: RunnerEventEnvelope | null;
      events: RunnerEventEnvelope[];
      connection: "connecting" | "open" | "closed";
    };

type LogState =
  | { phase: "idle"; stepKey: string | null; message: string }
  | { phase: "loading"; stepKey: string; message: string }
  | { phase: "ready"; stepKey: string; message: string | null; logs: RunnerLogList }
  | { phase: "error"; stepKey: string; message: string };

function formatSummaryList(items: string[]): string {
  if (items.length === 0) {
    return "none";
  }

  if (items.length <= 2) {
    return items.join(", ");
  }

  return `${items.slice(0, 2).join(", ")} +${items.length - 2} more`;
}

function formatContextSummary(summary: StepDetailSnapshot["config"]["contextSummary"]): string {
  if (summary.type === "none") {
    return "none";
  }

  if (summary.type === "string") {
    return `string (${summary.length ?? 0} chars)`;
  }

  return summary.keys?.length ? `object (${summary.keys.join(", ")})` : "object";
}

function formatExecutionSummary(detail: StepDetailSnapshot["lastExecution"]): string {
  const parts = [detail.executionStatus ?? "unknown", detail.qaAction ? detail.qaAction : null, detail.feedbackReason ? detail.feedbackReason : null].filter(Boolean);
  return parts.join(" / ") || "No execution history yet.";
}

function toMessage(error: unknown): string {
  if (error instanceof RunnerApiError) {
    return `${error.message}: ${error.body || "no body"}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

function createGraph(snapshot: RunSnapshot, stepDetails: StepDetailSnapshot[]): { nodes: Node<StepNodeData>[]; edges: Edge[] } {
  const details = new Map(stepDetails.map((step) => [step.stepKey, step]));
  const nodes = snapshot.steps.map((step, index) => {
    const detail = details.get(step.stepKey);
    return {
      id: step.stepKey,
      type: "step",
      position: { x: index * 260, y: detail?.kind === "approval" ? 120 : 0 },
      data: {
        title: detail?.objective ?? step.stepKey,
        kind: detail?.kind ?? "task",
        status: step.status,
        objective: detail?.objective ?? null,
        current: snapshot.currentStepKey === step.stepKey,
      },
    } satisfies Node<StepNodeData>;
  });

  const edges: Edge[] = [];
  for (const step of snapshot.steps) {
    const detail = details.get(step.stepKey);
    for (const dependency of detail?.dependsOn ?? []) {
      edges.push({
        id: `${dependency}->${step.stepKey}`,
        source: dependency,
        target: step.stepKey,
        animated: step.status === "running",
      });
    }
  }

  return { nodes, edges };
}

function resolveSelectedStepKey(snapshot: RunSnapshot, selectedStepKey: string | null): string | null {
  if (selectedStepKey && snapshot.steps.some((step) => step.stepKey === selectedStepKey)) {
    return selectedStepKey;
  }

  return snapshot.currentStepKey ?? snapshot.steps[0]?.stepKey ?? null;
}

export function App() {
  const bootstrap = useMemo(() => {
    if (typeof window === "undefined") {
      return null;
    }

    return resolveBootstrap(window.location, window.sessionStorage);
  }, []);

  const client = useMemo(() => {
    if (!bootstrap) {
      return null;
    }

    return new RunnerClient({ baseUrl: window.location.origin, runId: bootstrap.runId, token: bootstrap.token });
  }, [bootstrap]);

  const [state, setState] = useState<LoadState>(() => {
    if (!bootstrap) {
      return { phase: "empty", message: "Open this page with a Runner UI fragment like #runId=<id>&token=<token>." };
    }

    return { phase: "loading", message: "Connecting to the runner..." };
  });
  const refreshRef = useRef<Promise<void> | null>(null);
  const [selectedStepKey, setSelectedStepKey] = useState<string | null>(null);
  const [logState, setLogState] = useState<LogState>({ phase: "idle", stepKey: null, message: "Select a step to inspect logs." });
  const [approvalActor, setApprovalActor] = useState("");
  const [approvalNote, setApprovalNote] = useState("");
  const [controlState, setControlState] = useState<{ phase: "idle" | "loading" | "ok" | "err"; message: string | null }>({ phase: "idle", message: null });
  const activeRunId = state.phase === "ready" ? state.snapshot.runId : null;
  const activeStepKey = state.phase === "ready" ? resolveSelectedStepKey(state.snapshot, selectedStepKey) : null;
  const lastEventSequence = state.phase === "ready" ? state.lastEvent?.sequence ?? 0 : 0;
  const logRefreshKey = `${activeRunId ?? "idle"}:${activeStepKey ?? "none"}:${lastEventSequence}`;

  useEffect(() => {
    if (!client || typeof window === "undefined") {
      return;
    }

    let mounted = true;
    let stopStream: () => void = () => {};

    const refresh = async (): Promise<void> => {
      if (refreshRef.current) {
        return refreshRef.current;
      }

      refreshRef.current = (async () => {
        setState((current) => (current.phase === "ready" ? { ...current, message: "Refreshing run state..." } : { phase: "loading", message: "Refreshing run state..." }));
        try {
          const [session, snapshot] = await Promise.all([client.getSession(), client.getRun()]);
          const stepDetails = await Promise.all(
            snapshot.steps.map(async (step) => {
              try {
                return await client.getStep(step.stepKey);
              } catch {
                return null;
              }
            })
          );

          if (!mounted) {
            return;
          }

          const nextSelected = resolveSelectedStepKey(snapshot, null);

          setState((current) => ({
            phase: "ready",
            message: null,
            session,
            snapshot,
            stepDetails: stepDetails.filter((step): step is StepDetailSnapshot => Boolean(step)),
            lastEvent: current.phase === "ready" ? current.lastEvent : null,
            events: current.phase === "ready" ? current.events : [],
            connection: current.phase === "ready" ? current.connection : "connecting",
          }));
          setSelectedStepKey((current) => (current && snapshot.steps.some((step) => step.stepKey === current) ? current : nextSelected));
        } catch (error) {
          if (mounted) {
            setState({ phase: "error", message: toMessage(error) });
          }
        } finally {
          refreshRef.current = null;
        }
      })();

      return refreshRef.current;
    };

    void refresh();
    stopStream = client.subscribeToEvents({
      sinceSequence: 0,
      onConnectionChange: (connection) => {
        if (!mounted) {
          return;
        }

        setState((current) => (current.phase === "ready" ? { ...current, connection } : current));
      },
      onEvent: (event) => {
        if (!mounted) {
          return;
        }

        setState((current) => (current.phase === "ready" ? { ...current, lastEvent: event, events: [event, ...current.events].slice(0, 20) } : current));
        void refresh();
      },
      onError: (error) => {
        if (!mounted) {
          return;
        }

        setState((current) => (current.phase === "ready" ? { ...current, message: toMessage(error), connection: "closed" } : { phase: "error", message: toMessage(error) }));
      },
    });

    return () => {
      mounted = false;
      stopStream();
    };
  }, [client]);

  useEffect(() => {
    void logRefreshKey;
    if (!activeRunId || !client) {
      setLogState({ phase: "idle", stepKey: null, message: "Select a step to inspect logs." });
      return;
    }

    if (!activeStepKey) {
      setLogState({ phase: "idle", stepKey: null, message: "This run has no steps to display yet." });
      return;
    }

    let cancelled = false;
    setLogState({ phase: "loading", stepKey: activeStepKey, message: `Loading logs for ${activeStepKey}...` });

    void client
      .getLogs(activeRunId, activeStepKey)
      .then((logs) => {
        if (cancelled) {
          return;
        }

        setLogState({
          phase: "ready",
          stepKey: activeStepKey,
          message: logs.items.length === 0 ? "No logs yet for this step." : null,
          logs,
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setLogState({ phase: "error", stepKey: activeStepKey, message: toMessage(error) });
      });

    return () => {
      cancelled = true;
    };
  }, [activeRunId, activeStepKey, client, logRefreshKey]);

  useEffect(() => {
    if (state.phase !== "ready") {
      setApprovalActor("");
      setApprovalNote("");
      setControlState({ phase: "idle", message: null });
      return;
    }

    if (state.snapshot.waitingForApproval) {
      setApprovalActor((current) => current || state.session?.host || "runner-ui");
    }
  }, [state]);

  const graph = useMemo(() => {
    if (state.phase !== "ready") {
      return { nodes: [], edges: [] };
    }

    return createGraph(state.snapshot, state.stepDetails);
  }, [state]);

  const selectedDetail = useMemo(() => {
    if (state.phase !== "ready") {
      return null;
    }

    return activeStepKey ? state.stepDetails.find((step) => step.stepKey === activeStepKey) ?? null : null;
  }, [activeStepKey, state]);

  const selectedSnapshot = useMemo(() => {
    if (state.phase !== "ready") {
      return null;
    }

    return activeStepKey ? state.snapshot.steps.find((step) => step.stepKey === activeStepKey) ?? null : null;
  }, [activeStepKey, state]);

  async function runControl(action: "approve" | "resume" | "cancel") {
    if (state.phase !== "ready" || !client || !state.snapshot.waitingForApproval) {
      return;
    }

    setControlState({ phase: "loading", message: `${action} in progress...` });
    try {
      await client.control(action, {
        stepKey: state.snapshot.waitingForApproval.stepKey,
        actor: approvalActor.trim() || undefined,
        note: approvalNote.trim() || undefined,
        source: "runner-ui",
      });
      setControlState({ phase: "ok", message: `${action} sent.` });
    } catch (error) {
      setControlState({ phase: "err", message: toMessage(error) });
    }
  }

  function onNodeClick(_: unknown, node: Node<StepNodeData>) {
    setSelectedStepKey(node.id);
  }

  if (state.phase === "empty") {
    return (
      <main className="app-shell app-shell--centered">
        <div className="hero">
          <Eyebrow>Runner UI</Eyebrow>
          <h1>Open a run link to connect.</h1>
          <p className="hero__text">This dashboard bootstraps from the URL fragment and keeps the token in session storage only.</p>
          <Panel>
            <StatusBanner tone="warn">{state.message}</StatusBanner>
          </Panel>
        </div>
      </main>
    );
  }

  if (state.phase === "error") {
    return (
      <main className="app-shell app-shell--centered">
        <div className="hero">
          <Eyebrow>Runner UI</Eyebrow>
          <h1>Could not load the runner.</h1>
          <Panel>
            <StatusBanner tone="err">{state.message}</StatusBanner>
          </Panel>
        </div>
      </main>
    );
  }

  const snapshot = state.phase === "ready" ? state.snapshot : null;
  const connection = state.phase === "ready" ? state.connection : "connecting";
  const events = state.phase === "ready" ? state.events : [];

  return (
    <main className="app-shell">
      <header className="hero hero--compact">
        <div className="hero__copy">
          <Eyebrow>Runner UI</Eyebrow>
          <h1>{snapshot?.workflowTitle ?? "Loading workflow"}</h1>
          <p className="hero__text">
            {snapshot?.objective ?? "Waiting for run data"}
          </p>
        </div>
        <div className="hero__meta">
          <div className="meta-card">
            <span className="meta-card__label">Run</span>
            <span className="meta-card__value">{snapshot?.runId ?? bootstrap?.runId}</span>
          </div>
          <div className="meta-card">
            <span className="meta-card__label">Connection</span>
            <span className="meta-card__value">{connection}</span>
          </div>
          <div className="meta-card">
            <span className="meta-card__label">Status</span>
            <span className={`status-pill status-pill--${snapshot?.status ?? "queued"}`}>{snapshot?.status ?? "queued"}</span>
          </div>
        </div>
      </header>

      {state.phase === "ready" && state.message ? <StatusBanner tone="info">{state.message}</StatusBanner> : null}
      {state.phase === "ready" && state.connection !== "open" ? (
        <StatusBanner tone={state.connection === "closed" ? "warn" : "info"}>
          Event stream is {state.connection}. Snapshot refresh will continue when the runner reconnects.
        </StatusBanner>
      ) : null}

      <section className="workspace">
        <Panel className="workspace__graph">
          <PanelHeader>
            <div>
              <h2>Workflow graph</h2>
              <p className="muted">React Flow connected to the live runner snapshot.</p>
            </div>
            <Button type="button" onClick={() => window.location.reload()}>
              <RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" />
              Reload
            </Button>
          </PanelHeader>
          <div className="graph-canvas">
            {state.phase === "ready" && graph.nodes.length > 0 ? (
              <ReactFlow
                nodes={graph.nodes}
                edges={graph.edges}
                nodeTypes={{ step: StepNode as never }}
                fitView
                minZoom={0.3}
                maxZoom={1.5}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable
                onNodeClick={onNodeClick as never}
                proOptions={{ hideAttribution: true }}
              >
                <MiniMap zoomable pannable />
                <Controls />
                <Background gap={24} size={1} />
              </ReactFlow>
            ) : (
              <div className="empty-state">
                <LoaderCircle size={20} strokeWidth={1.75} className="spin" aria-hidden="true" />
                <p>Waiting for workflow nodes.</p>
              </div>
            )}
          </div>
        </Panel>

        <aside className="workspace__sidebar">
          <Panel>
            <PanelHeader>
              <div>
                <h2>Selected step</h2>
                <p className="muted">Same-origin API data from the current browser tab.</p>
              </div>
            </PanelHeader>
            {selectedDetail ? (
              <div className="stack-sm">
                <div className="detail-row">
                  <span className="detail-row__label">Key</span>
                  <p>{selectedDetail.stepKey}</p>
                </div>
                <div className="detail-row detail-row--inline">
                  <div>
                    <span className="detail-row__label">Status</span>
                    <p>{selectedSnapshot?.status ?? selectedDetail.status}</p>
                  </div>
                  <div>
                    <span className="detail-row__label">Attempt</span>
                    <p>{selectedSnapshot?.attempt ?? selectedDetail.attempt}</p>
                  </div>
                  <div>
                    <span className="detail-row__label">Confirmed</span>
                    <p>{selectedSnapshot?.confirmed ?? selectedDetail.confirmed ? "yes" : "no"}</p>
                  </div>
                </div>
                <div className="detail-row">
                  <span className="detail-row__label">Objective</span>
                  <p>{selectedDetail.objective ?? "No objective set."}</p>
                </div>
                <div className="detail-row">
                  <span className="detail-row__label">Depends on</span>
                  <p>{selectedDetail.dependsOn.length > 0 ? selectedDetail.dependsOn.join(", ") : "None"}</p>
                </div>
                <div className="detail-row">
                  <span className="detail-row__label">Adapter</span>
                  <p>{selectedDetail.adapter}</p>
                </div>
                <div className="detail-row">
                  <span className="detail-row__label">Config</span>
                  <p>
                    model {selectedDetail.config.model ?? "none"} / skills {formatSummaryList(selectedDetail.config.skills)} / mcp {formatSummaryList(selectedDetail.config.mcps)} / prompts {formatSummaryList(selectedDetail.config.systemPrompts)} / context {formatContextSummary(selectedDetail.config.contextSummary)}
                  </p>
                </div>
                <div className="detail-row">
                  <span className="detail-row__label">Last execution</span>
                  <p>{formatExecutionSummary(selectedDetail.lastExecution)}</p>
                </div>
                <div className="detail-row detail-row--inline">
                  <div>
                    <span className="detail-row__label">Started</span>
                    <p>{selectedDetail.startedAt ?? "not started"}</p>
                  </div>
                  <div>
                    <span className="detail-row__label">Updated</span>
                    <p>{selectedDetail.updatedAt ?? "unknown"}</p>
                  </div>
                  <div>
                    <span className="detail-row__label">Finished</span>
                    <p>{selectedDetail.finishedAt ?? "not finished"}</p>
                  </div>
                </div>
              </div>
            ) : (
              <StatusBanner tone="info">Select a graph node to inspect its details.</StatusBanner>
            )}
          </Panel>

          <Panel>
            <PanelHeader>
              <div>
                <h2>Logs</h2>
                <p className="muted">Filtered to the selected step by default.</p>
              </div>
            </PanelHeader>
            {logState.phase === "loading" ? (
              <StatusBanner tone="info">{logState.message}</StatusBanner>
            ) : logState.phase === "error" ? (
              <StatusBanner tone="err">{logState.message}</StatusBanner>
            ) : logState.phase === "idle" ? (
              <StatusBanner tone="info">{logState.message}</StatusBanner>
            ) : logState.logs.items.length === 0 ? (
              <StatusBanner tone="warn">{logState.message ?? "No logs available."}</StatusBanner>
            ) : (
              <div className="log-list">
                {logState.logs.items.map((log) => (
                  <article key={log.id} className={`log-entry log-entry--${log.stream}`}>
                    <div className="log-entry__meta">
                      <span>{log.stream}</span>
                      <span>{log.stepKey ?? "run"}</span>
                      <span>{log.occurredAt}</span>
                    </div>
                    <pre>{log.text}</pre>
                  </article>
                ))}
              </div>
            )}
          </Panel>

          <Panel>
            <PanelHeader>
              <div>
                <h2>Event timeline</h2>
                <p className="muted">Latest runner events from the SSE stream.</p>
              </div>
            </PanelHeader>
            {events.length === 0 ? (
              <StatusBanner tone="info">No live events received yet.</StatusBanner>
            ) : (
              <ol className="event-list">
                {events.map((event) => (
                  <li key={event.id} className="event-item">
                    <span className="event-item__sequence">#{event.sequence}</span>
                    <div>
                      <p>{event.type}</p>
                      <span>{event.stepKey ?? event.runId} / {event.occurredAt}</span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          {state.phase === "ready" && state.snapshot.waitingForApproval ? (
            <Panel>
              <PanelHeader>
                <div>
                  <h2>Waiting for approval</h2>
                  <p className="muted">Approve, resume, or cancel from the browser.</p>
                </div>
              </PanelHeader>
              <StatusBanner tone="warn">{state.snapshot.waitingForApproval.reason}</StatusBanner>
              {controlState.message ? <StatusBanner tone={controlState.phase === "err" ? "err" : controlState.phase === "ok" ? "ok" : "info"}>{controlState.message}</StatusBanner> : null}
              <div className="stack-sm">
                <Field label="Actor" value={approvalActor} onChange={(event) => setApprovalActor(event.currentTarget.value)} placeholder="runner-ui" />
                <Field label="Note" value={approvalNote} onChange={(event) => setApprovalNote(event.currentTarget.value)} placeholder="Optional note" />
                <div className="cluster">
                  <Button type="button" onClick={() => void runControl("approve")}>
                    Approve
                  </Button>
                  <Button type="button" onClick={() => void runControl("resume")}>
                    Resume
                  </Button>
                  <Button type="button" onClick={() => void runControl("cancel")}>
                    Cancel
                  </Button>
                </div>
              </div>
            </Panel>
          ) : null}
        </aside>
      </section>
    </main>
  );
}
