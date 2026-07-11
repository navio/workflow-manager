import { describe, expect, it } from "bun:test";
import { TuiLogStore } from "../src/tui/logStore.ts";
import type { RunnerLogChunk } from "../src/types.ts";

let chunkCounter = 0;

function chunk(overrides: Partial<RunnerLogChunk> & { text: string }): RunnerLogChunk {
  chunkCounter += 1;
  return {
    id: `chunk-${chunkCounter}`,
    runId: "run-1",
    stream: "stdout",
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("TuiLogStore.appendChunk", () => {
  it("buffers a line delivered across multiple chunks until it is complete", () => {
    const store = new TuiLogStore();
    store.appendChunk(chunk({ stepKey: "build", text: "hello " }));
    expect(store.tail("build", 10)).toEqual([]);

    store.appendChunk(chunk({ stepKey: "build", text: "world\n" }));
    expect(store.tail("build", 10)).toEqual([{ kind: "stdout", text: "hello world" }]);
  });

  it("splits multiple complete lines within a single chunk", () => {
    const store = new TuiLogStore();
    store.appendChunk(chunk({ stepKey: "build", text: "line1\nline2\nline3\n" }));
    expect(store.tail("build", 10)).toEqual([
      { kind: "stdout", text: "line1" },
      { kind: "stdout", text: "line2" },
      { kind: "stdout", text: "line3" },
    ]);
  });

  it("keeps interleaved stdout/stderr partials for the same step from mixing", () => {
    const store = new TuiLogStore();
    store.appendChunk(chunk({ stepKey: "build", stream: "stdout", text: "out-partial-" }));
    store.appendChunk(chunk({ stepKey: "build", stream: "stderr", text: "err-line\n" }));

    // Only the completed stderr line should have been emitted so far.
    expect(store.tail("build", 10)).toEqual([{ kind: "stderr", text: "err-line" }]);

    store.appendChunk(chunk({ stepKey: "build", stream: "stdout", text: "rest\n" }));
    expect(store.tail("build", 10)).toEqual([
      { kind: "stderr", text: "err-line" },
      { kind: "stdout", text: "out-partial-rest" },
    ]);
  });

  it("handles CRLF and lone CR the same way splitLines does", () => {
    const store = new TuiLogStore();
    store.appendChunk(chunk({ stepKey: "build", text: "line1\r\nline2\rline3\n" }));
    expect(store.tail("build", 10)).toEqual([
      { kind: "stdout", text: "line1" },
      { kind: "stdout", text: "line2" },
      { kind: "stdout", text: "line3" },
    ]);
  });

  it("routes chunks with no stepKey to the null/workflow-level bucket", () => {
    const store = new TuiLogStore();
    store.appendChunk(chunk({ text: "workflow line\n" }));
    expect(store.tail(null, 10)).toEqual([{ kind: "stdout", text: "workflow line" }]);
    expect(store.tail(undefined, 10)).toEqual([{ kind: "stdout", text: "workflow line" }]);
  });

  it("isolates buckets per step key", () => {
    const store = new TuiLogStore();
    store.appendChunk(chunk({ stepKey: "step-a", text: "a-line\n" }));
    store.appendChunk(chunk({ stepKey: "step-b", text: "b-line\n" }));

    expect(store.tail("step-a", 10)).toEqual([{ kind: "stdout", text: "a-line" }]);
    expect(store.tail("step-b", 10)).toEqual([{ kind: "stdout", text: "b-line" }]);
    expect(store.tail("step-a", 10)).not.toEqual(store.tail("step-b", 10));
  });
});

describe("TuiLogStore.appendMeta", () => {
  it("pushes meta lines immediately without buffering", () => {
    const store = new TuiLogStore();
    store.appendMeta("build", "step started");
    expect(store.tail("build", 10)).toEqual([{ kind: "meta", text: "step started" }]);
  });

  it("routes a null/undefined stepKey to the workflow-level bucket", () => {
    const store = new TuiLogStore();
    store.appendMeta(null, "run started");
    store.appendMeta(undefined, "run continuing");
    expect(store.tail(null, 10)).toEqual([
      { kind: "meta", text: "run started" },
      { kind: "meta", text: "run continuing" },
    ]);
  });

  it("preserves ordering relative to flushed partial lines", () => {
    const store = new TuiLogStore();
    store.appendChunk(chunk({ stepKey: "build", text: "partial-out" }));
    store.appendMeta("build", "meta while pending");
    store.flushPartialLines();

    expect(store.tail("build", 10)).toEqual([
      { kind: "meta", text: "meta while pending" },
      { kind: "stdout", text: "partial-out" },
    ]);
  });
});

describe("TuiLogStore.flushPartialLines", () => {
  it("emits buffered remainders for every step/stream and clears them", () => {
    const store = new TuiLogStore();
    store.appendChunk(chunk({ stepKey: "build", stream: "stdout", text: "out-remainder" }));
    store.appendChunk(chunk({ stepKey: "build", stream: "stderr", text: "err-remainder" }));
    store.appendChunk(chunk({ stepKey: "test", text: "other-remainder" }));

    store.flushPartialLines();

    const buildLines = store.tail("build", 10);
    expect(buildLines).toContainEqual({ kind: "stdout", text: "out-remainder" });
    expect(buildLines).toContainEqual({ kind: "stderr", text: "err-remainder" });
    expect(store.tail("test", 10)).toEqual([{ kind: "stdout", text: "other-remainder" }]);

    // Flushing again should not duplicate the remainders since they were cleared.
    store.flushPartialLines();
    expect(store.tail("build", 10).length).toBe(2);
  });

  it("does not emit anything for steps with no pending partial text", () => {
    const store = new TuiLogStore();
    store.appendChunk(chunk({ stepKey: "build", text: "complete line\n" }));
    store.flushPartialLines();
    expect(store.tail("build", 10)).toEqual([{ kind: "stdout", text: "complete line" }]);
  });
});

describe("TuiLogStore ring buffer eviction", () => {
  it("caps each bucket at maxLinesPerStep, dropping the oldest lines first", () => {
    const store = new TuiLogStore({ maxLinesPerStep: 3 });
    store.appendMeta("build", "A");
    store.appendMeta("build", "B");
    store.appendMeta("build", "C");
    store.appendMeta("build", "D");

    expect(store.lineCount("build")).toBe(3);
    expect(store.tail("build", 10)).toEqual([
      { kind: "meta", text: "B" },
      { kind: "meta", text: "C" },
      { kind: "meta", text: "D" },
    ]);
  });

  it("evicts across mixed chunk and meta lines in insertion order", () => {
    const store = new TuiLogStore({ maxLinesPerStep: 2 });
    store.appendChunk(chunk({ stepKey: "build", text: "line1\n" }));
    store.appendMeta("build", "meta1");
    store.appendChunk(chunk({ stepKey: "build", text: "line2\n" }));

    expect(store.tail("build", 10)).toEqual([
      { kind: "meta", text: "meta1" },
      { kind: "stdout", text: "line2" },
    ]);
  });

  it("keeps buckets for different steps independent under eviction", () => {
    const store = new TuiLogStore({ maxLinesPerStep: 1 });
    store.appendMeta("step-a", "a1");
    store.appendMeta("step-a", "a2");
    store.appendMeta("step-b", "b1");

    expect(store.tail("step-a", 10)).toEqual([{ kind: "meta", text: "a2" }]);
    expect(store.tail("step-b", 10)).toEqual([{ kind: "meta", text: "b1" }]);
  });
});

describe("TuiLogStore.tail", () => {
  it("returns an empty array for a bucket that has never been written to", () => {
    const store = new TuiLogStore();
    expect(store.tail("missing", 10)).toEqual([]);
    expect(store.tail(null, 10)).toEqual([]);
  });

  it("returns all available lines when count exceeds the bucket size", () => {
    const store = new TuiLogStore();
    store.appendMeta("build", "only-line");
    expect(store.tail("build", 100)).toEqual([{ kind: "meta", text: "only-line" }]);
  });

  it("returns only the most recent `count` lines when count is smaller than available", () => {
    const store = new TuiLogStore();
    for (const label of ["a", "b", "c", "d", "e"]) {
      store.appendMeta("build", label);
    }
    expect(store.tail("build", 2)).toEqual([
      { kind: "meta", text: "d" },
      { kind: "meta", text: "e" },
    ]);
  });

  it("returns an empty array when count is zero or negative", () => {
    const store = new TuiLogStore();
    store.appendMeta("build", "line");
    expect(store.tail("build", 0)).toEqual([]);
    expect(store.tail("build", -5)).toEqual([]);
  });
});

describe("TuiLogStore.lineCount", () => {
  it("reflects completed lines only, not unflushed partials", () => {
    const store = new TuiLogStore();
    store.appendChunk(chunk({ stepKey: "build", text: "no newline yet" }));
    expect(store.lineCount("build")).toBe(0);

    store.flushPartialLines();
    expect(store.lineCount("build")).toBe(1);
  });

  it("returns 0 for a bucket that has never been written to", () => {
    const store = new TuiLogStore();
    expect(store.lineCount("never-seen")).toBe(0);
  });
});
