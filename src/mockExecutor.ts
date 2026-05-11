import type { InputEnvelope, OutputEnvelope, QaAction, StepDefinition, StepExecutionHooks } from "./types.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function chapterOutputs(previousOutput: Record<string, unknown>): Array<Record<string, unknown>> {
  return Object.values(previousOutput)
    .map((entry) => asRecord(entry))
    .filter((entry) => typeof entry.chapterMarkdown === "string");
}

export async function executeMockStep(
  step: StepDefinition,
  input: InputEnvelope,
  attempt: number,
  hooks?: StepExecutionHooks
): Promise<OutputEnvelope> {
  const start = Date.now();
  const payload = asRecord(step.taskSpec?.payload);
  const delayMs = Number(payload.delayMs ?? 0);
  const mockResult = String(payload.mockResult ?? "success").toLowerCase();
  const feedback = String(payload.feedback ?? "");

  hooks?.onStarted?.({ adapter: input.priming_configuration.adapter ?? "mock" });
  if (Number.isFinite(delayMs) && delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, Math.floor(delayMs)));
  }

  const make = (
    status: OutputEnvelope["execution_status"],
    action: QaAction,
    extraPayload: Record<string, unknown> = {},
    feedbackReason = feedback
  ): OutputEnvelope => ({
      step_id: step.key,
      execution_status: status,
      qa_routing: {
        action,
        feedback_reason: feedbackReason,
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
        ...extraPayload,
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
     const result = autoApprove ? make("SUCCESS", "PROCEED") : make("YIELD_EXTERNAL", "PROCEED");
     hooks?.onFinished?.({ executionStatus: result.execution_status });
     return result;
  }

  if (typeof payload.storyChapter === "number") {
    const chapterNumber = payload.storyChapter;
    const prompt = String(
      input.global_context.global_state.storyRequest ?? input.global_context.primary_objective ?? "a bunny story"
    );
    const paragraph =
      chapterNumber === 1
        ? `A curious bunny set out at sunrise to solve the puzzle in ${prompt}.`
        : `By sunset, the bunny used what it learned to finish ${prompt} with courage and kindness.`;

     const result = make("SUCCESS", "PROCEED", {
       chapterNumber,
       chapterTitle: `Chapter ${chapterNumber}`,
       paragraph,
       chapterMarkdown: `## Chapter ${chapterNumber}\n\n${paragraph}`,
       storyPrompt: prompt,
     });
     hooks?.onFinished?.({ executionStatus: result.execution_status });
     return result;
  }

  if (payload.validateStory === true) {
    const expectedChapters = Number(payload.requiredChapters ?? 2);
    const previousOutput = asRecord(input.step_context.previous_output);
    const chapters = chapterOutputs(previousOutput)
      .map((entry) => String(entry.chapterMarkdown))
      .join("\n\n");
    const chapterMatches = chapters.match(/^## Chapter\s+\d+/gm) ?? [];
    const hasBunnyTheme = /bunny/i.test(chapters);
    const isValid = chapterMatches.length === expectedChapters && hasBunnyTheme;

    if (!isValid) {
       const result = make(
         "QA_REJECTED",
         "RETRY_CURRENT",
         {
          expectedChapters,
          foundChapters: chapterMatches.length,
          hasBunnyTheme,
          validationPassed: false,
        },
         `Story must include exactly ${expectedChapters} chapters and bunny-themed content`
       );
       hooks?.onFinished?.({ executionStatus: result.execution_status });
       return result;
     }

     const result = make("SUCCESS", "PROCEED", {
       expectedChapters,
       foundChapters: chapterMatches.length,
       hasBunnyTheme,
       validationPassed: true,
     });
     hooks?.onFinished?.({ executionStatus: result.execution_status });
     return result;
  }

  if (payload.renderStoryMarkdown === true) {
    const previousOutput = asRecord(input.step_context.previous_output);
    const chapters = chapterOutputs(previousOutput)
      .sort((a, b) => Number(a.chapterNumber ?? 0) - Number(b.chapterNumber ?? 0))
      .map((entry) => String(entry.chapterMarkdown));

    if (chapters.length === 0) {
       const result = make("QA_REJECTED", "RETRY_CURRENT", { chapterCount: 0 }, "No chapters available to render");
       hooks?.onFinished?.({ executionStatus: result.execution_status });
       return result;
     }

    const title = String(payload.storyTitle ?? input.global_context.global_state.storyRequest ?? "Bunny Story");
    const storyMarkdown = `# ${title}\n\n${chapters.join("\n\n")}`;

     const result = make("SUCCESS", "PROCEED", {
       chapterCount: chapters.length,
       storyMarkdown,
     });
     hooks?.onFinished?.({ executionStatus: result.execution_status });
     return result;
  }

  let result: OutputEnvelope;
  switch (mockResult) {
    case "retry":
      result = make("QA_REJECTED", "RETRY_CURRENT");
      break;
    case "rollback":
      result = make("QA_REJECTED", "ROLLBACK_PREVIOUS");
      break;
    case "restart":
      result = make("QA_REJECTED", "RESTART_ALL");
      break;
    case "unknown-qa-action":
      result = make("QA_REJECTED", "UNKNOWN_QA_ACTION" as QaAction);
      break;
    case "yield":
      result = make("YIELD_EXTERNAL", "PROCEED");
      break;
    case "fail":
      result = make("FAILED", "PROCEED");
      break;
    default:
      result = make("SUCCESS", "PROCEED");
      break;
  }

  hooks?.onFinished?.({ executionStatus: result.execution_status });
  return result;
}
