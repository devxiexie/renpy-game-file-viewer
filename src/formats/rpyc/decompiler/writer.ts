export interface WriterOptions {
  /** Pad output with blank lines so statements land on their original line numbers. */
  alignLines?: boolean;
  indent?: string;
}

/**
 * Line-oriented output buffer. When `alignLines` is on, `advanceTo(n)` inserts blank
 * lines so the next written line has number n (if we're not already past it), which
 * keeps decompiled scripts line-compatible with tracebacks and the original source.
 */
export class Writer {
  readonly lines: string[] = [];
  private level = 0;
  private readonly indentUnit: string;
  private readonly align: boolean;

  constructor(options: WriterOptions = {}) {
    this.indentUnit = options.indent ?? "    ";
    this.align = options.alignLines ?? true;
  }

  /** Number the next written line will get (1-based). */
  get nextLine(): number {
    return this.lines.length + 1;
  }

  advanceTo(line: number): void {
    if (!this.align || !line) return;
    while (this.lines.length + 1 < line) this.lines.push("");
  }

  /**
   * Write one statement. Embedded newlines come from multi-line expressions in the
   * original source; continuation lines are kept verbatim (they may be inside strings).
   */
  write(text: string): void {
    this.writeContinued(text);
  }

  /** Write lines that are all relative to the current indent (dedented code). */
  writeBlock(text: string): void {
    const prefix = this.indentUnit.repeat(this.level);
    for (const part of text.split("\n")) this.lines.push(part.length ? prefix + part : "");
  }

  /**
   * Write source code whose lines carry their original absolute indentation. Lines are
   * re-based from `baseIndent` columns to the current indent; lines indented less than
   * that (continuations of multi-line strings) are written verbatim so string contents
   * are preserved.
   */
  writeSource(lines: string[], baseIndent: number): void {
    const prefix = this.indentUnit.repeat(this.level);
    const base = " ".repeat(baseIndent);
    for (const line of lines) {
      if (!line.trim()) this.lines.push("");
      else if (line.startsWith(base)) this.lines.push(prefix + line.slice(baseIndent));
      else this.lines.push(line);
    }
  }

  /** Write a possibly multi-line expression: first line indented, continuations verbatim. */
  writeContinued(text: string): void {
    const [first, ...rest] = text.split("\n");
    this.lines.push(this.indentUnit.repeat(this.level) + first);
    for (const l of rest) this.lines.push(l);
  }

  /** Append text to the last written line. */
  append(text: string): void {
    if (this.lines.length === 0) this.lines.push("");
    this.lines[this.lines.length - 1] += text;
  }

  indent<T>(fn: () => T): T {
    this.level++;
    try {
      return fn();
    } finally {
      this.level--;
    }
  }

  toString(): string {
    return this.lines.join("\n") + "\n";
  }
}
