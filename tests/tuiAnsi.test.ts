import { describe, expect, it } from "bun:test";
import {
  ALT_SCREEN_ENTER,
  ALT_SCREEN_LEAVE,
  CLEAR_LINE_END,
  CLEAR_SCREEN,
  CURSOR_HIDE,
  CURSOR_HOME,
  CURSOR_SHOW,
  padVisible,
  stripAnsi,
  truncateVisible,
  visibleWidth,
} from "../src/tui/ansi.ts";

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

describe("ansi constants", () => {
  it("exposes the expected escape sequences", () => {
    expect(ALT_SCREEN_ENTER).toBe("\x1b[?1049h");
    expect(ALT_SCREEN_LEAVE).toBe("\x1b[?1049l");
    expect(CURSOR_HIDE).toBe("\x1b[?25l");
    expect(CURSOR_SHOW).toBe("\x1b[?25h");
    expect(CURSOR_HOME).toBe("\x1b[H");
    expect(CLEAR_SCREEN).toBe("\x1b[2J");
    expect(CLEAR_LINE_END).toBe("\x1b[K");
  });
});

describe("stripAnsi", () => {
  it("returns plain text unchanged", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
    expect(stripAnsi("")).toBe("");
  });

  it("removes SGR color sequences", () => {
    expect(stripAnsi(`${RED}error${RESET}`)).toBe("error");
    expect(stripAnsi(`${GREEN}a${RESET} ${RED}b${RESET}`)).toBe("a b");
  });

  it("removes cursor and screen control sequences", () => {
    expect(stripAnsi(`${CURSOR_HOME}${CLEAR_SCREEN}top${CLEAR_LINE_END}`)).toBe("top");
    expect(stripAnsi(`${ALT_SCREEN_ENTER}body${ALT_SCREEN_LEAVE}`)).toBe("body");
  });
});

describe("visibleWidth", () => {
  it("counts plain text per code unit", () => {
    expect(visibleWidth("abc")).toBe(3);
    expect(visibleWidth("")).toBe(0);
  });

  it("ignores embedded escape sequences", () => {
    expect(visibleWidth(`${RED}foo${RESET}`)).toBe(3);
    expect(visibleWidth(`${GREEN}12${RESET}34`)).toBe(4);
  });
});

describe("truncateVisible", () => {
  it("returns text unchanged when it fits", () => {
    expect(truncateVisible("short", 10)).toBe("short");
    expect(truncateVisible("exact", 5)).toBe("exact");
    const styled = `${RED}ok${RESET}`;
    expect(truncateVisible(styled, 2)).toBe(styled);
  });

  it("truncates plain text and appends the default ellipsis", () => {
    const result = truncateVisible("hello world", 8);
    expect(result).toBe("hello w…");
    expect(visibleWidth(result)).toBe(8);
  });

  it("supports a custom ellipsis within the width budget", () => {
    const result = truncateVisible("hello world", 8, "...");
    expect(result).toBe("hello...");
    expect(visibleWidth(result)).toBe(8);
  });

  it("never splits an escape sequence and appends a reset for styled text", () => {
    const styled = `${GREEN}green text${RESET}`;
    const result = truncateVisible(styled, 6);
    expect(result.startsWith(GREEN)).toBe(true);
    expect(result.endsWith(RESET)).toBe(true);
    expect(stripAnsi(result)).toBe("green…");
    expect(visibleWidth(result)).toBe(6);
    // Every ESC in the output begins a complete sequence: stripping then
    // re-measuring must agree, and no dangling ESC byte remains.
    expect(stripAnsi(result).includes("\x1b")).toBe(false);
  });

  it("keeps escape sequences that appear before the cut point", () => {
    const styled = `${RED}ab${RESET}${GREEN}cdef${RESET}`;
    const result = truncateVisible(styled, 4);
    expect(stripAnsi(result)).toBe("abc…");
    expect(result.includes(RED)).toBe(true);
    expect(result.includes(GREEN)).toBe(true);
    expect(result.endsWith(RESET)).toBe(true);
  });

  it("keeps the width invariant when width is smaller than the ellipsis", () => {
    expect(truncateVisible("hello world", 2, "...")).toBe("..");
    expect(truncateVisible("hello world", 1)).toBe("…");
    expect(truncateVisible("hello world", 0)).toBe("");
  });
});

describe("padVisible", () => {
  it("right-pads plain text to the requested width", () => {
    expect(padVisible("abc", 6)).toBe("abc   ");
    expect(visibleWidth(padVisible("abc", 6))).toBe(6);
  });

  it("pads styled text based on visible width", () => {
    const styled = `${RED}abc${RESET}`;
    const padded = padVisible(styled, 6);
    expect(padded).toBe(`${styled}   `);
    expect(visibleWidth(padded)).toBe(6);
  });

  it("is a no-op when text is already at or beyond the width", () => {
    expect(padVisible("abcdef", 6)).toBe("abcdef");
    expect(padVisible("abcdefgh", 6)).toBe("abcdefgh");
  });
});
