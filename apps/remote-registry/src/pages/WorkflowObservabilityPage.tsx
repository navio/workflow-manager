import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { ArrowLeft, Info, LoaderCircle } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { fetchManagedWorkflow, fetchWorkflowObservability } from "../lib/remoteApi";
import type { ObservabilityRuntimeBreakdownEntry, ObservabilityStepBreakdownEntry, ObservabilityWindow } from "../types";
import { LinkButton } from "../ui/Button";
import { Field } from "../ui/Field";
import { Eyebrow } from "../ui/Panel";
import { Pill } from "../ui/Pill";
import { StatusBanner } from "../ui/StatusBanner";

const WINDOW_OPTIONS: ObservabilityWindow[] = ["7d", "30d", "90d"];
const COMMUNITY_TOOLTIP = "Aggregated across at least 5 distinct authenticated users. No individual activity is shown.";

function formatMs(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function RuntimeRow({ entry }: { entry: ObservabilityRuntimeBreakdownEntry }) {
  return (
    <tr>
      <td className="tabular">{entry.adapter}</td>
      <td className="tabular">{entry.requestedModel ?? "default"}</td>
      {entry.suppressed ? (
        <td colSpan={4} className="muted">
          Not enough anonymous usage yet
        </td>
      ) : (
        <>
          <td>{entry.totalRuns}</td>
          <td>{entry.successRate}%</td>
          <td>{formatMs(entry.p50DurationMs)}</td>
          <td>{formatMs(entry.p95DurationMs)}</td>
        </>
      )}
    </tr>
  );
}

function StepRow({ entry }: { entry: ObservabilityStepBreakdownEntry }) {
  return (
    <tr>
      <td className="tabular">{entry.stepKey}</td>
      <td className="tabular">{entry.adapter}</td>
      <td className="tabular">{entry.requestedModel ?? "default"}</td>
      {entry.suppressed ? (
        <td colSpan={3} className="muted">
          Not enough anonymous usage yet
        </td>
      ) : (
        <>
          <td>{entry.totalExecutions}</td>
          <td>{entry.successRate}%</td>
          <td>{formatMs(entry.p95ExecutionDurationMs)}</td>
        </>
      )}
    </tr>
  );
}

export function WorkflowObservabilityPage() {
  const { session } = useAuth();
  const { slug = "" } = useParams();
  const [versionLabel, setVersionLabel] = useState<string | undefined>(undefined);
  const [windowValue, setWindowValue] = useState<ObservabilityWindow>("30d");

  const managed = useQuery({
    queryKey: ["managed-workflow", session?.access_token, slug],
    queryFn: () => fetchManagedWorkflow(session!.access_token, slug),
    enabled: Boolean(session?.access_token && slug),
  });

  const observability = useQuery({
    queryKey: ["workflow-observability", session?.access_token, slug, versionLabel, windowValue],
    queryFn: () => fetchWorkflowObservability(session!.access_token, slug, { version: versionLabel, window: windowValue }),
    enabled: Boolean(session?.access_token && slug),
  });

  if (!session) {
    return (
      <div className="stack-lg">
        <Eyebrow>Session</Eyebrow>
        <p className="muted">Session expired. Please sign in again.</p>
      </div>
    );
  }

  const versions = managed.data?.versions ?? [];
  const data = observability.data;

  return (
    <div className="stack-lg">
      <div className="stack-sm">
        <Eyebrow>
          Dashboard / observability / <span className="tabular">{slug}</span>
        </Eyebrow>
        <div className="cluster between" style={{ alignItems: "flex-start" }}>
          <h1>{managed.data?.title ?? slug} health</h1>
          <LinkButton to={`/dashboard/workflows/${slug}`} variant="ghost" leading={<ArrowLeft size={14} strokeWidth={2} aria-hidden="true" />}>
            Back to manage
          </LinkButton>
        </div>
        <p className="muted page-lede">
          Run health, timing, and runtime adoption for this published workflow version — plus an anonymous
          community benchmark once enough other users have run it.
        </p>
      </div>

      <div className="panel stack">
        <div className="cluster">
          <Field label="Version">
            <select value={versionLabel ?? ""} onChange={(event) => setVersionLabel(event.target.value || undefined)}>
              <option value="">Latest</option>
              {versions.map((version) => (
                <option key={version.id} value={version.version}>
                  {version.version}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Window">
            <select value={windowValue} onChange={(event) => setWindowValue(event.target.value as ObservabilityWindow)}>
              {WINDOW_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  Last {option.replace("d", "")} days
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      {observability.isLoading && (
        <div className="state-surface" role="status">
          <LoaderCircle size={20} strokeWidth={1.75} className="state-surface__spinner" aria-hidden="true" />
          <div className="empty__title">Loading observability</div>
          <div className="muted">Aggregating run health for this workflow…</div>
        </div>
      )}

      {observability.isError && (
        <StatusBanner tone="err">
          {observability.error instanceof Error ? observability.error.message : "Failed to load observability data"}
        </StatusBanner>
      )}

      {data && (
        <>
          <div className="panel stack">
            <div className="section-heading">
              <Eyebrow>Your workflow's health</Eyebrow>
              <Pill tone="muted">{data.workflow.versionLabel ?? "latest"}</Pill>
            </div>
            {data.owner.totalRuns === 0 ? (
              <div className="empty panel-state">
                <div className="empty__title">No runs recorded yet for this window</div>
                <div className="muted">Run this workflow from the authenticated CLI to start collecting health data.</div>
              </div>
            ) : (
              <div className="kpi">
                <div className="kpi__card">
                  <span className="kpi__label">Total runs</span>
                  <span className="kpi__value">{data.owner.totalRuns}</span>
                  <span className="kpi__hint">
                    {data.owner.retriedRuns} retried · {data.owner.waitingRuns} awaiting approval
                  </span>
                </div>
                <div className="kpi__card">
                  <span className="kpi__label">Success rate</span>
                  <span className="kpi__value">{data.owner.successRate}%</span>
                  <span className="kpi__hint">{data.owner.failedRuns} failed</span>
                </div>
                <div className="kpi__card">
                  <span className="kpi__label">p50 duration</span>
                  <span className="kpi__value">{formatMs(data.owner.p50DurationMs)}</span>
                  <span className="kpi__hint">median run time</span>
                </div>
                <div className="kpi__card">
                  <span className="kpi__label">p95 duration</span>
                  <span className="kpi__value">{formatMs(data.owner.p95DurationMs)}</span>
                  <span className="kpi__hint">tail run time</span>
                </div>
              </div>
            )}
          </div>

          <div className="panel stack">
            <Eyebrow>Runtime &amp; model adoption</Eyebrow>
            {data.byRuntime.length === 0 ? (
              <p className="muted">No step executions recorded for this window yet.</p>
            ) : (
              <div className="obs-table-wrap">
                <table className="obs-table">
                  <thead>
                    <tr>
                      <th>Adapter</th>
                      <th>Model</th>
                      <th>Executions</th>
                      <th>Success</th>
                      <th>p50</th>
                      <th>p95</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byRuntime.map((entry) => (
                      <RuntimeRow key={`${entry.adapter}::${entry.requestedModel ?? ""}`} entry={entry} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="panel stack">
            <Eyebrow>Slowest steps</Eyebrow>
            {data.steps.length === 0 ? (
              <p className="muted">No step executions recorded for this window yet.</p>
            ) : (
              <div className="obs-table-wrap">
                <table className="obs-table">
                  <thead>
                    <tr>
                      <th>Step</th>
                      <th>Adapter</th>
                      <th>Model</th>
                      <th>Executions</th>
                      <th>Success</th>
                      <th>p95</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.steps]
                      .sort((a, b) => b.p95ExecutionDurationMs - a.p95ExecutionDurationMs)
                      .map((entry) => (
                        <StepRow key={`${entry.stepKey}::${entry.adapter}::${entry.requestedModel ?? ""}`} entry={entry} />
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="panel stack">
            <div className="cluster-sm" style={{ alignItems: "center" }}>
              <Eyebrow>Anonymous community benchmark</Eyebrow>
              <span className="obs-info-tooltip" title={COMMUNITY_TOOLTIP} role="img" aria-label={COMMUNITY_TOOLTIP}>
                <Info size={14} strokeWidth={1.75} aria-hidden="true" />
              </span>
            </div>
            {data.community.suppressed ? (
              <div className="empty panel-state">
                <div className="empty__title">Not enough anonymous usage yet</div>
                <div className="muted">
                  This benchmark unlocks once at least 5 distinct authenticated users have run this workflow
                  version. No individual activity is ever shown.
                </div>
              </div>
            ) : (
              <div className="kpi">
                <div className="kpi__card">
                  <span className="kpi__label">Distinct users</span>
                  <span className="kpi__value">{data.community.distinctUsers}</span>
                  <span className="kpi__hint">anonymous cohort</span>
                </div>
                <div className="kpi__card">
                  <span className="kpi__label">Success rate</span>
                  <span className="kpi__value">{data.community.successRate}%</span>
                  <span className="kpi__hint">{data.community.totalRuns} community runs</span>
                </div>
                <div className="kpi__card">
                  <span className="kpi__label">p50 duration</span>
                  <span className="kpi__value">{formatMs(data.community.p50DurationMs)}</span>
                  <span className="kpi__hint">median run time</span>
                </div>
                <div className="kpi__card">
                  <span className="kpi__label">p95 duration</span>
                  <span className="kpi__value">{formatMs(data.community.p95DurationMs)}</span>
                  <span className="kpi__hint">tail run time</span>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
