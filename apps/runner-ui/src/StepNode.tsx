import { Handle, Position } from "@xyflow/react";
import type { StepKind, StepRunStatus } from "./lib/runnerTypes";

export interface StepNodeData extends Record<string, unknown> {
  [key: string]: unknown;
  title: string;
  kind: StepKind;
  status: StepRunStatus;
  objective: string | null;
  current: boolean;
}

function statusLabel(status: StepRunStatus): string {
  return status.replaceAll("_", " ");
}

export function StepNode({ data, selected }: { data: StepNodeData; selected?: boolean }) {
  const stepData = data;
  return (
    <article className={["step-node", `step-node--${stepData.status}`, stepData.current && "step-node--current", selected && "step-node--selected"].filter(Boolean).join(" ")}>
      <Handle type="target" position={Position.Left} />
      <div className="step-node__meta">
        <span className="step-node__kind">{stepData.kind}</span>
        <span className="step-node__status">{statusLabel(stepData.status)}</span>
      </div>
      <h3 className="step-node__title">{stepData.title}</h3>
      {stepData.objective ? <p className="step-node__objective">{stepData.objective}</p> : null}
      <Handle type="source" position={Position.Right} />
    </article>
  );
}
