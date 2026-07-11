import { EventEmitter } from "node:events";
import { describe, expect, it } from "bun:test";
import {
  ALT_SCREEN_ENTER,
  ALT_SCREEN_LEAVE,
  CLEAR_LINE_END,
  CLEAR_SCREEN,
  CURSOR_HIDE,
  CURSOR_HOME,
  CURSOR_SHOW,
} from "../src/tui/ansi.ts";
import { TerminalScreen } from "../src/tui/screen.ts";
import type { KeyEvent } from "../src/tui/screen.ts";

// Minimal fakes: real EventEmitters (so `.on`/`.emit`/`.removeListener` work
// exactly like the real streams TerminalScreen depends on) plus recording
// stubs for the handful of stream methods it calls.
class FakeWriteStream extends EventEmitter {
  columns: number | undefined = 80;
  rows: number | undefined = 24;
  writes: string[] = [];

  write(chunk: string): boolean {
    this.writes.push(chunk);
    return true;
  }

  output(): string {
    return this.writes.join("");
  }
}

class FakeReadStream extends EventEmitter {
  isTTY = true;
  rawModeCalls: boolean[] = [];
  resumeCalls = 0;
  pauseCalls = 0;

  setRawMode(mode: boolean): this {
    this.rawModeCalls.push(mode);
    return this;
  }

  resume(): this {
    this.resumeCalls += 1;
    return this;
  }

  pause(): this {
    this.pauseCalls += 1;
    return this;
  }
}

function makeScreen(overrides?: { onKey?: (key: KeyEvent) => void; onResize?: (columns: number, rows: number) => void }) {
  const stdout = new FakeWriteStream();
  const stdin = new FakeReadStream();
  const keys: KeyEvent[] = [];
  const resizes: Array<{ columns: number; rows: number }> = [];
  const screen = new TerminalScreen({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    onKey: overrides?.onKey ?? ((key) => keys.push(key)),
    onResize: overrides?.onResize ?? ((columns, rows) => resizes.push({ columns, rows })),
  });
  return { screen, stdout, stdin, keys, resizes };
}

describe("TerminalScreen.start", () => {
  it("writes the alt-screen/hide/clear/home sequence", () => {
    const { screen, stdout } = makeScreen();
    screen.start();
    expect(stdout.output()).toBe(ALT_SCREEN_ENTER + CURSOR_HIDE + CLEAR_SCREEN + CURSOR_HOME);
    screen.stop();
  });

  it("enables raw mode when stdin is a TTY", () => {
    const { screen, stdin } = makeScreen();
    screen.start();
    expect(stdin.rawModeCalls).toEqual([true]);
    expect(stdin.resumeCalls).toBe(1);
    screen.stop();
  });

  it("does not touch raw mode when stdin is not a TTY", () => {
    const { screen, stdin } = makeScreen();
    stdin.isTTY = false;
    screen.start();
    expect(stdin.rawModeCalls).toEqual([]);
    screen.stop();
  });
});

describe("TerminalScreen keyboard forwarding", () => {
  it("forwards keypress events with a key object", () => {
    const { screen, stdin, keys } = makeScreen();
    screen.start();
    stdin.emit("keypress", "a", { name: "a", ctrl: false, meta: false, shift: false });
    expect(keys).toEqual([{ name: "a", ctrl: false, meta: false, shift: false }]);
    screen.stop();
  });

  it("synthesizes a KeyEvent from the raw sequence when key is undefined", () => {
    const { screen, stdin, keys } = makeScreen();
    screen.start();
    stdin.emit("keypress", "", undefined);
    expect(keys).toEqual([{ sequence: "" }]);
    screen.stop();
  });
});

describe("TerminalScreen resize forwarding", () => {
  it("forwards the new size on a stdout resize event", () => {
    const { screen, stdout, resizes } = makeScreen();
    screen.start();
    stdout.columns = 120;
    stdout.rows = 40;
    stdout.emit("resize");
    expect(resizes).toEqual([{ columns: 120, rows: 40 }]);
    screen.stop();
  });
});

describe("TerminalScreen.paint", () => {
  it("writes CURSOR_HOME, all rows, and CLEAR_LINE_END per row with no trailing newline", () => {
    const { screen, stdout } = makeScreen();
    screen.start();
    stdout.writes = [];
    screen.paint(["first row", "second row", "third"]);
    const expected =
      CURSOR_HOME +
      [`first row${CLEAR_LINE_END}`, `second row${CLEAR_LINE_END}`, `third${CLEAR_LINE_END}`].join("\r\n");
    expect(stdout.output()).toBe(expected);
    expect(stdout.output().endsWith("\n")).toBe(false);
    screen.stop();
  });

  it("handles an empty rows array", () => {
    const { screen, stdout } = makeScreen();
    screen.start();
    stdout.writes = [];
    screen.paint([]);
    expect(stdout.output()).toBe(CURSOR_HOME);
    screen.stop();
  });
});

describe("TerminalScreen.stop", () => {
  it("restores in reverse order: raw mode off, then cursor show + alt-screen leave", () => {
    const { screen, stdout, stdin } = makeScreen();
    screen.start();
    stdout.writes = [];
    stdin.rawModeCalls = [];

    screen.stop();

    expect(stdin.rawModeCalls).toEqual([false]);
    expect(stdin.pauseCalls).toBe(1);
    expect(stdout.output()).toBe(CURSOR_SHOW + ALT_SCREEN_LEAVE);
  });

  it("removes the keypress and resize listeners", () => {
    const { screen, stdout, stdin } = makeScreen();
    screen.start();
    expect(stdin.listenerCount("keypress")).toBeGreaterThan(0);
    expect(stdout.listenerCount("resize")).toBeGreaterThan(0);

    screen.stop();

    expect(stdin.listenerCount("keypress")).toBe(0);
    expect(stdout.listenerCount("resize")).toBe(0);
  });

  it("is idempotent: a second stop() writes nothing and does not toggle raw mode again", () => {
    const { screen, stdout, stdin } = makeScreen();
    screen.start();
    screen.stop();

    stdout.writes = [];
    stdin.rawModeCalls = [];
    const pauseCallsBefore = stdin.pauseCalls;

    screen.stop();

    expect(stdout.output()).toBe("");
    expect(stdin.rawModeCalls).toEqual([]);
    expect(stdin.pauseCalls).toBe(pauseCallsBefore);
  });

  it("no longer forwards keypress or resize events after stop", () => {
    const { screen, stdout, stdin, keys, resizes } = makeScreen();
    screen.start();
    screen.stop();

    stdin.emit("keypress", "a", { name: "a" });
    stdout.emit("resize");

    expect(keys).toEqual([]);
    expect(resizes).toEqual([]);
  });
});

describe("TerminalScreen.size", () => {
  it("returns stdout columns/rows when present", () => {
    const { screen, stdout } = makeScreen();
    stdout.columns = 132;
    stdout.rows = 43;
    expect(screen.size()).toEqual({ columns: 132, rows: 43 });
  });

  it("falls back to 80x24 when columns/rows are undefined", () => {
    const { screen, stdout } = makeScreen();
    stdout.columns = undefined;
    stdout.rows = undefined;
    expect(screen.size()).toEqual({ columns: 80, rows: 24 });
  });
});
