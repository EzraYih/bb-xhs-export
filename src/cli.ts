#!/usr/bin/env node

import { exportNotesWorkflow } from "./workflows/export-notes.js";
import { exportCommentsWorkflow } from "./workflows/export-comments.js";

type FlagValue = string | boolean;

function timestamp(): string {
  return new Date().toISOString();
}

function log(...args: unknown[]): void {
  console.log(`[${timestamp()}]`, ...args);
}

function parseFlags(args: string[]): Record<string, FlagValue> {
  const flags: Record<string, FlagValue> = {};
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current || !current.startsWith("--")) continue;
    const key = current.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return flags;
}

function requireString(flags: Record<string, FlagValue>, key: string): string {
  const value = flags[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`缺少必填参数 --${key}`);
  }
  return value.trim();
}

function parseNumber(flags: Record<string, FlagValue>, key: string): number {
  const value = requireString(flags, key);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`参数 --${key} 必须是正整数，当前值: ${value}`);
  }
  return parsed;
}

function parseOptionalNonNegativeNumber(flags: Record<string, FlagValue>, key: string): number | undefined {
  const value = flags[key];
  if (value === undefined || value === false) {
    return undefined;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`参数 --${key} 必须是非负整数`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`参数 --${key} 必须是非负整数，当前值: ${value}`);
  }
  return parsed;
}

function printHelp(): void {
  console.log([
    "bb-xhs-export",
    "",
    "用法:",
    "  node dist/cli.js notes --keyword <q> --top <n> [--output-dir <dir>] [--sort <sort>] [--resume] [--bb-browser-bin <path>] [--note-delay-min-ms <n>] [--note-delay-max-ms <n>]",
    "  node dist/cli.js comments --keyword <q> --top-notes <n> [--output-dir <dir>] [--sort <sort>] [--resume] [--bb-browser-bin <path>] [--comment-delay-min-ms <n>] [--comment-delay-max-ms <n>]",
  ].join("\n"));
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const flags = parseFlags(rest);
  const bbBrowserBin = typeof flags["bb-browser-bin"] === "string" ? String(flags["bb-browser-bin"]) : undefined;
  const resume = Boolean(flags.resume);
  const sort = typeof flags.sort === "string" ? flags.sort as "likes" | "comments" | "latest" | "general" | "collects" : undefined;
  const outputDir = (typeof flags["output-dir"] === "string" && flags["output-dir"].trim()) ? flags["output-dir"].trim() : "./export";

  if (command === "notes") {
    const keyword = requireString(flags, "keyword");
    const top = parseNumber(flags, "top");
    const noteDetailDelayMinMs = parseOptionalNonNegativeNumber(flags, "note-delay-min-ms") ?? 1000;
    const noteDetailDelayMaxMs = parseOptionalNonNegativeNumber(flags, "note-delay-max-ms") ?? 5000;
    if (noteDetailDelayMaxMs < noteDetailDelayMinMs) {
      throw new Error(`参数 --note-delay-max-ms 不能小于 --note-delay-min-ms，当前值: ${noteDetailDelayMaxMs} < ${noteDetailDelayMinMs}`);
    }
    log(`开始导出笔记，关键词=${keyword}，目标数量=${top}，详情间隔=${noteDetailDelayMinMs}~${noteDetailDelayMaxMs}ms`);
    const result = await exportNotesWorkflow({
      keyword,
      top,
      outputDir,
      resume,
      bbBrowserBin,
      sort,
      noteDetailDelayMinMs,
      noteDetailDelayMaxMs,
    });
    log(`笔记导出完成，共 ${result.noteCount} 篇`);
    log(`输出目录: ${result.outputDir}`);
    log(`Manifest: ${result.manifestPath}`);
    return;
  }

  if (command === "comments") {
    const keyword = requireString(flags, "keyword");
    const topNotes = parseNumber(flags, "top-notes");
    const commentDelayMinMs = parseOptionalNonNegativeNumber(flags, "comment-delay-min-ms") ?? 500;
    const commentDelayMaxMs = parseOptionalNonNegativeNumber(flags, "comment-delay-max-ms") ?? 2000;
    if (commentDelayMaxMs < commentDelayMinMs) {
      throw new Error(`参数 --comment-delay-max-ms 不能小于 --comment-delay-min-ms，当前值: ${commentDelayMaxMs} < ${commentDelayMinMs}`);
    }
    log(`开始导出评论，关键词=${keyword}，目标笔记数=${topNotes}，评论间隔=${commentDelayMinMs}~${commentDelayMaxMs}ms`);
    const result = await exportCommentsWorkflow({
      keyword,
      topNotes,
      outputDir,
      resume,
      bbBrowserBin,
      sort,
      commentDelayMinMs,
      commentDelayMaxMs,
    });
    log(`评论导出完成，笔记 ${result.noteCount} 篇，评论 ${result.commentCount} 条`);
    log(`输出目录: ${result.outputDir}`);
    log(`Manifest: ${result.manifestPath}`);
    return;
  }

  throw new Error(`未知命令: ${command}`);
}

main().catch((error) => {
  log(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
