// Escape-code constants and ANSI-aware string math for the TUI renderer.
// Pure string helpers only: no I/O, no terminal capability detection.
//
// Width is counted per UTF-16 code unit after stripping ANSI CSI sequences.
// Grapheme clusters and East Asian wide characters are intentionally not
// handled (no grapheme lib); this is acceptable for the status/log text the
// TUI renders and keeps these helpers dependency-free.

export const ALT_SCREEN_ENTER = "\x1b[?1049h";
export const ALT_SCREEN_LEAVE = "\x1b[?1049l";
export const CURSOR_HIDE = "\x1b[?25l";
export const CURSOR_SHOW = "\x1b[?25h";
export const CURSOR_HOME = "\x1b[H";
export const CLEAR_SCREEN = "\x1b[2J";
export const CLEAR_LINE_END = "\x1b[K";

const ESC = "\x1b";
const STYLE_RESET = "\x1b[0m";

/**
 * Returns the length of the ANSI CSI escape sequence starting at `start`,
 * or 0 when `start` does not begin a well-formed CSI sequence.
 *
 * CSI grammar: ESC `[` then parameter/intermediate bytes (0x20-0x3f)
 * terminated by a final byte (0x40-0x7e).
 */
function escapeSequenceLength(text: string, start: number): number {
  if (text[start] !== ESC || text[start + 1] !== "[") {
    return 0;
  }
  let index = start + 2;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) {
      return index - start + 1;
    }
    if (code < 0x20 || code > 0x3f) {
      return 0;
    }
    index += 1;
  }
  return 0;
}

export function stripAnsi(text: string): string {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const skip = escapeSequenceLength(text, index);
    if (skip > 0) {
      index += skip;
      continue;
    }
    out += text[index];
    index += 1;
  }
  return out;
}

/** ANSI-aware column count (per code unit; see module comment). */
export function visibleWidth(text: string): number {
  return stripAnsi(text).length;
}

/**
 * Truncates `text` to at most `width` visible columns, appending `ellipsis`
 * when truncation happens. ANSI escape sequences are copied through intact
 * (never split) and do not count toward the width. If any escape sequence
 * was emitted before the cut, a style reset is appended so styling does not
 * bleed past the truncated text.
 *
 * Invariant: visibleWidth(result) <= width. When `width` is smaller than the
 * ellipsis itself, a slice of the ellipsis is returned to keep the invariant.
 */
export function truncateVisible(text: string, width: number, ellipsis = "…"): string {
  if (visibleWidth(text) <= width) {
    return text;
  }
  if (width <= 0) {
    return "";
  }
  if (width < ellipsis.length) {
    return ellipsis.slice(0, width);
  }
  const budget = width - ellipsis.length;
  let out = "";
  let visible = 0;
  let sawEscape = false;
  let index = 0;
  while (index < text.length && visible < budget) {
    const skip = escapeSequenceLength(text, index);
    if (skip > 0) {
      out += text.slice(index, index + skip);
      sawEscape = true;
      index += skip;
      continue;
    }
    out += text[index];
    visible += 1;
    index += 1;
  }
  return out + ellipsis + (sawEscape ? STYLE_RESET : "");
}

/** Right-pads `text` with spaces up to `width` visible columns (no-op when already wider). */
export function padVisible(text: string, width: number): string {
  const missing = width - visibleWidth(text);
  return missing > 0 ? text + " ".repeat(missing) : text;
}
