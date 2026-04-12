import { stdout } from "node:process";
import readline from "node:readline";

export interface ProgressSnapshot {
  label: string;
  current: number;
  total: number;
  detail?: string | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function charDisplayWidth(char: string): number {
  const codePoint = char.codePointAt(0) ?? 0;
  return codePoint <= 0xff ? 1 : 2;
}

function lineDisplayWidth(line: string): number {
  let width = 0;
  for (const char of line) {
    width += charDisplayWidth(char);
  }
  return width;
}

function truncateLine(line: string): string {
  const columns = stdout.columns || 120;
  if (lineDisplayWidth(line) > columns) {
    const targetWidth = Math.max(0, columns - 3);
    let width = 0;
    let result = "";
    for (const char of line) {
      const charWidth = charDisplayWidth(char);
      if (width + charWidth > targetWidth) {
        break;
      }
      result += char;
      width += charWidth;
    }
    return `${result}...`;
  }
  return line;
}

export class TerminalProgress {
  private lastRenderAt = 0;
  private lastLine = "";
  private readonly isInteractive = Boolean(stdout.isTTY);
  private readonly intervalMs: number;
  private readonly nonTtyIntervalMs: number;
  private tick = 0;

  constructor(intervalMs = 120, nonTtyIntervalMs = 5000) {
    this.intervalMs = intervalMs;
    this.nonTtyIntervalMs = nonTtyIntervalMs;
  }

  update(snapshot: ProgressSnapshot): void {
    const total = Math.max(snapshot.total, 1);
    const current = clamp(snapshot.current, 0, total);
    const ratio = current / total;
    const width = 24;
    const filled = clamp(Math.round(ratio * width), 0, width);
    const spinner = ["-", "\\", "|", "/"][this.tick % 4];
    this.tick += 1;
    const bar = `${"#".repeat(filled)}${"-".repeat(width - filled)}`;
    const percent = `${Math.round(ratio * 100)}%`;
    const detail = snapshot.detail ? ` | ${snapshot.detail}` : "";
    const line = `${spinner} ${snapshot.label} [${bar}] ${current}/${total} ${percent}${detail}`;

    const now = Date.now();

    if (this.isInteractive) {
      if (now - this.lastRenderAt < this.intervalMs && line === this.lastLine) {
        return;
      }
      readline.clearLine(stdout, 0);
      readline.cursorTo(stdout, 0);
      stdout.write(truncateLine(line));
      this.lastLine = line;
      this.lastRenderAt = now;
      return;
    }

    if (line !== this.lastLine && now - this.lastRenderAt >= this.nonTtyIntervalMs) {
      console.log(line);
      this.lastLine = line;
      this.lastRenderAt = now;
    }
  }

  finish(message?: string): void {
    if (this.isInteractive) {
      if (this.lastLine) {
        readline.clearLine(stdout, 0);
        readline.cursorTo(stdout, 0);
        stdout.write(`${truncateLine(this.lastLine)}\n`);
      }
      if (message) {
        console.log(message);
      }
      this.lastLine = "";
      return;
    }

    if (message) {
      console.log(message);
    }
  }
}
