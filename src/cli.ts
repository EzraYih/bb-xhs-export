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

function printHelp(): void {
  console.log([
    "bb-xhs-export",
    "",
    "用法:",
    "  bb-xhs-export notes --keyword <q> --top <n> --output-dir <dir> [--resume] [--bb-browser-bin <path>]",
    "  bb-xhs-export comments --keyword <q> --top-notes <n> --output-dir <dir> [--resume] [--bb-browser-bin <path>]",
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

  if (command === "notes") {
    const keyword = requireString(flags, "keyword");
    const top = parseNumber(flags, "top");
    log(`开始导出笔记，关键词=${keyword}，目标数量=${top}`);
    const result = await exportNotesWorkflow({
      keyword,
      top,
      outputDir: requireString(flags, "output-dir"),
      resume,
      bbBrowserBin,
    });
    log(`笔记导出完成，共 ${result.noteCount} 篇`);
    log(`输出目录: ${result.outputDir}`);
    log(`Manifest: ${result.manifestPath}`);
    return;
  }

  if (command === "comments") {
    const keyword = requireString(flags, "keyword");
    const topNotes = parseNumber(flags, "top-notes");
    log(`开始导出评论，关键词=${keyword}，目标笔记数=${topNotes}`);
    const result = await exportCommentsWorkflow({
      keyword,
      topNotes,
      outputDir: requireString(flags, "output-dir"),
      resume,
      bbBrowserBin,
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
