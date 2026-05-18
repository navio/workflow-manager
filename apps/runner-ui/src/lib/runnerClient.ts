import type {
  ApprovalControlPayload,
  ApprovalControlResponse,
  RunnerEventEnvelope,
  RunnerLogList,
  RunnerSessionInfo,
  RunSnapshot,
  StepDetailSnapshot,
} from "./runnerTypes";

export interface RunnerClientOptions {
  baseUrl: string;
  runId: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export interface RunnerEventsSubscribeOptions {
  sinceSequence?: number;
  includeLogs?: boolean;
  onEvent: (event: RunnerEventEnvelope) => void;
  onError?: (error: Error) => void;
  onConnectionChange?: (state: "connecting" | "open" | "closed") => void;
  signal?: AbortSignal;
}

export class RunnerApiError extends Error {
  public readonly status: number;
  public readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "RunnerApiError";
    this.status = status;
    this.body = body;
  }
}

type EventChunk = {
  event?: string;
  data?: string;
  id?: string;
};

export interface ParsedSseEvent extends EventChunk {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function joinUrl(baseUrl: string, pathname: string, params?: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(pathname, baseUrl);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function normalizeHeaders(headers: HeadersInit | undefined, token: string): Headers {
  const normalized = new Headers(headers);
  normalized.set("Authorization", `Bearer ${token}`);
  return normalized;
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    throw new RunnerApiError(`Runner API request failed with ${response.status}`, response.status, text);
  }

  return JSON.parse(text) as T;
}

export function parseSseEventChunk(rawChunk: string): ParsedSseEvent | null {
  const chunk: ParsedSseEvent = {};
  let sawField = false;
  const dataLines: string[] = [];

  for (const line of rawChunk.split(/\r?\n/)) {
    if (line.startsWith("event: ")) {
      chunk.event = line.slice(7).trim();
      sawField = true;
    } else if (line.startsWith("data: ")) {
      dataLines.push(line.slice(6));
      sawField = true;
    } else if (line.startsWith("id: ")) {
      chunk.id = line.slice(4).trim();
      sawField = true;
    }
  }

  if (dataLines.length > 0) {
    chunk.data = dataLines.join("\n");
  }

  return sawField ? chunk : null;
}

async function consumeEventStream(response: Response, onEvent: (chunk: ParsedSseEvent) => void, signal?: AbortSignal): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Runner event stream did not expose a readable body");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    if (signal?.aborted) {
      await reader.cancel();
      return;
    }

    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const rawChunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const chunk = parseSseEventChunk(rawChunk);
      if (chunk) {
        onEvent(chunk);
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}

export class RunnerClient {
  private readonly baseUrl: string;
  private readonly runId: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RunnerClientOptions) {
    this.baseUrl = options.baseUrl;
    this.runId = options.runId;
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async requestJson<T>(pathname: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImpl(joinUrl(this.baseUrl, pathname), {
      ...init,
      headers: normalizeHeaders(init?.headers, this.token),
    });
    return readJson<T>(response);
  }

  getSession(): Promise<RunnerSessionInfo> {
    return this.requestJson<RunnerSessionInfo>("/session");
  }

  getRun(runId: string = this.runId): Promise<RunSnapshot> {
    return this.requestJson<RunSnapshot>(`/runs/${encodeURIComponent(runId)}`);
  }

  getStep(stepKey: string, runId: string = this.runId): Promise<StepDetailSnapshot> {
    return this.requestJson<StepDetailSnapshot>(`/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepKey)}`);
  }

  getLogs(runId: string = this.runId, stepKey?: string): Promise<RunnerLogList> {
    const query = new URLSearchParams();
    if (stepKey) {
      query.set("stepKey", stepKey);
    }

    const suffix = query.toString() ? `?${query.toString()}` : "";
    return this.requestJson<RunnerLogList>(`/runs/${encodeURIComponent(runId)}/logs${suffix}`);
  }

  async control(action: "approve" | "resume" | "cancel", payload: ApprovalControlPayload, runId: string = this.runId): Promise<ApprovalControlResponse> {
    return this.requestJson<ApprovalControlResponse>(`/runs/${encodeURIComponent(runId)}/${action}`, {
      method: "POST",
      body: JSON.stringify({
        stepKey: payload.stepKey,
        actor: payload.actor,
        note: payload.note,
        source: payload.source ?? "runner-ui",
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  subscribeToEvents(options: RunnerEventsSubscribeOptions): () => void {
    const abortController = new AbortController();
    const externalSignal = options.signal;
    const runId = this.runId;
    let sinceSequence = options.sinceSequence ?? 0;

    const onAbort = () => abortController.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        abortController.abort();
      } else {
        externalSignal.addEventListener("abort", onAbort, { once: true });
      }
    }

    void (async () => {
      while (!abortController.signal.aborted) {
        try {
          options.onConnectionChange?.("connecting");
          const response = await this.fetchImpl(
            joinUrl(this.baseUrl, `/runs/${encodeURIComponent(runId)}/events`, {
              sinceSequence: sinceSequence || undefined,
              includeLogs: options.includeLogs ?? true,
            }),
            {
              headers: normalizeHeaders(undefined, this.token),
              signal: abortController.signal,
            }
          );

          if (!response.ok) {
            throw new RunnerApiError(`Runner event stream failed with ${response.status}`, response.status, await response.text());
          }

          options.onConnectionChange?.("open");
          await consumeEventStream(
            response,
            (chunk) => {
              if (chunk.event === "heartbeat" || !chunk.data) {
                return;
              }

              try {
                const event = JSON.parse(chunk.data) as RunnerEventEnvelope;
                if (typeof event.sequence === "number") {
                  sinceSequence = Math.max(sinceSequence, event.sequence);
                }
                options.onEvent(event);
              } catch (error) {
                options.onError?.(error instanceof Error ? error : new Error("Failed to parse runner event"));
              }
            },
            abortController.signal
          );
        } catch (error) {
          if (abortController.signal.aborted) {
            break;
          }

          options.onError?.(error instanceof Error ? error : new Error("Runner event stream disconnected"));
          await sleep(1500);
        }
      }

      options.onConnectionChange?.("closed");
    })();

    return () => {
      externalSignal?.removeEventListener("abort", onAbort);
      abortController.abort();
    };
  }
}
