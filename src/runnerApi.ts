import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { RunnerSessionStore } from "./runnerSession.js";

interface RunnerApiServerOptions {
  uiAssetsDir?: string;
}

interface RunnerApiServer {
  port: number;
  uiUrl: string | null;
  close: () => Promise<void>;
}

interface RunnerUiAssets {
  assetsDir: string;
  indexPath: string;
}

const UI_BASE_PATH = "/ui";

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

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

function textResponse(res: http.ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

function normalizeUiAssets(options?: RunnerApiServerOptions): RunnerUiAssets | null {
  if (!options?.uiAssetsDir) {
    return null;
  }

  const assetsDir = path.resolve(options.uiAssetsDir);
  const indexPath = path.join(assetsDir, "index.html");
  const stats = fs.statSync(assetsDir, { throwIfNoEntry: false });
  if (!stats?.isDirectory()) {
    throw new Error(`Runner UI assets directory not found: ${assetsDir}`);
  }

  const indexStats = fs.statSync(indexPath, { throwIfNoEntry: false });
  if (!indexStats?.isFile()) {
    throw new Error(`Runner UI index.html not found: ${indexPath}`);
  }

  return { assetsDir, indexPath };
}

function isRunnerUiPath(pathname: string): boolean {
  return pathname === UI_BASE_PATH || pathname.startsWith(`${UI_BASE_PATH}/`);
}

function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function cacheControlFor(filePath: string): string {
  return path.basename(filePath) === "index.html" ? "no-cache" : "public, max-age=31536000, immutable";
}

function resolveUiFile(uiAssets: RunnerUiAssets, pathname: string): { filePath: string; status?: number; message?: string } {
  let relativePath = pathname === UI_BASE_PATH || pathname === `${UI_BASE_PATH}/` ? "index.html" : pathname.slice(`${UI_BASE_PATH}/`.length);

  try {
    relativePath = decodeURIComponent(relativePath);
  } catch {
    return { filePath: uiAssets.indexPath, status: 400, message: "Invalid UI asset path" };
  }

  if (relativePath.includes("\0")) {
    return { filePath: uiAssets.indexPath, status: 400, message: "Invalid UI asset path" };
  }

  const requestedPath = path.resolve(uiAssets.assetsDir, relativePath);
  const relativeToAssets = path.relative(uiAssets.assetsDir, requestedPath);
  if (relativeToAssets.startsWith("..") || path.isAbsolute(relativeToAssets)) {
    return { filePath: uiAssets.indexPath, status: 403, message: "UI asset path is outside the asset directory" };
  }

  const stats = fs.statSync(requestedPath, { throwIfNoEntry: false });
  if (stats?.isFile()) {
    return { filePath: requestedPath };
  }

  if (stats?.isDirectory()) {
    const nestedIndex = path.join(requestedPath, "index.html");
    const nestedStats = fs.statSync(nestedIndex, { throwIfNoEntry: false });
    if (nestedStats?.isFile()) {
      return { filePath: nestedIndex };
    }
  }

  if (path.extname(requestedPath)) {
    return { filePath: uiAssets.indexPath, status: 404, message: "UI asset not found" };
  }

  return { filePath: uiAssets.indexPath };
}

async function serveRunnerUiAsset(req: http.IncomingMessage, res: http.ServerResponse, uiAssets: RunnerUiAssets, pathname: string): Promise<void> {
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    textResponse(res, 405, "Method not allowed");
    return;
  }

  const resolved = resolveUiFile(uiAssets, pathname);
  if (resolved.status) {
    textResponse(res, resolved.status, resolved.message ?? "Unable to serve UI asset");
    return;
  }

  let payload: Buffer;
  try {
    payload = await fs.promises.readFile(resolved.filePath);
  } catch {
    textResponse(res, 404, "UI asset not found");
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", contentTypeFor(resolved.filePath));
  res.setHeader("Cache-Control", cacheControlFor(resolved.filePath));
  res.setHeader("Content-Length", payload.byteLength);
  if (method === "HEAD") {
    res.end();
    return;
  }
  res.end(payload);
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

export async function startRunnerApiServer(
  store: RunnerSessionStore,
  requestedPort: number,
  options?: RunnerApiServerOptions
): Promise<RunnerApiServer> {
  const uiAssets = normalizeUiAssets(options);
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

    if (uiAssets && isRunnerUiPath(pathname)) {
      await serveRunnerUiAsset(req, res, uiAssets, pathname);
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
  const uiUrl = uiAssets
    ? `http://127.0.0.1:${port}${UI_BASE_PATH}/#runId=${encodeURIComponent(store.runId())}&token=${encodeURIComponent(store.attachToken())}`
    : null;

  return {
    port,
    uiUrl,
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
