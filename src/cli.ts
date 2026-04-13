#!/usr/bin/env node

import { exportNotesWorkflow } from "./workflows/export-notes.js";
import { COMMENT_EXPORT_DEFAULTS, exportCommentsWorkflow } from "./workflows/export-comments.js";

type FlagValue = string | boolean;
type SortOption = "likes" | "comments" | "latest" | "general" | "collects";

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
    "  node dist/cli.js comments --keyword <q> --top-notes <n> [--output-dir <dir>] [--sort <sort>] [--resume] [--bb-browser-bin <path>] [--comment-delay-min-ms <n>] [--comment-delay-max-ms <n>] [--top-comments-page-size <n>] [--reply-page-size <n>] [--note-warmup-min-ms <n>] [--note-warmup-max-ms <n>] [--top-comments-burst-pages <n>] [--reply-burst-pages <n>] [--burst-cooldown-min-ms <n>] [--burst-cooldown-max-ms <n>] [--comment-cooldown-every <n>] [--comment-cooldown-ms <n>] [--comment-request-cooldown-every-pages <n>] [--comment-request-cooldown-ms <n>] [--comment-max-request-pages-per-run <n>] [--heavy-reply-threshold <n>] [--max-reply-pages-per-thread-per-run <n>] [--comment-backoff-min-ms <n>] [--comment-backoff-max-ms <n>] [--comment-backoff-max-retries <n>] [--rate-limit-cooldown-min-ms <n>] [--rate-limit-cooldown-max-ms <n>]",
  ].join("\n"));
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const flags = parseFlags(rest);
  const bbBrowserBin = typeof flags["bb-browser-bin"] === "string"
    ? String(flags["bb-browser-bin"])
    : undefined;
  const resume = Boolean(flags.resume);
  const sort = typeof flags.sort === "string" ? flags.sort as SortOption : undefined;
  const outputDir = (typeof flags["output-dir"] === "string" && flags["output-dir"].trim())
    ? flags["output-dir"].trim()
    : "./export";

  if (command === "notes") {
    const keyword = requireString(flags, "keyword");
    const top = parseNumber(flags, "top");
    const noteDetailDelayMinMs = parseOptionalNonNegativeNumber(flags, "note-delay-min-ms") ?? 1000;
    const noteDetailDelayMaxMs = parseOptionalNonNegativeNumber(flags, "note-delay-max-ms") ?? 5000;

    if (noteDetailDelayMaxMs < noteDetailDelayMinMs) {
      throw new Error(
        `参数 --note-delay-max-ms 不能小于 --note-delay-min-ms，当前值: ${noteDetailDelayMaxMs} < ${noteDetailDelayMinMs}`,
      );
    }

    log(
      `开始导出笔记，关键词=${keyword}，目标数量=${top}，详情间隔=${noteDetailDelayMinMs}~${noteDetailDelayMaxMs}ms`,
    );
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
    const commentDelayMinMs = parseOptionalNonNegativeNumber(flags, "comment-delay-min-ms")
      ?? COMMENT_EXPORT_DEFAULTS.commentDelayMinMs;
    const commentDelayMaxMs = parseOptionalNonNegativeNumber(flags, "comment-delay-max-ms")
      ?? COMMENT_EXPORT_DEFAULTS.commentDelayMaxMs;
    const topCommentsPageSize = parseOptionalNonNegativeNumber(flags, "top-comments-page-size")
      ?? COMMENT_EXPORT_DEFAULTS.topCommentsPageSize;
    const replyPageSize = parseOptionalNonNegativeNumber(flags, "reply-page-size")
      ?? COMMENT_EXPORT_DEFAULTS.replyPageSize;
    const noteWarmupMinMs = parseOptionalNonNegativeNumber(flags, "note-warmup-min-ms")
      ?? COMMENT_EXPORT_DEFAULTS.noteWarmupMinMs;
    const noteWarmupMaxMs = parseOptionalNonNegativeNumber(flags, "note-warmup-max-ms")
      ?? COMMENT_EXPORT_DEFAULTS.noteWarmupMaxMs;
    const topCommentsBurstPages = parseOptionalNonNegativeNumber(flags, "top-comments-burst-pages")
      ?? COMMENT_EXPORT_DEFAULTS.topCommentsBurstPages;
    const replyBurstPages = parseOptionalNonNegativeNumber(flags, "reply-burst-pages")
      ?? COMMENT_EXPORT_DEFAULTS.replyBurstPages;
    const burstCooldownMinMs = parseOptionalNonNegativeNumber(flags, "burst-cooldown-min-ms")
      ?? COMMENT_EXPORT_DEFAULTS.burstCooldownMinMs;
    const burstCooldownMaxMs = parseOptionalNonNegativeNumber(flags, "burst-cooldown-max-ms")
      ?? COMMENT_EXPORT_DEFAULTS.burstCooldownMaxMs;
    const commentCooldownEvery = parseOptionalNonNegativeNumber(flags, "comment-cooldown-every")
      ?? COMMENT_EXPORT_DEFAULTS.commentCooldownEvery;
    const commentCooldownMs = parseOptionalNonNegativeNumber(flags, "comment-cooldown-ms")
      ?? COMMENT_EXPORT_DEFAULTS.commentCooldownMs;
    const commentRequestCooldownEveryPages = parseOptionalNonNegativeNumber(
      flags,
      "comment-request-cooldown-every-pages",
    ) ?? COMMENT_EXPORT_DEFAULTS.commentRequestCooldownEveryPages;
    const commentRequestCooldownMs = parseOptionalNonNegativeNumber(flags, "comment-request-cooldown-ms")
      ?? COMMENT_EXPORT_DEFAULTS.commentRequestCooldownMs;
    const commentMaxRequestPagesPerRun = parseOptionalNonNegativeNumber(
      flags,
      "comment-max-request-pages-per-run",
    ) ?? COMMENT_EXPORT_DEFAULTS.commentMaxRequestPagesPerRun;
    const heavyReplyThreshold = parseOptionalNonNegativeNumber(flags, "heavy-reply-threshold")
      ?? COMMENT_EXPORT_DEFAULTS.heavyReplyThreshold;
    const maxReplyPagesPerThreadPerRun = parseOptionalNonNegativeNumber(
      flags,
      "max-reply-pages-per-thread-per-run",
    ) ?? COMMENT_EXPORT_DEFAULTS.maxReplyPagesPerThreadPerRun;
    const commentBackoffMinMs = parseOptionalNonNegativeNumber(flags, "comment-backoff-min-ms")
      ?? COMMENT_EXPORT_DEFAULTS.commentBackoffMinMs;
    const commentBackoffMaxMs = parseOptionalNonNegativeNumber(flags, "comment-backoff-max-ms")
      ?? COMMENT_EXPORT_DEFAULTS.commentBackoffMaxMs;
    const commentBackoffMaxRetries = parseOptionalNonNegativeNumber(flags, "comment-backoff-max-retries")
      ?? COMMENT_EXPORT_DEFAULTS.commentBackoffMaxRetries;
    const rateLimitCooldownMinMs = parseOptionalNonNegativeNumber(flags, "rate-limit-cooldown-min-ms")
      ?? COMMENT_EXPORT_DEFAULTS.rateLimitCooldownMinMs;
    const rateLimitCooldownMaxMs = parseOptionalNonNegativeNumber(flags, "rate-limit-cooldown-max-ms")
      ?? COMMENT_EXPORT_DEFAULTS.rateLimitCooldownMaxMs;

    if (commentDelayMaxMs < commentDelayMinMs) {
      throw new Error(
        `参数 --comment-delay-max-ms 不能小于 --comment-delay-min-ms，当前值: ${commentDelayMaxMs} < ${commentDelayMinMs}`,
      );
    }
    if (noteWarmupMaxMs < noteWarmupMinMs) {
      throw new Error(`Invalid note warmup range: ${noteWarmupMaxMs} < ${noteWarmupMinMs}`);
    }
    if (burstCooldownMaxMs < burstCooldownMinMs) {
      throw new Error(`Invalid burst cooldown range: ${burstCooldownMaxMs} < ${burstCooldownMinMs}`);
    }
    if (commentBackoffMaxMs < commentBackoffMinMs) {
      throw new Error(
        `参数 --comment-backoff-max-ms 不能小于 --comment-backoff-min-ms，当前值: ${commentBackoffMaxMs} < ${commentBackoffMinMs}`,
      );
    }
    if (rateLimitCooldownMaxMs < rateLimitCooldownMinMs) {
      throw new Error(`Invalid rate-limit cooldown range: ${rateLimitCooldownMaxMs} < ${rateLimitCooldownMinMs}`);
    }

    const collectedCooldownSummary = commentCooldownEvery > 0 && commentCooldownMs > 0
      ? `，每${commentCooldownEvery}条评论冷却${commentCooldownMs}ms`
      : "，未启用按评论条数冷却";
    const requestCooldownSummary = commentRequestCooldownEveryPages > 0 && commentRequestCooldownMs > 0
      ? `，每${commentRequestCooldownEveryPages}个请求页冷却${commentRequestCooldownMs}ms`
      : "，未启用按请求页冷却";
    const requestBudgetSummary = commentMaxRequestPagesPerRun > 0
      ? `, max ${commentMaxRequestPagesPerRun} request pages per run`
      : ", per-run request-page budget disabled";
    const backoffSummary = commentBackoffMaxRetries > 0
      ? `，限流退避${commentBackoffMinMs}~${commentBackoffMaxMs}ms x${commentBackoffMaxRetries}`
      : "，未启用限流退避";

    log(
      `开始导出评论，关键词=${keyword}，目标笔记数=${topNotes}，评论间隔=${commentDelayMinMs}~${commentDelayMaxMs}ms${collectedCooldownSummary}${requestCooldownSummary}${requestBudgetSummary}${backoffSummary}`,
    );
    const result = await exportCommentsWorkflow({
      keyword,
      topNotes,
      outputDir,
      resume,
      bbBrowserBin,
      sort,
      commentDelayMinMs,
      commentDelayMaxMs,
      topCommentsPageSize,
      replyPageSize,
      noteWarmupMinMs,
      noteWarmupMaxMs,
      topCommentsBurstPages,
      replyBurstPages,
      burstCooldownMinMs,
      burstCooldownMaxMs,
      commentCooldownEvery,
      commentCooldownMs,
      commentRequestCooldownEveryPages,
      commentRequestCooldownMs,
      commentMaxRequestPagesPerRun,
      heavyReplyThreshold,
      maxReplyPagesPerThreadPerRun,
      commentBackoffMinMs,
      commentBackoffMaxMs,
      commentBackoffMaxRetries,
      rateLimitCooldownMinMs,
      rateLimitCooldownMaxMs,
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
