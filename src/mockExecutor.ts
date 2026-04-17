import type { InputEnvelope, OutputEnvelope, QaAction, StepDefinition } from "./types.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function chapterOutputs(previousOutput: Record<string, unknown>): Array<Record<string, unknown>> {
  return Object.values(previousOutput)
    .map((entry) => asRecord(entry))
    .filter((entry) => typeof entry.chapterMarkdown === "string");
}

export function executeMockStep(step: StepDefinition, input: InputEnvelope, attempt: number): OutputEnvelope {
  const start = Date.now();
  const payload = asRecord(step.taskSpec?.payload);
  const mockResult = String(payload.mockResult ?? "success").toLowerCase();
  const feedback = String(payload.feedback ?? "");

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
    return autoApprove ? make("SUCCESS", "PROCEED") : make("YIELD_EXTERNAL", "PROCEED");
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

    return make("SUCCESS", "PROCEED", {
      chapterNumber,
      chapterTitle: `Chapter ${chapterNumber}`,
      paragraph,
      chapterMarkdown: `## Chapter ${chapterNumber}\n\n${paragraph}`,
      storyPrompt: prompt,
    });
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
      return make(
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
    }

    return make("SUCCESS", "PROCEED", {
      expectedChapters,
      foundChapters: chapterMatches.length,
      hasBunnyTheme,
      validationPassed: true,
    });
  }

  if (payload.renderStoryMarkdown === true) {
    const previousOutput = asRecord(input.step_context.previous_output);
    const chapters = chapterOutputs(previousOutput)
      .sort((a, b) => Number(a.chapterNumber ?? 0) - Number(b.chapterNumber ?? 0))
      .map((entry) => String(entry.chapterMarkdown));

    if (chapters.length === 0) {
      return make("QA_REJECTED", "RETRY_CURRENT", { chapterCount: 0 }, "No chapters available to render");
    }

    const title = String(payload.storyTitle ?? input.global_context.global_state.storyRequest ?? "Bunny Story");
    const storyMarkdown = `# ${title}\n\n${chapters.join("\n\n")}`;

    return make("SUCCESS", "PROCEED", {
      chapterCount: chapters.length,
      storyMarkdown,
    });
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
