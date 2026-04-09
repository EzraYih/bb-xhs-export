import { stdout } from "node:process";

export interface ProgressSnapshot {
  label: string;
  current: number;
  total: number;
  detail?: string | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function padLine(line: string): string {
  const columns = stdout.columns || 120;
  if (line.length >= columns) {
    return `${line.slice(0, Math.max(0, columns - 3))}...`;
  }
  return line.padEnd(columns, " ");
}

export class TerminalProgress {
  private lastRenderAt = 0;
  private lastLine = "";
  private readonly isInteractive = Boolean(stdout.isTTY);
  private readonly intervalMs: number;
  private tick = 0;

  constructor(intervalMs = 120) {
    this.intervalMs = intervalMs;
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
      stdout.write(`\r${padLine(line)}`);
      this.lastLine = line;
      this.lastRenderAt = now;
      return;
    }

    if (line !== this.lastLine && now - this.lastRenderAt >= Math.max(this.intervalMs, 1000)) {
      console.log(line);
      this.lastLine = line;
      this.lastRenderAt = now;
    }
  }

  finish(message?: string): void {
    if (this.isInteractive) {
      if (this.lastLine) {
        stdout.write(`\r${padLine(this.lastLine)}\n`);
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
