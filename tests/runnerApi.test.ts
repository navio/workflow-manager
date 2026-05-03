import { afterEach, describe, expect, it } from "bun:test";
import { runWorkflow } from "../src/engine.ts";
import { startRunnerApiServer } from "../src/runnerApi.ts";
import { RunnerSessionStore } from "../src/runnerSession.ts";
import type { WorkflowDefinition } from "../src/types.ts";

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

    let snapshot: Record<string, unknown> | null = null;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const response = await fetch(`${baseUrl}/runs/${runId}`, { headers });
      snapshot = (await response.json()) as Record<string, unknown>;
      if (snapshot.status === "waiting_for_approval") {
        break;
      }
      await Bun.sleep(25);
    }

    expect(snapshot?.status).toBe("waiting_for_approval");
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

    let snapshot: Record<string, unknown> | null = null;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const response = await fetch(`${baseUrl}/runs/${runId}`, { headers });
      snapshot = (await response.json()) as Record<string, unknown>;
      if (snapshot.status === "waiting_for_approval") {
        break;
      }
      await Bun.sleep(25);
    }

    expect(snapshot?.status).toBe("waiting_for_approval");
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
});
