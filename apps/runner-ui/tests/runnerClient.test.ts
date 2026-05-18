import { describe, expect, test } from "bun:test";
import { parseSseEventChunk, RunnerClient } from "../src/lib/runnerClient";
import type { RunnerEventEnvelope } from "../src/lib/runnerTypes";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("runner client", () => {
  test("filters logs by step key and sends auth headers", async () => {
    const requests: Array<{ url: string; headers: string | null }> = [];
    const client = new RunnerClient({
      baseUrl: "http://127.0.0.1:8765",
      runId: "run_123",
      token: "token_123",
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), headers: new Headers(init?.headers).get("authorization") });
        return jsonResponse({ items: [], nextCursor: null });
      },
    });

    await client.getLogs("run_123", "step_review");

    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:8765/runs/run_123/logs?stepKey=step_review",
        headers: "Bearer token_123",
      },
    ]);
  });

  test("posts control payloads with runner-ui source", async () => {
    const requests: Array<{ url: string; body: string | null; headers: Record<string, string> }> = [];
    const client = new RunnerClient({
      baseUrl: "http://127.0.0.1:8765",
      runId: "run_123",
      token: "token_123",
      fetchImpl: async (input, init) => {
        requests.push({
          url: String(input),
          body: typeof init?.body === "string" ? init.body : null,
          headers: Object.fromEntries(new Headers(init?.headers).entries()),
        });
        return jsonResponse({ ok: true, decision: "approved", stepKey: "step_review", actor: "alex", note: "looks good", source: "runner-ui" });
      },
    });

    await client.control("approve", { stepKey: "step_review", actor: "alex", note: "looks good" });

    expect(requests[0]).toMatchObject({
      url: "http://127.0.0.1:8765/runs/run_123/approve",
      body: JSON.stringify({ stepKey: "step_review", actor: "alex", note: "looks good", source: "runner-ui" }),
    });
    expect(requests[0]?.headers.authorization).toBe("Bearer token_123");
    expect(requests[0]?.headers["content-type"]).toContain("application/json");
  });

  test("surfaces API error status and body", async () => {
    const client = new RunnerClient({
      baseUrl: "http://127.0.0.1:8765",
      runId: "run_123",
      token: "token_123",
      fetchImpl: async () => new Response(JSON.stringify({ error: "conflict", message: "already resolved" }), { status: 409 }),
    });

    await expect(client.control("cancel", { stepKey: "step_review" })).rejects.toMatchObject({
      name: "RunnerApiError",
      status: 409,
      body: JSON.stringify({ error: "conflict", message: "already resolved" }),
    });
  });

  test("parses SSE chunks and replays from the last sequence", async () => {
    const parsed = parseSseEventChunk(`event: step.execution_started\nid: 7\ndata: {"id":"evt_7"}\ndata: {"sequence":7}`);
    expect(parsed).toEqual({ event: "step.execution_started", id: "7", data: '{"id":"evt_7"}\n{"sequence":7}' });

    const events: RunnerEventEnvelope[] = [];
    const requests: string[] = [];
    const abortController = new AbortController();
    let callCount = 0;

    const client = new RunnerClient({
      baseUrl: "http://127.0.0.1:8765",
      runId: "run_123",
      token: "token_123",
      fetchImpl: async (input) => {
        requests.push(String(input));
        callCount += 1;
        if (callCount === 1) {
          return new Response(
            `event: step.execution_started\nid: 7\ndata: ${JSON.stringify({
              id: "evt_7",
              sequence: 7,
              type: "step.execution_started",
              runId: "run_123",
              occurredAt: "2026-01-01T00:00:00.000Z",
              data: { stepKey: "step_review" },
            })}\n\n`,
            { status: 200, headers: { "Content-Type": "text/event-stream" } }
          );
        }

        abortController.abort();
        return new Response("", { status: 200, headers: { "Content-Type": "text/event-stream" } });
      },
    });

    const stop = client.subscribeToEvents({
      sinceSequence: 4,
      includeLogs: false,
      signal: abortController.signal,
      onEvent: (event) => events.push(event),
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    stop();

    expect(events).toHaveLength(1);
    expect(events[0]?.sequence).toBe(7);
    expect(requests[0]).toBe("http://127.0.0.1:8765/runs/run_123/events?sinceSequence=4&includeLogs=false");
    expect(requests[1]).toBe("http://127.0.0.1:8765/runs/run_123/events?sinceSequence=7&includeLogs=false");
  });
});
