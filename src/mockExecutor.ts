import type { InputEnvelope, OutputEnvelope, QaAction, StepDefinition } from "./types.js";

export function executeMockStep(step: StepDefinition, input: InputEnvelope, attempt: number): OutputEnvelope {
  const start = Date.now();
  const payload = step.taskSpec?.payload ?? {};
  const mockResult = String(payload.mockResult ?? "success").toLowerCase();
  const feedback = String(payload.feedback ?? "");

  const make = (status: OutputEnvelope["execution_status"], action: QaAction): OutputEnvelope => ({
    step_id: step.key,
    execution_status: status,
    qa_routing: {
      action,
      feedback_reason: feedback,
    },
    mutated_payload: {
      stepKey: step.key,
      attempt,
      objective: input.step_context.step_objective,
      adapter: input.priming_configuration.adapter ?? "mock",
      priming: {
        skills: input.priming_configuration.required_skills,
        mcps: input.priming_configuration.mcp_endpoints,
      },
      mockResult,
    },
    metadata: {
      execution_time_ms: Date.now() - start,
      external_intervention_required: status === "YIELD_EXTERNAL",
      intervention_details:
        status === "YIELD_EXTERNAL" ? { reason: "Awaiting human/external validation" } : undefined,
    },
  });

  if (step.kind === "approval") {
    const autoApprove = step.approvalSpec?.autoApprove ?? false;
    return autoApprove ? make("SUCCESS", "PROCEED") : make("YIELD_EXTERNAL", "PROCEED");
  }

  switch (mockResult) {
    case "retry":
      return make("QA_REJECTED", "RETRY_CURRENT");
    case "rollback":
      return make("QA_REJECTED", "ROLLBACK_PREVIOUS");
    case "restart":
      return make("QA_REJECTED", "RESTART_ALL");
    case "yield":
      return make("YIELD_EXTERNAL", "PROCEED");
    case "fail":
      return make("FAILED", "PROCEED");
    default:
      return make("SUCCESS", "PROCEED");
  }
}
