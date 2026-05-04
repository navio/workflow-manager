import http from "node:http";
import type { AddressInfo } from "node:net";
import type { RunnerSessionStore } from "./runnerSession.js";

interface RunnerApiServer {
  port: number;
  close: () => Promise<void>;
}

function jsonResponse(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.end(payload);
}

function errorResponse(res: http.ServerResponse, status: number, error: string, message: string): void {
  jsonResponse(res, status, { error, message });
}

function isAuthorized(req: http.IncomingMessage, store: RunnerSessionStore): boolean {
  const header = req.headers.authorization;
  return header === `Bearer ${store.attachToken()}`;
}

function parseBoolean(value: string | null, fallback: boolean): boolean {
  if (value === null) {
    return fallback;
  }

  return value !== "false";
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) {
    return {};
  }

  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Request body must be a JSON object");
  }

  return parsed as Record<string, unknown>;
}

export async function startRunnerApiServer(store: RunnerSessionStore, requestedPort: number): Promise<RunnerApiServer> {
  const sockets = new Set<import("node:net").Socket>();
  const server = http.createServer((req, res) => {
    void (async () => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    const pathname = url.pathname;

    if (method === "GET" && pathname === "/health") {
      jsonResponse(res, 200, { ok: true });
      return;
    }

    if (!isAuthorized(req, store)) {
      errorResponse(res, 401, "unauthorized", "Missing or invalid attach token");
      return;
    }

    if (method === "GET" && pathname === "/session") {
      jsonResponse(res, 200, store.publicSession());
      return;
    }

    const runMatch = pathname.match(/^\/runs\/([^/]+)$/);
    if (method === "GET" && runMatch) {
      const runId = decodeURIComponent(runMatch[1] ?? "");
      if (!store.isKnownRun(runId)) {
        errorResponse(res, 404, "not_found", `Unknown run: ${runId}`);
        return;
      }
      jsonResponse(res, 200, store.snapshot());
      return;
    }

    const stepMatch = pathname.match(/^\/runs\/([^/]+)\/steps\/([^/]+)$/);
    if (method === "GET" && stepMatch) {
      const runId = decodeURIComponent(stepMatch[1] ?? "");
      const stepKey = decodeURIComponent(stepMatch[2] ?? "");
      if (!store.isKnownRun(runId)) {
        errorResponse(res, 404, "not_found", `Unknown run: ${runId}`);
        return;
      }
      const step = store.stepDetail(stepKey);
      if (!step) {
        errorResponse(res, 404, "not_found", `Unknown step: ${stepKey}`);
        return;
      }
      jsonResponse(res, 200, step);
      return;
    }

    const logsMatch = pathname.match(/^\/runs\/([^/]+)\/logs$/);
    if (method === "GET" && logsMatch) {
      const runId = decodeURIComponent(logsMatch[1] ?? "");
      if (!store.isKnownRun(runId)) {
        errorResponse(res, 404, "not_found", `Unknown run: ${runId}`);
        return;
      }
      const stepKey = url.searchParams.get("stepKey") ?? undefined;
      const limit = Number.parseInt(url.searchParams.get("limit") ?? "200", 10);
      const cursor = url.searchParams.get("cursor") ?? undefined;
      jsonResponse(res, 200, store.listLogs(stepKey, limit, cursor));
      return;
    }

    const controlMatch = pathname.match(/^\/runs\/([^/]+)\/(approve|resume|cancel)$/);
    if (method === "POST" && controlMatch) {
      const runId = decodeURIComponent(controlMatch[1] ?? "");
      const action = controlMatch[2] ?? "";
      if (!store.isKnownRun(runId)) {
        errorResponse(res, 404, "not_found", `Unknown run: ${runId}`);
        return;
      }

      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        errorResponse(res, 400, "invalid_body", (error as Error).message);
        return;
      }

      const stepKey = typeof body.stepKey === "string" ? body.stepKey : undefined;
      const metadata = {
        actor: typeof body.actor === "string" ? body.actor : undefined,
        note: typeof body.note === "string" ? body.note : undefined,
        source: typeof body.source === "string" ? body.source : "api",
      };
      const result = action === "cancel" ? store.cancel(stepKey, metadata) : store.approve(stepKey, metadata);
      if (!result.ok) {
        errorResponse(res, 409, "conflict", result.reason ?? "Unable to update run state");
        return;
      }

      jsonResponse(res, 200, {
        ok: true,
        decision: action === "cancel" ? "cancelled" : "approved",
        stepKey: result.stepKey ?? stepKey ?? null,
        actor: metadata.actor ?? null,
        note: metadata.note ?? null,
        source: metadata.source,
      });
      return;
    }

    const eventsMatch = pathname.match(/^\/runs\/([^/]+)\/events$/);
    if (method === "GET" && eventsMatch) {
      const runId = decodeURIComponent(eventsMatch[1] ?? "");
      if (!store.isKnownRun(runId)) {
        errorResponse(res, 404, "not_found", `Unknown run: ${runId}`);
        return;
      }

      const sinceSequence = Number.parseInt(url.searchParams.get("sinceSequence") ?? "0", 10) || undefined;
      const includeLogs = parseBoolean(url.searchParams.get("includeLogs"), true);
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      for (const event of store.events(sinceSequence, includeLogs)) {
        res.write(`event: ${event.type}\n`);
        res.write(`id: ${event.sequence}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }

      const heartbeat = setInterval(() => {
        res.write("event: heartbeat\n");
        res.write(`data: ${JSON.stringify({ occurredAt: new Date().toISOString() })}\n\n`);
      }, 15000);

      const unsubscribe = store.subscribe((event) => {
        if (!includeLogs && (event.type === "agent.stdout" || event.type === "agent.stderr")) {
          return;
        }
        res.write(`event: ${event.type}\n`);
        res.write(`id: ${event.sequence}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };

      req.on("close", cleanup);
      res.on("close", cleanup);
      return;
    }

    errorResponse(res, 404, "not_found", `Unknown endpoint: ${pathname}`);
    })().catch((error) => {
      if (!res.headersSent) {
        errorResponse(res, 500, "internal_error", (error as Error).message);
        return;
      }
      res.destroy(error as Error);
    });
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Runner API failed to bind to an address");
  }

  const { port } = address as AddressInfo;
  store.setBinding("127.0.0.1", port);

  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}
