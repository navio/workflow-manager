// Terminal session manager for the `wfm run --ui` TUI: owns entering/leaving
// the alt screen, raw-mode keyboard input, resize notifications, and a single
// buffered full-repaint write. No timers, no rendering/layout logic here.

import * as readline from "node:readline";
import {
  ALT_SCREEN_ENTER,
  ALT_SCREEN_LEAVE,
  CLEAR_LINE_END,
  CLEAR_SCREEN,
  CURSOR_HIDE,
  CURSOR_HOME,
  CURSOR_SHOW,
} from "./ansi.js";

export interface KeyEvent {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
}

export interface TerminalScreenOptions {
  stdout: NodeJS.WriteStream;
  stdin: NodeJS.ReadStream;
  onKey: (key: KeyEvent) => void;
  onResize: (columns: number, rows: number) => void;
}

const SIGNALS_TO_RESTORE_ON = ["SIGINT", "SIGTERM"] as const;

export class TerminalScreen {
  private readonly stdout: NodeJS.WriteStream;
  private readonly stdin: NodeJS.ReadStream;
  private readonly onKey: (key: KeyEvent) => void;
  private readonly onResize: (columns: number, rows: number) => void;

  private started = false;
  private stopped = false;
  private wasRawMode = false;

  private readonly handleKeypress = (str: string | undefined, key: KeyEvent | undefined): void => {
    this.onKey(key ?? { sequence: str });
  };

  private readonly handleResize = (): void => {
    const { columns, rows } = this.size();
    this.onResize(columns, rows);
  };

  private readonly handleSignal = (): void => {
    this.restore();
    // Conservative: restore the terminal only. Do not call process.exit and
    // do not swallow the signal for other listeners — re-emitting here would
    // recurse into every listener (including this one) on this signal, so we
    // simply return and let Node's normal signal delivery / other installed
    // listeners proceed. If this is the only SIGINT/SIGTERM listener, the
    // process's default disposition (terminate) still applies once all
    // listeners for the event have run.
  };

  constructor(options: TerminalScreenOptions) {
    this.stdout = options.stdout;
    this.stdin = options.stdin;
    this.onKey = options.onKey;
    this.onResize = options.onResize;
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.stopped = false;

    this.stdout.write(ALT_SCREEN_ENTER + CURSOR_HIDE + CLEAR_SCREEN + CURSOR_HOME);

    if (this.stdin.isTTY) {
      this.wasRawMode = true;
      this.stdin.setRawMode(true);
    }
    readline.emitKeypressEvents(this.stdin);
    this.stdin.resume();
    this.stdin.on("keypress", this.handleKeypress);
    this.stdout.on("resize", this.handleResize);

    process.once("exit", this.exitRestore);
    for (const signal of SIGNALS_TO_RESTORE_ON) {
      process.on(signal, this.handleSignal);
    }
  }

  paint(rows: string[]): void {
    const body = rows.map((row) => row + CLEAR_LINE_END).join("\r\n");
    this.stdout.write(CURSOR_HOME + body);
  }

  size(): { columns: number; rows: number } {
    return {
      columns: this.stdout.columns ?? 80,
      rows: this.stdout.rows ?? 24,
    };
  }

  stop(): void {
    this.restore();
    for (const signal of SIGNALS_TO_RESTORE_ON) {
      process.removeListener(signal, this.handleSignal);
    }
  }

  // Bound reference so `process.once("exit", ...)` can be a no-op re-run of
  // restore() without re-registering listener removal (exit handlers cannot
  // usefully remove listeners on a dying process, and restore() is safe to
  // call multiple times).
  private readonly exitRestore = (): void => {
    this.restore();
  };

  private restore(): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.started = false;

    this.stdin.removeListener("keypress", this.handleKeypress);
    this.stdout.removeListener("resize", this.handleResize);

    if (this.wasRawMode) {
      this.stdin.setRawMode(false);
      this.wasRawMode = false;
    }
    this.stdin.pause();

    this.stdout.write(CURSOR_SHOW + ALT_SCREEN_LEAVE);
  }
}
