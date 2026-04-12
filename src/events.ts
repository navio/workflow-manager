import { randomUUID } from "node:crypto";
import type { RunEvent } from "./types.js";

export class EventLog {
  private sequence = 0;
  private events: RunEvent[] = [];

  push(
    runId: string,
    type: RunEvent["type"],
    payload: Record<string, unknown> = {},
    stepRunId?: string,
    actor = "system"
  ): void {
    this.sequence += 1;
    this.events.push({
      id: randomUUID(),
      runId,
      stepRunId,
      type,
      sequenceNumber: this.sequence,
      occurredAt: new Date().toISOString(),
      actor,
      payload,
    });
  }

  all(): RunEvent[] {
    return [...this.events];
  }
}
