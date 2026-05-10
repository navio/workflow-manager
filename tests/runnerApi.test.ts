import { afterEach, describe, expect, it } from "bun:test";
import { runWorkflow } from "../src/engine.ts";
import { startRunnerApiServer } from "../src/runnerApi.ts";
import { RunnerSessionStore } from "../src/runnerSession.ts";
import type { RunEvent, WorkflowDefinition } from "../src/types.ts";

interface RunnerApiServerHandle {
  close: () => Promise<void>;
}

const servers: RunnerApiServerHandle[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await server?.close();
  }
});

function workflowWithDelay(delayMs = 250): WorkflowDefinition {
  return {
    key: "runner-api-demo",
    title: "Runner API Demo",
    steps: [
      {
        key: "plan",
        kind: "task",
        objective: "Plan the work",
        validation: { mode: "none", required: false, autoConfirm: true },
        taskSpec: {
          adapterKey: "mock",
          init: {
            skills: ["planning"],
            mcps: ["mcp://repo"],
            systemPrompts: ["Be concise"],
            context: { repo: "demo" },
            model: "mock-model",
          },
          payload: { mockResult: "success", delayMs },
        },
      },
    ],
  };
}

function approvalWorkflow(): WorkflowDefinition {
  return {
    key: "runner-api-approval",
    title: "Runner API Approval",
    steps: [
      {
        key: "review",
        kind: "task",
        objective: "Review the plan",
        validation: { mode: "human", required: true, autoConfirm: false },
        taskSpec: {
          adapterKey: "mock",
          payload: { mockResult: "success" },
        },
      },
    ],
  };
}

function externalApprovalWorkflow(): WorkflowDefinition {
  return {
    key: "runner-api-external",
    title: "Runner API External",
    steps: [
      {
        key: "deploy",
        kind: "task",
        objective: "Resume after external validation",
        validation: { mode: "external", required: true, autoConfirm: false },
        taskSpec: {
          adapterKey: "mock",
          payload: { mockResult: "success" },
        },
      },
    ],
  };
}

function attachedTransitionWorkflow(): WorkflowDefinition {
  let attempts = 0;
  return {
    key: "runner-api-attached-transition",
    title: "Runner API Attached Transition",
    defaultRetryPolicy: { maxAttempts: 2 },
    steps: [
      {
        key: "draft",
        kind: "task",
        validation: { mode: "none", required: false, autoConfirm: true },
        retryPolicy: { maxAttempts: 2 },
        taskSpec: {
          adapterKey: "mock",
          payload: {
            get mockResult() {
              return attempts++ === 0 ? "retry" : "success";
            },
            delayMs: 40,
          } as unknown as Record<string, unknown>,
        },
      },
      {
        key: "review",
        kind: "task",
        dependsOn: ["draft"],
        validation: { mode: "human", required: true, autoConfirm: false },
        taskSpec: {
          adapterKey: "mock",
          payload: { mockResult: "success", delayMs: 40 },
        },
      },
    ],
  };
}

async function readSseUntil(reader: ReadableStreamDefaultReader<Uint8Array>, token: string): Promise<string> {
  const decoder = new TextDecoder();
  let output = "";
  const deadline = Date.now() + 3000;

  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    output += decoder.decode(value, { stream: true });
    if (output.includes(token)) {
      return output;
    }
  }

  throw new Error(`Timed out waiting for SSE token: ${token}`);
}

async function waitForRunStatus(
  baseUrl: string,
  runId: string,
  headers: HeadersInit,
  status: string,
  timeoutMs = 3000
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/runs/${runId}`, { headers });
    const snapshot = (await response.json()) as Record<string, unknown>;
    if (snapshot.status === status) {
      return snapshot;
    }
    await Bun.sleep(25);
  }

  throw new Error(`Timed out waiting for run status ${status}`);
}

function event(
  runId: string,
  sequenceNumber: number,
  type: RunEvent["type"],
  payload: Record<string, unknown>,
  stepRunId?: string
): RunEvent {
  return {
    id: `evt-${sequenceNumber}`,
    runId,
    stepRunId,
    type,
    sequenceNumber,
    occurredAt: new Date(1_700_000_000_000 + sequenceNumber).toISOString(),
    actor: "test",
    payload,
  };
}

describe("runner API", () => {
  it("serves authenticated snapshots, details, and SSE events while a run is active", async () => {
    const workflow = workflowWithDelay();
    const runId = "run-api-test";
    const store = new RunnerSessionStore({
      runId,
      workflow,
      objective: workflow.title,
      objectives: [],
    });
    const server = await startRunnerApiServer(store, 0);
    servers.push(server);

    const headers = { Authorization: `Bearer ${store.attachToken()}` };
    const baseUrl = store.sessionInfo().baseUrl;
    const runPromise = runWorkflow(workflow, {
      runId,
      autoConfirmAll: true,
      observer: store,
      controller: store,
    });

    await Bun.sleep(50);

    const healthResponse = await fetch(`${baseUrl}/health`);
    expect(healthResponse.status).toBe(200);

    const unauthorized = await fetch(`${baseUrl}/session`);
    expect(unauthorized.status).toBe(401);

    const sessionResponse = await fetch(`${baseUrl}/session`, { headers });
    expect(sessionResponse.status).toBe(200);
    const session = (await sessionResponse.json()) as Record<string, unknown>;
    expect(session.port).toBe(server.port);
    expect((session.run as Record<string, unknown>).runId).toBe(runId);

    const snapshotResponse = await fetch(`${baseUrl}/runs/${runId}`, { headers });
    expect(snapshotResponse.status).toBe(200);
    const snapshot = (await snapshotResponse.json()) as Record<string, unknown>;
    expect(snapshot.status).toBe("running");
    expect(snapshot.currentStepKey).toBe("plan");

    const stepResponse = await fetch(`${baseUrl}/runs/${runId}/steps/plan`, { headers });
    expect(stepResponse.status).toBe(200);
    const step = (await stepResponse.json()) as Record<string, unknown>;
    expect(step.status).toBe("running");
    expect((step.config as Record<string, unknown>).model).toBe("mock-model");
    expect((step.config as Record<string, unknown>).skills).toEqual(["planning"]);

    const sseResponse = await fetch(`${baseUrl}/runs/${runId}/events?includeLogs=false`, { headers });
    expect(sseResponse.status).toBe(200);
    const reader = sseResponse.body?.getReader();
    expect(reader).toBeDefined();
    const sseOutput = await readSseUntil(reader!, "event: step.execution_started");
    expect(sseOutput).toContain("event: run.created");
    expect(sseOutput).toContain("event: run.started");
    expect(sseOutput).toContain("event: step.execution_started");
    await reader?.cancel();

    const result = await runPromise;
    expect(result.status).toBe("succeeded");

    const logsResponse = await fetch(`${baseUrl}/runs/${runId}/logs`, { headers });
    expect(logsResponse.status).toBe(200);
    const logs = (await logsResponse.json()) as Record<string, unknown>;
    expect(logs.items).toEqual([]);
  });

  it("approves a waiting run through the API and lets execution continue", async () => {
    const workflow = approvalWorkflow();
    const runId = "run-approval-test";
    const store = new RunnerSessionStore({
      runId,
      workflow,
      objective: workflow.title,
      objectives: [],
    });
    const server = await startRunnerApiServer(store, 0);
    servers.push(server);

    const headers = {
      Authorization: `Bearer ${store.attachToken()}`,
      "Content-Type": "application/json",
    };
    const baseUrl = store.sessionInfo().baseUrl;
    const runPromise = runWorkflow(workflow, {
      runId,
      observer: store,
      controller: store,
    });

    const snapshot = await waitForRunStatus(baseUrl, runId, headers, "waiting_for_approval");
    expect(snapshot?.status).toBe("waiting_for_approval");
    const approvalState = snapshot.waitingForApproval as { preview?: { summary?: string; items?: Array<{ stepKey?: string }> } };
    expect(approvalState.preview?.summary).toContain("Approve the results of review");
    expect(approvalState.preview?.items?.some((item) => item.stepKey === "review")).toBe(true);
    const approveResponse = await fetch(`${baseUrl}/runs/${runId}/approve`, {
      method: "POST",
      headers,
      body: JSON.stringify({ stepKey: "review", actor: "qa-user", note: "looks good", source: "ui" }),
    });
    expect(approveResponse.status).toBe(200);

    const result = await runPromise;
    expect(result.status).toBe("succeeded");
    const resolved = result.events.find((event) => event.type === "approval.resolved");
    expect(resolved).toBeDefined();
    expect(resolved?.payload.actor).toBe("qa-user");
    expect(resolved?.payload.note).toBe("looks good");
    expect(resolved?.payload.source).toBe("ui");
  });

  it("cancels a waiting run through the API", async () => {
    const workflow = approvalWorkflow();
    const runId = "run-cancel-test";
    const store = new RunnerSessionStore({
      runId,
      workflow,
      objective: workflow.title,
      objectives: [],
    });
    const server = await startRunnerApiServer(store, 0);
    servers.push(server);

    const headers = {
      Authorization: `Bearer ${store.attachToken()}`,
      "Content-Type": "application/json",
    };
    const baseUrl = store.sessionInfo().baseUrl;
    const runPromise = runWorkflow(workflow, {
      runId,
      observer: store,
      controller: store,
    });

    const snapshot = await waitForRunStatus(baseUrl, runId, headers, "waiting_for_approval");
    expect(snapshot?.status).toBe("waiting_for_approval");
    const approvalState = snapshot.waitingForApproval as { preview?: { summary?: string } };
    expect(approvalState.preview?.summary).toContain("Approve the results of review");
    const cancelResponse = await fetch(`${baseUrl}/runs/${runId}/cancel`, {
      method: "POST",
      headers,
      body: JSON.stringify({ stepKey: "review", actor: "qa-user", note: "stop this", source: "ui" }),
    });
    expect(cancelResponse.status).toBe(200);

    const result = await runPromise;
    expect(result.status).toBe("cancelled");
    const cancelled = result.events.find((event) => event.type === "run.cancelled");
    expect(cancelled).toBeDefined();
    expect(cancelled?.payload.reason).toBe("stop this");
    expect(cancelled?.payload.source).toBe("ui");
  });

  it("resumes an externally gated run through the API", async () => {
    const workflow = externalApprovalWorkflow();
    const runId = "run-resume-test";
    const store = new RunnerSessionStore({ runId, workflow, objective: workflow.title, objectives: [] });
    const server = await startRunnerApiServer(store, 0);
    servers.push(server);

    const headers = {
      Authorization: `Bearer ${store.attachToken()}`,
      "Content-Type": "application/json",
    };
    const baseUrl = store.sessionInfo().baseUrl;
    const runPromise = runWorkflow(workflow, { runId, observer: store, controller: store });

    const snapshot = await waitForRunStatus(baseUrl, runId, headers, "waiting_for_approval");
    expect(snapshot.waitingForApproval).toBeDefined();
    const approvalState = snapshot.waitingForApproval as { preview?: { summary?: string } };
    expect(approvalState.preview?.summary).toContain("Approve the results of deploy");

    const response = await fetch(`${baseUrl}/runs/${runId}/resume`, {
      method: "POST",
      headers,
      body: JSON.stringify({ actor: "deployer", note: "external checks passed", source: "deploy-ui" }),
    });
    expect(response.status).toBe(200);

    const result = await runPromise;
    expect(result.status).toBe("succeeded");
    const resolved = result.events.find((entry) => entry.type === "approval.resolved");
    expect(resolved?.payload.actor).toBe("deployer");
    expect(resolved?.payload.source).toBe("deploy-ui");
  });

  it("returns 404, 400, and 409 for runner control error cases", async () => {
    const workflow = approvalWorkflow();
    const runId = "run-error-test";
    const store = new RunnerSessionStore({ runId, workflow, objective: workflow.title, objectives: [] });
    const server = await startRunnerApiServer(store, 0);
    servers.push(server);

    const headers = {
      Authorization: `Bearer ${store.attachToken()}`,
      "Content-Type": "application/json",
    };
    const baseUrl = store.sessionInfo().baseUrl;
    const runPromise = runWorkflow(workflow, { runId, observer: store, controller: store });

    const missingRun = await fetch(`${baseUrl}/runs/missing/approve`, {
      method: "POST",
      headers,
      body: JSON.stringify({ stepKey: "review" }),
    });
    expect(missingRun.status).toBe(404);

    await waitForRunStatus(baseUrl, runId, headers, "waiting_for_approval");

    const invalidBody = await fetch(`${baseUrl}/runs/${runId}/approve`, {
      method: "POST",
      headers,
      body: "not-json",
    });
    expect(invalidBody.status).toBe(400);

    const wrongStep = await fetch(`${baseUrl}/runs/${runId}/approve`, {
      method: "POST",
      headers,
      body: JSON.stringify({ stepKey: "wrong-step" }),
    });
    expect(wrongStep.status).toBe(409);

    const okResponse = await fetch(`${baseUrl}/runs/${runId}/approve`, {
      method: "POST",
      headers,
      body: JSON.stringify({ stepKey: "review" }),
    });
    expect(okResponse.status).toBe(200);

    const repeated = await fetch(`${baseUrl}/runs/${runId}/approve`, {
      method: "POST",
      headers,
      body: JSON.stringify({ stepKey: "review" }),
    });
    expect(repeated.status).toBe(409);

    const result = await runPromise;
    expect(result.status).toBe("succeeded");
  });

  it("replays SSE events and paginates buffered logs", async () => {
    const workflow = workflowWithDelay(1);
    const runId = "run-replay-test";
    const store = new RunnerSessionStore({ runId, workflow, objective: workflow.title, objectives: [] });
    const server = await startRunnerApiServer(store, 0);
    servers.push(server);

    store.onEvent(event(runId, 1, "run.created", { workflowKey: workflow.key }));
    store.onEvent(event(runId, 2, "agent.stdout", { stream: "stdout", text: "hello" }, "plan"));
    store.onEvent(event(runId, 3, "step.execution_started", { attempt: 1 }, "plan"));
    store.onLog({ id: "log-1", runId, stepKey: "plan", stream: "stdout", text: "chunk-1", occurredAt: new Date().toISOString() });
    store.onLog({ id: "log-2", runId, stepKey: "plan", stream: "stdout", text: "chunk-2", occurredAt: new Date().toISOString() });

    const headers = { Authorization: `Bearer ${store.attachToken()}` };
    const baseUrl = store.sessionInfo().baseUrl;

    const sseResponse = await fetch(`${baseUrl}/runs/${runId}/events?sinceSequence=1&includeLogs=false`, { headers });
    expect(sseResponse.status).toBe(200);
    const reader = sseResponse.body?.getReader();
    expect(reader).toBeDefined();
    const sseOutput = await readSseUntil(reader!, "event: step.execution_started");
    expect(sseOutput).not.toContain("event: agent.stdout");
    expect(sseOutput).toContain("event: step.execution_started");
    await reader?.cancel();

    const firstPage = await fetch(`${baseUrl}/runs/${runId}/logs?stepKey=plan&limit=1`, { headers });
    expect(firstPage.status).toBe(200);
    const firstPayload = (await firstPage.json()) as { items: Array<{ text: string }>; nextCursor: string | null };
    expect(firstPayload.items).toHaveLength(1);
    expect(firstPayload.items[0]?.text).toBe("chunk-1");
    expect(firstPayload.nextCursor).toBe("1");

    const secondPage = await fetch(`${baseUrl}/runs/${runId}/logs?stepKey=plan&limit=1&cursor=1`, { headers });
    expect(secondPage.status).toBe(200);
    const secondPayload = (await secondPage.json()) as { items: Array<{ text: string }>; nextCursor: string | null };
    expect(secondPayload.items).toHaveLength(1);
    expect(secondPayload.items[0]?.text).toBe("chunk-2");
    expect(secondPayload.nextCursor).toBeNull();
  });

  it("tracks attached state transitions across retry and approval", async () => {
    const workflow = attachedTransitionWorkflow();
    const runId = "run-transition-test";
    const store = new RunnerSessionStore({ runId, workflow, objective: workflow.title, objectives: [] });
    const server = await startRunnerApiServer(store, 0);
    servers.push(server);

    const headers = {
      Authorization: `Bearer ${store.attachToken()}`,
      "Content-Type": "application/json",
    };
    const baseUrl = store.sessionInfo().baseUrl;
    const runPromise = runWorkflow(workflow, { runId, observer: store, controller: store, autoConfirmAll: false });

    const snapshot = await waitForRunStatus(baseUrl, runId, headers, "waiting_for_approval", 5000);
    const steps = snapshot.steps as Array<Record<string, unknown>>;
    const draftStep = steps.find((step) => step.stepKey === "draft");
    const reviewStep = steps.find((step) => step.stepKey === "review");
    expect(draftStep?.status).toBe("succeeded");
    expect(reviewStep?.status).toBe("waiting_for_approval");

    const approveResponse = await fetch(`${baseUrl}/runs/${runId}/approve`, {
      method: "POST",
      headers,
      body: JSON.stringify({ stepKey: "review", actor: "reviewer" }),
    });
    expect(approveResponse.status).toBe(200);

    const result = await runPromise;
    expect(result.status).toBe("succeeded");
    expect(result.events.some((entry) => entry.type === "step.retried")).toBe(true);
    expect(result.events.some((entry) => entry.type === "step.waiting_for_approval")).toBe(true);
  });
});
