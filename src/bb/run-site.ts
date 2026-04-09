import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface BbBrowserOptions {
  bbBrowserBin?: string;
  cwd?: string;
  tabId?: string | number;
}

export class BbBrowserError extends Error {
  readonly stdout: string;
  readonly stderr: string;

  constructor(message: string, stdout = "", stderr = "") {
    super(message);
    this.name = "BbBrowserError";
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBbBrowserBin(options: BbBrowserOptions): string {
  return options.bbBrowserBin || process.env.BB_BROWSER_BIN || "";
}

function splitCommandLine(commandLine: string): string[] {
  const result: string[] = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(commandLine)) !== null) {
    const token = match[1] ?? match[2] ?? match[3] ?? "";
    if (!token) continue;
    result.push(token.replace(/\\(["'])/g, "$1"));
  }
  return result;
}

function resolveLocalBbBrowserDist(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const siblingDist = resolve(here, "..", "..", "..", "bb-browser", "dist", "cli.js");
  return existsSync(siblingDist) ? siblingDist : null;
}

function resolveBbBrowserCommand(options: BbBrowserOptions): { command: string; prefixArgs: string[] } {
  const configured = getBbBrowserBin(options).trim();
  if (configured) {
    const tokens = splitCommandLine(configured);
    if (tokens.length === 0) {
      throw new BbBrowserError("Empty bb-browser command");
    }
    if (tokens.length === 1 && /\.m?js$/i.test(tokens[0]) && existsSync(tokens[0])) {
      return { command: "node", prefixArgs: [tokens[0]] };
    }
    return { command: tokens[0], prefixArgs: tokens.slice(1) };
  }

  const localDist = resolveLocalBbBrowserDist();
  if (localDist) {
    return { command: "node", prefixArgs: [localDist] };
  }

  return {
    command: process.platform === "win32" ? "bb-browser.cmd" : "bb-browser",
    prefixArgs: [],
  };
}

export async function runBbBrowser(args: string[], options: BbBrowserOptions = {}): Promise<string> {
  const resolved = resolveBbBrowserCommand(options);
  const commandArgs = options.tabId != null
    ? ["--tab", String(options.tabId), ...args]
    : args;
  return await new Promise((resolve, reject) => {
    const child = spawn(resolved.command, [...resolved.prefixArgs, ...commandArgs], {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      reject(new BbBrowserError(error.message, stdout, stderr));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new BbBrowserError(stderr.trim() || stdout.trim() || `bb-browser exited with code ${code}`, stdout, stderr));
    });
  });
}

export async function runBbBrowserJson<T>(args: string[], options: BbBrowserOptions = {}): Promise<T> {
  const stdout = await runBbBrowser([...args, "--json"], options);
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new BbBrowserError("Failed to parse bb-browser JSON output", stdout, "");
  }
}

export async function runSiteJson<T>(adapter: string, adapterArgs: string[], options: BbBrowserOptions = {}): Promise<T> {
  const maxAttempts = 3;
  let lastError: BbBrowserError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const stdout = await runBbBrowser(["site", adapter, ...adapterArgs, "--json"], options);
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        throw new BbBrowserError(`Failed to parse bb-browser JSON output for ${adapter}`, stdout, "");
      }

      const envelope = parsed as { success?: boolean; error?: string; hint?: string; data?: T };
      if (!envelope.success) {
        throw new BbBrowserError(envelope.error || `Adapter ${adapter} failed`, stdout, envelope.hint || "");
      }
      return envelope.data as T;
    } catch (error) {
      const bbError = error instanceof BbBrowserError
        ? error
        : new BbBrowserError(error instanceof Error ? error.message : String(error));
      lastError = bbError;
      const retryable = /Daemon request timed out|Chrome not connected|CDP WebSocket closed unexpectedly|Inspected target navigated or closed|Target closed|Tab not found|ECONNRESET|socket hang up/i.test(
        [bbError.message, bbError.stderr, bbError.stdout].join("\n"),
      );
      if (!retryable || attempt === maxAttempts) {
        throw bbError;
      }
      await sleep(1000 * attempt);
    }
  }

  throw lastError || new BbBrowserError(`Adapter ${adapter} failed`);
}
