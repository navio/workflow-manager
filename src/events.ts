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
  ): RunEvent {
    this.sequence += 1;
    const event: RunEvent = {
      id: randomUUID(),
      runId,
      stepRunId,
      type,
      sequenceNumber: this.sequence,
      occurredAt: new Date().toISOString(),
      actor,
      payload,
    };
    this.events.push(event);
    return event;
  }

  all(): RunEvent[] {
    return [...this.events];
  }
}
