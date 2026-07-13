#!/usr/bin/env bun
/**
 * Deterministic ACP agent used by tests. Runs as a subprocess, speaks ACP over
 * stdio via the SDK's AgentSideConnection, and is configured through argv:
 *   --text <s>        message text to stream back (default "hello from fake acp")
 *   --stop <reason>   stopReason to end the turn (default "end_turn")
 *   --permission      request permission during the turn and report the outcome
 *   --kind <toolKind> tool kind to attach to the permission request (default "edit")
 *
 * When --permission is set, the streamed message is "PERMISSION:<optionId|cancelled>"
 * so tests can assert how the client's permission policy resolved the request.
 */
import type { Readable, Writable } from "node:stream";
import {
  AgentSideConnection,
  type ContentBlock,
  PROTOCOL_VERSION,
  ndJsonStream,
} from "@agentclientprotocol/sdk";

// Bun lacks Writable.toWeb / Readable.toWeb, so bridge stdio to Web streams manually.
function writableToWeb(writable: Writable): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise((resolve, reject) => {
        writable.write(chunk, (err) => (err ? reject(err) : resolve()));
      });
    },
  });
}

function readableToWeb(readable: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      readable.on("data", (chunk: Buffer | string) => {
        controller.enqueue(typeof chunk === "string" ? new TextEncoder().encode(chunk) : Uint8Array.from(chunk));
      });
      readable.on("end", () => {
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
      readable.on("error", (err: Error) => controller.error(err));
    },
  });
}

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

const text = arg("--text", "hello from fake acp");
const stopReason = arg("--stop", "end_turn") as "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";
const wantsPermission = process.argv.includes("--permission");
const toolKind = arg("--kind", "edit") as "read" | "edit" | "search" | "fetch" | "execute" | "other";

const stream = ndJsonStream(writableToWeb(process.stdout), readableToWeb(process.stdin));

new AgentSideConnection(
  (conn) => ({
    async initialize() {
      return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: {} };
    },
    async newSession() {
      return { sessionId: "fake-session" };
    },
    async prompt(params) {
      let messageText = text;
      if (wantsPermission) {
        const decision = await conn.requestPermission({
          sessionId: params.sessionId,
          options: [
            { optionId: "allow", name: "Allow", kind: "allow_once" },
            { optionId: "deny", name: "Deny", kind: "reject_once" },
          ],
          toolCall: { toolCallId: "tool-1", title: "write a file", kind: toolKind },
        });
        const outcome = decision.outcome.outcome === "selected" ? decision.outcome.optionId : "cancelled";
        messageText = `PERMISSION:${outcome}`;
      }

      const content: ContentBlock = { type: "text", text: messageText };
      await conn.sessionUpdate({
        sessionId: params.sessionId,
        update: { sessionUpdate: "agent_message_chunk", content },
      });

      return { stopReason };
    },
    async cancel() {
      // no-op; the client kills the process after the turn
    },
  }),
  stream
);
