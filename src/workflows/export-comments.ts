import { relative } from "node:path";
import {
  searchPage,
  noteDetail,
  commentsPage,
  commentRepliesPage,
  type CommentsPageResult,
  type SearchPageNote,
} from "../bb/xiaohongshu.js";
import { runWithConcurrency, mergeNote } from "./shared.js";
import type { BbBrowserOptions } from "../bb/run-site.js";
import {
  loadCheckpoint,
  saveCheckpoint,
  type CommentsCheckpoint,
  type NoteCommentsCurrentPagePartial,
  type NoteCommentsPartial,
  loadPartial,
} from "../cache/checkpoint.js";
import { readJsonIfExists, writeJson, writeText } from "../cache/store.js";
import {
  commentsCheckpointPath,
  commentsMarkdownPath,
  createLayout,
  normalizedCommentsPath,
  noteCommentsPartialPath,
  rawCommentsPagePath,
  rawNotePath,
  rawRepliesPagePath,
  rawSearchPagePath,
} from "../fs/layout.js";
import { downloadCommentImages, downloadNoteMedia } from "../media/download.js";
import { renderCommentsIndex, renderCommentsMarkdown } from "../render/comments-markdown.js";
import { createManifest, type ExportFailure } from "../schema/manifest.js";
import { normalizeCommentRecord, type CommentRecord } from "../schema/comment.js";
import type { NoteRecord } from "../schema/note.js";
import { TerminalProgress } from "../ui/progress.js";

export interface ExportCommentsOptions extends BbBrowserOptions {
  keyword: string;
  topNotes: number;
  outputDir: string;
  resume: boolean;
  sort?: "likes" | "comments" | "latest" | "general" | "collects";
  commentDelayMinMs?: number;
  commentDelayMaxMs?: number;
  topCommentsPageSize?: number;
  replyPageSize?: number;
  noteWarmupMinMs?: number;
  noteWarmupMaxMs?: number;
  topCommentsBurstPages?: number;
  replyBurstPages?: number;
  burstCooldownMinMs?: number;
  burstCooldownMaxMs?: number;
  commentCooldownEvery?: number;
  commentCooldownMs?: number;
  commentRequestCooldownEveryPages?: number;
  commentRequestCooldownMs?: number;
  commentMaxRequestPagesPerRun?: number;
  heavyReplyThreshold?: number;
  maxReplyPagesPerThreadPerRun?: number;
  commentBackoffMinMs?: number;
  commentBackoffMaxMs?: number;
  commentBackoffMaxRetries?: number;
  rateLimitCooldownMinMs?: number;
  rateLimitCooldownMaxMs?: number;
}

export interface ExportCommentsResult {
  outputDir: string;
  noteCount: number;
  commentCount: number;
  manifestPath: string;
}

interface CommentCollectionProgress {
  stage: "top-comments" | "replies" | "delay" | "cooldown" | "backoff";
  collectedCount: number;
  commentsPageIndex: number;
  replyPageCount: number;
  requestPageCount: number;
  currentCommentId: string | null;
  delayMs?: number;
  delayTarget?: "top-comments" | "replies";
  cooldownReason?: "comment-count" | "request-pages" | "burst-top-comments" | "burst-replies";
  cooldownEvery?: number;
  backoffAttempt?: number;
  backoffMaxRetries?: number;
  requestTarget?: "top-comments" | "replies";
}

interface CommentCooldownState {
  commentEvery: number;
  commentMs: number;
  collectedSinceCooldown: number;
  requestPageEvery: number;
  requestPageMs: number;
  requestPagesSinceCooldown: number;
}

interface CommentBackoffConfig {
  minMs: number;
  maxMs: number;
  maxRetries: number;
}

interface CommentRequestBudgetState {
  maxPagesPerRun: number;
  usedPagesThisRun: number;
}

interface CommentRhythmState {
  noteWarmupMinMs: number;
  noteWarmupMaxMs: number;
  topCommentsBurstPages: number;
  replyBurstPages: number;
  burstCooldownMinMs: number;
  burstCooldownMaxMs: number;
  topCommentsPagesSinceBurst: number;
  replyPagesSinceBurst: number;
}

interface CommentRequestProgressContext {
  currentCommentId: string | null;
  requestTarget: "top-comments" | "replies";
}

interface ReplyQueueState {
  comment_id: string;
  sub_comment_count: number;
  reply_cursor: string | null;
  reply_page_index: number;
  done: boolean;
}

interface ReplyThreadPreviewState {
  comment_id: string;
  sub_comment_count: number;
  reply_cursor: string | null;
  reply_has_more: boolean;
  preview_replies: CommentRecord[];
}

export const COMMENT_EXPORT_DEFAULTS = {
  commentDelayMinMs: 500,
  commentDelayMaxMs: 2000,
  topCommentsPageSize: 20,
  replyPageSize: 20,
  noteWarmupMinMs: 4000,
  noteWarmupMaxMs: 8000,
  topCommentsBurstPages: 4,
  replyBurstPages: 1,
  burstCooldownMinMs: 15000,
  burstCooldownMaxMs: 35000,
  commentCooldownEvery: 1000,
  commentCooldownMs: 10000,
  commentRequestCooldownEveryPages: 20,
  commentRequestCooldownMs: 20000,
  commentMaxRequestPagesPerRun: 160,
  heavyReplyThreshold: 100,
  maxReplyPagesPerThreadPerRun: 20,
  commentBackoffMinMs: 120000,
  commentBackoffMaxMs: 300000,
  commentBackoffMaxRetries: 1,
  rateLimitCooldownMinMs: 1800000,
  rateLimitCooldownMaxMs: 5400000,
} as const;

const DEFAULT_COMMENT_DELAY_MIN_MS = COMMENT_EXPORT_DEFAULTS.commentDelayMinMs;
const DEFAULT_COMMENT_DELAY_MAX_MS = COMMENT_EXPORT_DEFAULTS.commentDelayMaxMs;
const DEFAULT_TOP_COMMENTS_PAGE_SIZE = COMMENT_EXPORT_DEFAULTS.topCommentsPageSize;
const DEFAULT_REPLY_PAGE_SIZE = COMMENT_EXPORT_DEFAULTS.replyPageSize;
const DEFAULT_NOTE_WARMUP_MIN_MS = COMMENT_EXPORT_DEFAULTS.noteWarmupMinMs;
const DEFAULT_NOTE_WARMUP_MAX_MS = COMMENT_EXPORT_DEFAULTS.noteWarmupMaxMs;
const DEFAULT_TOP_COMMENTS_BURST_PAGES = COMMENT_EXPORT_DEFAULTS.topCommentsBurstPages;
const DEFAULT_REPLY_BURST_PAGES = COMMENT_EXPORT_DEFAULTS.replyBurstPages;
const DEFAULT_BURST_COOLDOWN_MIN_MS = COMMENT_EXPORT_DEFAULTS.burstCooldownMinMs;
const DEFAULT_BURST_COOLDOWN_MAX_MS = COMMENT_EXPORT_DEFAULTS.burstCooldownMaxMs;
const DEFAULT_COMMENT_COOLDOWN_EVERY = COMMENT_EXPORT_DEFAULTS.commentCooldownEvery;
const DEFAULT_COMMENT_COOLDOWN_MS = COMMENT_EXPORT_DEFAULTS.commentCooldownMs;
const DEFAULT_COMMENT_REQUEST_COOLDOWN_EVERY_PAGES = COMMENT_EXPORT_DEFAULTS.commentRequestCooldownEveryPages;
const DEFAULT_COMMENT_REQUEST_COOLDOWN_MS = COMMENT_EXPORT_DEFAULTS.commentRequestCooldownMs;
const DEFAULT_COMMENT_MAX_REQUEST_PAGES_PER_RUN = COMMENT_EXPORT_DEFAULTS.commentMaxRequestPagesPerRun;
const DEFAULT_HEAVY_REPLY_THRESHOLD = COMMENT_EXPORT_DEFAULTS.heavyReplyThreshold;
const DEFAULT_MAX_REPLY_PAGES_PER_THREAD_PER_RUN = COMMENT_EXPORT_DEFAULTS.maxReplyPagesPerThreadPerRun;
const DEFAULT_COMMENT_BACKOFF_MIN_MS = COMMENT_EXPORT_DEFAULTS.commentBackoffMinMs;
const DEFAULT_COMMENT_BACKOFF_MAX_MS = COMMENT_EXPORT_DEFAULTS.commentBackoffMaxMs;
const DEFAULT_COMMENT_BACKOFF_MAX_RETRIES = COMMENT_EXPORT_DEFAULTS.commentBackoffMaxRetries;
const DEFAULT_RATE_LIMIT_COOLDOWN_MIN_MS = COMMENT_EXPORT_DEFAULTS.rateLimitCooldownMinMs;
const DEFAULT_RATE_LIMIT_COOLDOWN_MAX_MS = COMMENT_EXPORT_DEFAULTS.rateLimitCooldownMaxMs;

const NORMAL_REPLY_PAGES_PER_PASS = 2;
const HEAVY_REPLY_DELAY_MULTIPLIER = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min: number, max: number): number {
  const lower = Math.max(0, Math.floor(Math.min(min, max)));
  const upper = Math.max(lower, Math.floor(Math.max(min, max)));
  return lower + Math.floor(Math.random() * (upper - lower + 1));
}

function getErrorText(error: unknown): string {
  if (error instanceof Error) {
    const bbError = error as Error & { stderr?: string; stdout?: string };
    return [bbError.message, bbError.stderr, bbError.stdout].filter(Boolean).join("\n");
  }
  if (typeof error === "object" && error !== null) {
    const candidate = error as { message?: unknown; stderr?: unknown; stdout?: unknown };
    return [candidate.message, candidate.stderr, candidate.stdout]
      .filter((value) => typeof value === "string" && value.trim())
      .join("\n");
  }
  return String(error ?? "");
}

/*
function isCommentRateLimited(error: unknown): boolean {
  return /HTTP 429|rate.?limit|too many requests|security.?restriction|访问频繁|安全限制|请稍后再试|300013/i.test(
    getErrorText(error),
    cooldownUntil,
    rawMessage,
  );
}

*/
function isCommentRateLimited(error: unknown): boolean {
  return /HTTP 429|rate.?limit|too many requests|security.?restriction|visit.?too.?frequently|300013|安全限制|访问频繁|请稍后再试/i.test(
    getErrorText(error),
  );
}

function formatDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function getBackoffDelayMs(config: CommentBackoffConfig, retryAttempt: number): number {
  const multiplier = Math.max(1, 2 ** Math.max(0, retryAttempt - 1));
  const minMs = Math.min(config.maxMs, config.minMs * multiplier);
  const maxMs = Math.min(config.maxMs, Math.max(minMs, config.maxMs));
  return randomBetween(minMs, maxMs);
}

class CommentRateLimitAbortError extends Error {
  readonly cooldownUntil: string;
  readonly rawMessage: string;

  constructor(message: string, cooldownUntil: string, rawMessage: string) {
    super(message);
    this.name = "CommentRateLimitAbortError";
    this.cooldownUntil = cooldownUntil;
    this.rawMessage = rawMessage;
  }
}

/*
function buildRateLimitAbortError(
  error: unknown,
  config: CommentBackoffConfig,
  cooldownUntil: string,
): CommentRateLimitAbortError {
  const rawMessage = getErrorText(error).split(/\r?\n/).find((line) => line.trim()) || "HTTP 429";
  const retried = Math.max(0, config.maxRetries);
  return new CommentRateLimitAbortError(
    `评论采集触发小红书安全限制，已退避重试 ${retried} 次仍未恢复，请稍后使用 --resume 继续。原始错误: ${rawMessage}`,
    cooldownUntil,
    rawMessage,
  );
}

*/
function buildRateLimitAbortError(
  error: unknown,
  config: CommentBackoffConfig,
  cooldownUntil: string,
): CommentRateLimitAbortError {
  const rawMessage = getErrorText(error).split(/\r?\n/).find((line) => line.trim()) || "HTTP 429";
  const retried = Math.max(0, config.maxRetries);
  return new CommentRateLimitAbortError(
    `评论采集触发小红书安全限制，已退避重试 ${retried} 次仍未恢复，请在 ${formatDateTime(cooldownUntil)} 之后使用 --resume 继续。原始错误：${rawMessage}`,
    cooldownUntil,
    rawMessage,
  );
}

function getCooldownUntilIso(minMs: number, maxMs: number): string {
  return new Date(Date.now() + randomBetween(minMs, maxMs)).toISOString();
}

function parseFutureIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function buildRequestBudgetAbortError(requestBudgetState: CommentRequestBudgetState): Error {
  return new Error(
    `Comment export reached the per-run request-page budget ${requestBudgetState.usedPagesThisRun}/${requestBudgetState.maxPagesPerRun}. Checkpoint saved; use --resume to continue.`,
  );
}

function buildReplyThreadBudgetAbortError(
  noteId: string,
  commentId: string,
  usedPages: number,
  maxPagesPerRun: number,
): Error {
  return new Error(
    `评论导出在楼中楼线程 ${noteId}:${commentId} 上已达到单次运行上限 ${usedPages}/${maxPagesPerRun} 页。已保存 checkpoint，请稍后使用 --resume 继续。`,
  );
}

function normalizeCollectedComments(partial?: NoteCommentsPartial): CommentRecord[] {
  const list = Array.isArray(partial?.collected) ? partial.collected : [];
  return list.map((item) => normalizeCommentRecord(item as Record<string, unknown>));
}

function normalizeCurrentPagePartial(
  partial?: NoteCommentsPartial,
): NoteCommentsCurrentPagePartial | null {
  const current = partial?.current_page;
  if (!current || typeof current !== "object") {
    return null;
  }

  const roots = Array.isArray(current.roots)
    ? current.roots
      .map((root) => ({
        comment_id: String(root.comment_id || "").trim(),
        sub_comment_count: Math.max(0, Number(root.sub_comment_count) || 0),
        reply_cursor: root.reply_cursor ? String(root.reply_cursor) : null,
        reply_page_index: Math.max(1, Number(root.reply_page_index) || 1),
        done: Boolean(root.done),
      }))
      .filter((root) => root.comment_id)
    : [];

  return {
    cursor_in: current.cursor_in ? String(current.cursor_in) : null,
    page_index: Math.max(1, Number(current.page_index) || 1),
    cursor_out: current.cursor_out ? String(current.cursor_out) : null,
    has_more: Boolean(current.has_more),
    roots,
    rotation_index: roots.length > 0 ? Math.max(0, Number(current.rotation_index) || 0) % roots.length : 0,
  };
}

function serializeCurrentPagePartial(
  currentPage: NoteCommentsCurrentPagePartial | null,
): NoteCommentsCurrentPagePartial | null {
  if (!currentPage) return null;
  return {
    cursor_in: currentPage.cursor_in,
    page_index: currentPage.page_index,
    cursor_out: currentPage.cursor_out,
    has_more: currentPage.has_more,
    roots: currentPage.roots.map((root) => ({
      comment_id: root.comment_id,
      sub_comment_count: root.sub_comment_count,
      reply_cursor: root.reply_cursor,
      reply_page_index: root.reply_page_index,
      done: root.done,
    })),
    rotation_index: currentPage.rotation_index,
  };
}

function normalizeCommentPage(comments: Record<string, unknown>[]): CommentRecord[] {
  return comments.map((comment) => normalizeCommentRecord({
    ...comment,
    image_files: [],
  }));
}

function normalizeReplyThreadPreviews(
  replyThreads: CommentsPageResult["reply_threads"],
): Map<string, ReplyThreadPreviewState> {
  const normalized = new Map<string, ReplyThreadPreviewState>();

  for (const thread of Array.isArray(replyThreads) ? replyThreads : []) {
    const commentId = String(thread?.comment_id ?? "").trim();
    if (!commentId) continue;

    normalized.set(commentId, {
      comment_id: commentId,
      sub_comment_count: Math.max(0, Number(thread?.sub_comment_count) || 0),
      reply_cursor: thread?.reply_cursor ? String(thread.reply_cursor) : null,
      reply_has_more: Boolean(thread?.reply_has_more),
      preview_replies: normalizeCommentPage((thread?.preview_replies ?? []) as unknown as Record<string, unknown>[]),
    });
  }

  return normalized;
}

function getReplyPagesPerPass(
  root: ReplyQueueState,
  heavyReplyThreshold: number,
  replyBurstPages: number,
): number {
  return root.sub_comment_count >= heavyReplyThreshold
    ? 1
    : Math.max(1, replyBurstPages || NORMAL_REPLY_PAGES_PER_PASS);
}

function getNextPendingRootIndex(currentPage: NoteCommentsCurrentPagePartial | null): number {
  if (!currentPage || currentPage.roots.length === 0) {
    return -1;
  }

  const total = currentPage.roots.length;
  const start = currentPage.rotation_index % total;
  for (let offset = 0; offset < total; offset += 1) {
    const index = (start + offset) % total;
    if (!currentPage.roots[index]?.done) {
      return index;
    }
  }
  return -1;
}

async function collectAllComments(
  note: NoteRecord,
  layout: ReturnType<typeof createLayout>,
  options: ExportCommentsOptions,
  failures: ExportFailure[],
  cooldownState?: CommentCooldownState,
  rhythmState?: CommentRhythmState,
  requestBudgetState?: CommentRequestBudgetState,
  persistWorkflowCheckpoint?: () => void,
  onProgress?: (progress: CommentCollectionProgress) => void,
): Promise<CommentRecord[]> {
  const partialPath = noteCommentsPartialPath(layout, note.note_id);
  const partial = options.resume ? loadPartial<NoteCommentsPartial>(partialPath) : undefined;

  const collected = normalizeCollectedComments(partial);
  const seenCommentIds = new Set<string>(
    Array.isArray(partial?.seen_comment_ids) ? partial.seen_comment_ids.map((item) => String(item)) : [],
  );
  let nextCursor: string | null = partial?.next_cursor ?? null;
  let nextCommentsPageIndex = partial?.comments_page_index ?? 1;
  let currentPage = normalizeCurrentPagePartial(partial);
  let replyPageCount = partial?.reply_page_count ?? 0;
  let requestPageCount = partial?.request_page_count ?? 0;
  let requestAttempts = requestPageCount;

  const commentDelayMinMs = options.commentDelayMinMs ?? DEFAULT_COMMENT_DELAY_MIN_MS;
  const commentDelayMaxMs = options.commentDelayMaxMs ?? DEFAULT_COMMENT_DELAY_MAX_MS;
  const topCommentsPageSize = Math.max(1, options.topCommentsPageSize ?? DEFAULT_TOP_COMMENTS_PAGE_SIZE);
  const replyPageSize = Math.max(1, options.replyPageSize ?? DEFAULT_REPLY_PAGE_SIZE);
  const noteWarmupMinMs = options.noteWarmupMinMs ?? DEFAULT_NOTE_WARMUP_MIN_MS;
  const noteWarmupMaxMs = options.noteWarmupMaxMs ?? DEFAULT_NOTE_WARMUP_MAX_MS;
  const heavyReplyThreshold = options.heavyReplyThreshold ?? DEFAULT_HEAVY_REPLY_THRESHOLD;
  const maxReplyPagesPerThreadPerRun = options.maxReplyPagesPerThreadPerRun
    ?? DEFAULT_MAX_REPLY_PAGES_PER_THREAD_PER_RUN;
  const backoffConfig: CommentBackoffConfig = {
    minMs: options.commentBackoffMinMs ?? DEFAULT_COMMENT_BACKOFF_MIN_MS,
    maxMs: options.commentBackoffMaxMs ?? DEFAULT_COMMENT_BACKOFF_MAX_MS,
    maxRetries: options.commentBackoffMaxRetries ?? DEFAULT_COMMENT_BACKOFF_MAX_RETRIES,
  };
  const rateLimitCooldownMinMs = options.rateLimitCooldownMinMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MIN_MS;
  const rateLimitCooldownMaxMs = options.rateLimitCooldownMaxMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MAX_MS;
  const perThreadReplyPagesThisRun = new Map<string, number>();
  let noteContextWarmupPending = true;

  function consumeNoteContextWarmupMs(): number {
    if (!noteContextWarmupPending || noteWarmupMaxMs <= 0) {
      return 0;
    }
    noteContextWarmupPending = false;
    return randomBetween(noteWarmupMinMs, noteWarmupMaxMs);
  }

  function persistPartial(): void {
    saveCheckpoint(partialPath, {
      note_id: note.note_id,
      next_cursor: nextCursor,
      comments_page_index: nextCommentsPageIndex,
      current_page: serializeCurrentPagePartial(currentPage),
      reply_page_count: replyPageCount,
      request_page_count: requestPageCount,
      collected,
      seen_comment_ids: [...seenCommentIds],
    } satisfies NoteCommentsPartial);
  }

  function addUniqueComments(comments: CommentRecord[]): number {
    let addedCount = 0;
    for (const comment of comments) {
      if (!comment.comment_id || seenCommentIds.has(comment.comment_id)) {
        continue;
      }
      seenCommentIds.add(comment.comment_id);
      collected.push(comment);
      addedCount += 1;
    }
    return addedCount;
  }

  function getDelayWindow(
    target: "top-comments" | "replies",
    root: ReplyQueueState | null,
  ): { minMs: number; maxMs: number } {
    if (target === "replies" && root && root.sub_comment_count >= heavyReplyThreshold) {
      return {
        minMs: commentDelayMinMs * HEAVY_REPLY_DELAY_MULTIPLIER,
        maxMs: commentDelayMaxMs * HEAVY_REPLY_DELAY_MULTIPLIER,
      };
    }
    return { minMs: commentDelayMinMs, maxMs: commentDelayMaxMs };
  }

  async function waitBeforeRequest(
    target: "top-comments" | "replies",
    root: ReplyQueueState | null,
  ): Promise<void> {
    if (requestAttempts <= 0 || commentDelayMaxMs <= 0) {
      return;
    }
    const window = getDelayWindow(target, root);
    if (window.maxMs <= 0) {
      return;
    }
    const delayMs = randomBetween(window.minMs, window.maxMs);
    onProgress?.({
      stage: "delay",
      collectedCount: collected.length,
      commentsPageIndex: currentPage?.page_index ?? nextCommentsPageIndex,
      replyPageCount,
      requestPageCount,
      currentCommentId: root?.comment_id ?? null,
      delayMs,
      delayTarget: target,
      requestTarget: target,
    });
    await sleep(delayMs);
  }

  async function maybeApplyCooldowns(
    progressContext: CommentRequestProgressContext,
    commentDelta: number,
    requestPageDelta: number,
  ): Promise<void> {
    if (requestPageDelta > 0) {
      requestPageCount += requestPageDelta;
      requestAttempts += requestPageDelta;
      if (requestBudgetState && requestBudgetState.maxPagesPerRun > 0) {
        requestBudgetState.usedPagesThisRun += requestPageDelta;
      }
    }

    if (
      requestPageDelta > 0
      && requestBudgetState
      && requestBudgetState.maxPagesPerRun > 0
      && requestBudgetState.usedPagesThisRun >= requestBudgetState.maxPagesPerRun
    ) {
      persistPartial();
      persistWorkflowCheckpoint?.();
      throw buildRequestBudgetAbortError(requestBudgetState);
    }

    const pauses: Array<{ reason: "comment-count" | "request-pages"; every: number; ms: number }> = [];

    if (cooldownState) {
      cooldownState.collectedSinceCooldown += commentDelta;
      cooldownState.requestPagesSinceCooldown += requestPageDelta;

      if (
        cooldownState.requestPageEvery > 0
        && cooldownState.requestPageMs > 0
        && cooldownState.requestPagesSinceCooldown >= cooldownState.requestPageEvery
      ) {
        cooldownState.requestPagesSinceCooldown = 0;
        pauses.push({
          reason: "request-pages",
          every: cooldownState.requestPageEvery,
          ms: cooldownState.requestPageMs,
        });
      }

      if (
        cooldownState.commentEvery > 0
        && cooldownState.commentMs > 0
        && cooldownState.collectedSinceCooldown >= cooldownState.commentEvery
      ) {
        cooldownState.collectedSinceCooldown = 0;
        pauses.push({
          reason: "comment-count",
          every: cooldownState.commentEvery,
          ms: cooldownState.commentMs,
        });
      }
    }

    for (const pause of pauses) {
      persistPartial();
      persistWorkflowCheckpoint?.();
      onProgress?.({
        stage: "cooldown",
        collectedCount: collected.length,
        commentsPageIndex: currentPage?.page_index ?? nextCommentsPageIndex,
        replyPageCount,
        requestPageCount,
        currentCommentId: progressContext.currentCommentId,
        delayMs: pause.ms,
        cooldownReason: pause.reason,
        cooldownEvery: pause.every,
        requestTarget: progressContext.requestTarget,
      });
      await sleep(pause.ms);
    }
  }

  async function maybeApplyBurstCooldowns(
    progressContext: CommentRequestProgressContext,
  ): Promise<void> {
    if (!rhythmState || rhythmState.burstCooldownMaxMs <= 0) {
      return;
    }

    let reason: "burst-top-comments" | "burst-replies" | null = null;
    if (
      progressContext.requestTarget === "top-comments"
      && rhythmState.topCommentsBurstPages > 0
      && rhythmState.topCommentsPagesSinceBurst >= rhythmState.topCommentsBurstPages
    ) {
      rhythmState.topCommentsPagesSinceBurst = 0;
      reason = "burst-top-comments";
    } else if (
      progressContext.requestTarget === "replies"
      && rhythmState.replyBurstPages > 0
      && rhythmState.replyPagesSinceBurst >= rhythmState.replyBurstPages
    ) {
      rhythmState.replyPagesSinceBurst = 0;
      reason = "burst-replies";
    }

    if (!reason) {
      return;
    }

    const delayMs = randomBetween(rhythmState.burstCooldownMinMs, rhythmState.burstCooldownMaxMs);
    persistPartial();
    persistWorkflowCheckpoint?.();
    onProgress?.({
      stage: "cooldown",
      collectedCount: collected.length,
      commentsPageIndex: currentPage?.page_index ?? nextCommentsPageIndex,
      replyPageCount,
      requestPageCount,
      currentCommentId: progressContext.currentCommentId,
      delayMs,
      cooldownReason: reason,
      cooldownEvery: reason === "burst-top-comments"
        ? rhythmState.topCommentsBurstPages
        : rhythmState.replyBurstPages,
      requestTarget: progressContext.requestTarget,
    });
    await sleep(delayMs);
  }

  async function runCommentRequestWithBackoff<T>(
    progressContext: CommentRequestProgressContext,
    request: () => Promise<T>,
  ): Promise<T> {
    let retryAttempt = 0;
    while (true) {
      try {
        return await request();
      } catch (error) {
        if (!isCommentRateLimited(error)) {
          throw error;
        }

        persistPartial();
        persistWorkflowCheckpoint?.();

        if (retryAttempt >= backoffConfig.maxRetries) {
          throw buildRateLimitAbortError(
            error,
            backoffConfig,
            getCooldownUntilIso(rateLimitCooldownMinMs, rateLimitCooldownMaxMs),
          );
        }

        retryAttempt += 1;
        const delayMs = getBackoffDelayMs(backoffConfig, retryAttempt);
        onProgress?.({
          stage: "backoff",
          collectedCount: collected.length,
          commentsPageIndex: currentPage?.page_index ?? nextCommentsPageIndex,
          replyPageCount,
          requestPageCount,
          currentCommentId: progressContext.currentCommentId,
          delayMs,
          backoffAttempt: retryAttempt,
          backoffMaxRetries: backoffConfig.maxRetries,
          requestTarget: progressContext.requestTarget,
        });
        await sleep(delayMs);
      }
    }
  }

  async function fetchTopCommentsPage(): Promise<void> {
    const cursorIn = nextCursor;
    const pageIndex = nextCommentsPageIndex;
    const pageResult = await runCommentRequestWithBackoff(
      { currentCommentId: null, requestTarget: "top-comments" },
      async () => {
        await waitBeforeRequest("top-comments", null);
        return await commentsPage(
          note.note_id,
          note.xsec_token,
          cursorIn,
          topCommentsPageSize,
          {
            ...options,
            commentContextWarmupMs: consumeNoteContextWarmupMs(),
          },
        );
      },
    );

    writeJson(rawCommentsPagePath(layout, note.note_id, pageIndex, cursorIn), pageResult);

    const topComments = normalizeCommentPage(pageResult.comments as unknown as Record<string, unknown>[]);
    const replyThreadPreviews = normalizeReplyThreadPreviews(pageResult.reply_threads);
    let addedCount = addUniqueComments(topComments);

    for (const preview of replyThreadPreviews.values()) {
      addedCount += addUniqueComments(preview.preview_replies);
    }

    currentPage = {
      cursor_in: cursorIn,
      page_index: pageIndex,
      cursor_out: pageResult.has_more && pageResult.cursor_out && pageResult.cursor_out !== cursorIn
        ? pageResult.cursor_out
        : null,
      has_more: pageResult.has_more,
      roots: topComments
        .flatMap((comment) => {
          if (!comment.comment_id) return [];

          const preview = replyThreadPreviews.get(comment.comment_id);
          const subCommentCount = Math.max(0, preview?.sub_comment_count ?? comment.sub_comment_count ?? 0);
          if (subCommentCount <= 0) {
            return [];
          }

          const previewReplyCount = preview?.preview_replies.length ?? 0;
          const needsReplyFetch = preview
            ? preview.reply_has_more || subCommentCount > previewReplyCount
            : true;
          if (!needsReplyFetch) {
            return [];
          }

          return [{
            comment_id: comment.comment_id,
            sub_comment_count: subCommentCount,
            reply_cursor: preview?.reply_has_more ? preview.reply_cursor : null,
            reply_page_index: 1,
            done: false,
          }];
        }),
      rotation_index: 0,
    };
    nextCursor = currentPage.cursor_out;
    nextCommentsPageIndex = currentPage.cursor_out ? pageIndex + 1 : pageIndex;

    persistPartial();
    onProgress?.({
      stage: "top-comments",
      collectedCount: collected.length,
      commentsPageIndex: currentPage.page_index,
      replyPageCount,
      requestPageCount,
      currentCommentId: null,
      requestTarget: "top-comments",
    });
    await maybeApplyCooldowns({ currentCommentId: null, requestTarget: "top-comments" }, addedCount, 1);
    if (rhythmState) {
      rhythmState.topCommentsPagesSinceBurst += 1;
    }
    await maybeApplyBurstCooldowns({ currentCommentId: null, requestTarget: "top-comments" });
  }

  async function processReplySlice(rootIndex: number): Promise<void> {
    if (!currentPage) return;

    const root = currentPage.roots[rootIndex];
    if (!root || root.done) return;

    const pagesFetchedForRoot = perThreadReplyPagesThisRun.get(root.comment_id) ?? 0;
    if (maxReplyPagesPerThreadPerRun > 0 && pagesFetchedForRoot >= maxReplyPagesPerThreadPerRun) {
      persistPartial();
      persistWorkflowCheckpoint?.();
      throw buildReplyThreadBudgetAbortError(
        note.note_id,
        root.comment_id,
        pagesFetchedForRoot,
        maxReplyPagesPerThreadPerRun,
      );
    }

    let processedPages = 0;
    const pagesPerPass = getReplyPagesPerPass(
      root,
      heavyReplyThreshold,
      rhythmState?.replyBurstPages ?? DEFAULT_REPLY_BURST_PAGES,
    );

    while (!root.done && processedPages < pagesPerPass) {
      const usedPagesForRoot = perThreadReplyPagesThisRun.get(root.comment_id) ?? 0;
      if (maxReplyPagesPerThreadPerRun > 0 && usedPagesForRoot >= maxReplyPagesPerThreadPerRun) {
        persistPartial();
        persistWorkflowCheckpoint?.();
        throw buildReplyThreadBudgetAbortError(
          note.note_id,
          root.comment_id,
          usedPagesForRoot,
          maxReplyPagesPerThreadPerRun,
        );
      }
      try {
        const cursorIn = root.reply_cursor;
        const pageIndex = root.reply_page_index;
        const replyResult = await runCommentRequestWithBackoff(
          { currentCommentId: root.comment_id, requestTarget: "replies" },
          async () => {
            await waitBeforeRequest("replies", root);
            return await commentRepliesPage(
              note.note_id,
              root.comment_id,
              note.xsec_token,
              cursorIn,
              replyPageSize,
              {
                ...options,
                commentContextWarmupMs: consumeNoteContextWarmupMs(),
              },
            );
          },
        );

        writeJson(rawRepliesPagePath(layout, note.note_id, root.comment_id, pageIndex, cursorIn), replyResult);

        const replies = normalizeCommentPage(replyResult.comments as unknown as Record<string, unknown>[]);
        const addedCount = addUniqueComments(replies);
        replyPageCount += 1;
        perThreadReplyPagesThisRun.set(root.comment_id, usedPagesForRoot + 1);

        const nextReplyCursor = replyResult.has_more && replyResult.cursor_out && replyResult.cursor_out !== cursorIn
          ? replyResult.cursor_out
          : null;
        if (nextReplyCursor) {
          root.reply_cursor = nextReplyCursor;
          root.reply_page_index = pageIndex + 1;
        } else {
          root.reply_cursor = null;
          root.done = true;
        }

        persistPartial();
        onProgress?.({
          stage: "replies",
          collectedCount: collected.length,
          commentsPageIndex: currentPage.page_index,
          replyPageCount,
          requestPageCount,
          currentCommentId: root.comment_id,
          requestTarget: "replies",
        });
        await maybeApplyCooldowns({ currentCommentId: root.comment_id, requestTarget: "replies" }, addedCount, 1);
        if (rhythmState) {
          rhythmState.replyPagesSinceBurst += 1;
        }
        await maybeApplyBurstCooldowns({ currentCommentId: root.comment_id, requestTarget: "replies" });
        processedPages += 1;
      } catch (error) {
        if (isCommentRateLimited(error)) {
          throw error;
        }
        failures.push({
          scope: "reply",
          id: `${note.note_id}:${root.comment_id}`,
          message: error instanceof Error ? error.message : String(error),
        });
        root.done = true;
        persistPartial();
        break;
      }
    }

    if (currentPage?.roots.length) {
      currentPage.rotation_index = (rootIndex + 1) % currentPage.roots.length;
      persistPartial();
    }
  }

  while (true) {
    if (!currentPage) {
      await fetchTopCommentsPage();
    }

    const pendingRootIndex = getNextPendingRootIndex(currentPage);
    if (pendingRootIndex >= 0) {
      await processReplySlice(pendingRootIndex);
      continue;
    }

    currentPage = null;
    persistPartial();

    if (!nextCursor) {
      break;
    }
  }

  return collected;
}

/*
export async function exportCommentsWorkflow(options: ExportCommentsOptions): Promise<ExportCommentsResult> {
  const progress = new TerminalProgress();
  const layout = createLayout(options.outputDir);
  const checkpointPath = commentsCheckpointPath(layout);
  const checkpoint = options.resume ? loadCheckpoint<CommentsCheckpoint>(checkpointPath, "comments") : undefined;
  const manifest = createManifest("comments", options.keyword, options.topNotes);
  const existingNotes = options.resume ? readJsonIfExists<NoteRecord[]>(layout.normalizedNotesPath) || [] : [];
  const notesById = new Map(existingNotes.map((note) => [note.note_id, note]));
  const selectedNoteIds = new Set(checkpoint?.selected_note_ids || existingNotes.map((note) => note.note_id));
  const completedNoteIds = new Set(checkpoint?.completed_note_ids || []);
  const failedNotes = { ...(checkpoint?.failed_notes || {}) };
  const commentCooldownState: CommentCooldownState = {
    commentEvery: options.commentCooldownEvery ?? DEFAULT_COMMENT_COOLDOWN_EVERY,
    commentMs: options.commentCooldownMs ?? DEFAULT_COMMENT_COOLDOWN_MS,
    collectedSinceCooldown: 0,
    requestPageEvery: options.commentRequestCooldownEveryPages ?? DEFAULT_COMMENT_REQUEST_COOLDOWN_EVERY_PAGES,
    requestPageMs: options.commentRequestCooldownMs ?? DEFAULT_COMMENT_REQUEST_COOLDOWN_MS,
    requestPagesSinceCooldown: 0,
  };
  const requestBudgetState: CommentRequestBudgetState = {
    maxPagesPerRun: options.commentMaxRequestPagesPerRun ?? DEFAULT_COMMENT_MAX_REQUEST_PAGES_PER_RUN,
    usedPagesThisRun: 0,
  };
  let page = checkpoint?.selection_next_page ?? 1;
  let hasMore = true;

  function renderSelectionProgress(label: string, detail?: string): void {
    progress.update({
      label,
      current: Math.min(notesById.size, options.topNotes),
      total: Math.max(options.topNotes, 1),
      detail: detail ?? `搜索页=${page} 已选=${notesById.size} 失败=${Object.keys(failedNotes).length}`,
    });
  }

  function renderCommentProgress(noteOrder: number, noteTotal: number, detail: string): void {
    progress.update({
      label: "抓取评论",
      current: Math.min(noteOrder, Math.max(noteTotal, 1)),
      total: Math.max(noteTotal, 1),
      detail,
    });
  }

  function buildCommentProgressText(
    noteOrder: number,
    noteTotal: number,
    state: {
      collectedCount?: number;
      commentsPageIndex?: number;
      replyPageCount?: number;
      delayMs?: number;
      delayTarget?: "top-comments" | "replies";
      cooldownReason?: "comment-count" | "request-pages";
      cooldownEvery?: number;
      backoffAttempt?: number;
      backoffMaxRetries?: number;
      requestTarget?: "top-comments" | "replies";
      status?: "开始" | "抓评论" | "抓回复" | "等待" | "暂停" | "退避" | "完成";
      commentCount?: number;
    },
  ): string {
    const noteText = `第${noteOrder}/${noteTotal}篇笔记`;
    const collectedText = typeof state.collectedCount === "number"
      ? `已抓到${state.collectedCount}条评论（含回复）`
      : "";
    const pageContext: string[] = [];

    if (typeof state.commentsPageIndex === "number") {
      pageContext.push(`当前一级评论页=${state.commentsPageIndex}`);
    }
    if (typeof state.replyPageCount === "number" && state.replyPageCount > 0) {
      pageContext.push(`累计回复页=${state.replyPageCount}`);
    }

    const pageText = pageContext.join("，");
    const delayText = typeof state.delayMs === "number"
      ? `${(state.delayMs / 1000).toFixed(1)}秒`
      : "";
    const doneCount = typeof state.commentCount === "number" ? state.commentCount : state.collectedCount;
    const joinText = (...parts: Array<string | undefined>): string =>
      parts.filter((part) => Boolean(part && part.trim())).join("，");

    switch (state.status) {
      case "开始":
        return `${noteText}：准备开始抓取评论`;
      case "抓评论":
        return `${noteText}：${joinText(collectedText, "正在抓取一级评论", pageText)}`;
      case "抓回复":
        return `${noteText}：${joinText(collectedText, "正在轮转抓取楼中楼回复", pageText)}`;
      case "等待": {
        const targetText = state.delayTarget === "replies" ? "楼中楼回复" : "一级评论";
        return `${noteText}：${joinText(collectedText, `${delayText}后继续抓取${targetText}`, pageText)}`;
      }
      case "暂停": {
        const cooldownText = state.cooldownReason === "request-pages"
          ? `每${state.cooldownEvery ?? 0}个请求页暂停一次`
          : `每${state.cooldownEvery ?? 0}条评论暂停一次`;
        return `${noteText}：${joinText(collectedText, `按节流规则暂停${delayText}`, cooldownText, pageText)}`;
      }
      case "退避": {
        const retryText = typeof state.backoffAttempt === "number" && typeof state.backoffMaxRetries === "number"
          ? `第${state.backoffAttempt}/${state.backoffMaxRetries}次重试`
          : "";
        const targetText = state.requestTarget === "replies" ? "楼中楼回复" : "一级评论";
        return `${noteText}：${joinText(collectedText, `触发访问限制，${delayText}后重试${targetText}`, retryText, pageText)}`;
      }
      case "完成":
        return `${noteText}：已完成，共导出${doneCount ?? 0}条评论`;
      default:
        return `${noteText}：${joinText(collectedText, pageText)}`;
    }
  }

  function persistCheckpoint(completed: boolean): void {
    const nextCheckpoint: CommentsCheckpoint = {
      workflow: "comments",
      keyword: options.keyword,
      top_notes: options.topNotes,
      selection_next_page: page,
      selected_note_ids: [...selectedNoteIds],
      completed_note_ids: [...completedNoteIds],
      failed_notes: failedNotes,
      completed,
    };
    saveCheckpoint(checkpointPath, nextCheckpoint);
  }

  async function processSummary(summary: SearchPageNote): Promise<void> {
    if (notesById.size >= options.topNotes) return;
    if (notesById.has(summary.note_id)) return;

    renderSelectionProgress("抓取候选详情", `搜索页=${page} 笔记=${summary.note_id}`);
    try {
      const detail = await noteDetail(summary.note_id, summary.xsec_token, options);
      writeJson(rawNotePath(layout, summary.note_id), detail);
      const merged = mergeNote(summary, detail as unknown as Record<string, unknown>);
      const withMedia = await downloadNoteMedia(merged, layout, options);
      notesById.set(withMedia.note_id, withMedia);
      delete failedNotes[withMedia.note_id];
    } catch (error) {
      failedNotes[summary.note_id] = error instanceof Error ? error.message : String(error);
    }
    renderSelectionProgress("挑选高评论笔记");
  }

  try {
    renderSelectionProgress("挑选高评论笔记");

    while (notesById.size < options.topNotes && hasMore) {
      renderSelectionProgress("搜索结果页", `正在加载第${page}页`);
      const pageResult = await searchPage(options.keyword, options.sort || "comments", page, 20, options);
      writeJson(rawSearchPagePath(layout, page), pageResult);
      const candidates = pageResult.notes.filter((note) => {
        if (!note.note_id) return false;
        if (selectedNoteIds.has(note.note_id)) return false;
        selectedNoteIds.add(note.note_id);
        return true;
      });

      renderSelectionProgress(
        "挑选高评论笔记",
        `搜索页=${page} 候选=${candidates.length} 失败=${Object.keys(failedNotes).length}`,
      );
      await runWithConcurrency(candidates, 1, processSummary);
      hasMore = pageResult.has_more;
      page += 1;
      persistCheckpoint(false);
    }

    const selectedNotes = [...notesById.values()]
      .sort((left, right) => {
        if (options.sort === "latest") {
          return new Date(right.published_at || 0).getTime() - new Date(left.published_at || 0).getTime();
        }
        if (options.sort === "likes") {
          return (right.liked_count ?? 0) - (left.liked_count ?? 0)
            || (right.comment_count ?? 0) - (left.comment_count ?? 0);
        }
        if (options.sort === "collects") {
          return (right.collect_count ?? 0) - (left.collect_count ?? 0)
            || (right.comment_count ?? 0) - (left.comment_count ?? 0);
        }
        return (right.comment_count ?? 0) - (left.comment_count ?? 0)
          || (right.liked_count ?? 0) - (left.liked_count ?? 0);
      })
      .slice(0, options.topNotes)
      .map((note, index) => ({ ...note, rank: index + 1 }));

    if (options.resume) {
      for (const note of selectedNotes) {
        const existingComments = readJsonIfExists<CommentRecord[]>(normalizedCommentsPath(layout, note.note_id));
        if (existingComments) {
          completedNoteIds.add(note.note_id);
        }
      }
      persistCheckpoint(false);
    }

    writeJson(layout.normalizedNotesPath, selectedNotes);
    progress.update({
      label: "导出评论",
      current: completedNoteIds.size,
      total: Math.max(selectedNotes.length, 1),
      detail: `已完成=${completedNoteIds.size} 失败=${Object.keys(failedNotes).length}`,
    });

    const perNoteResults = await runWithConcurrency(
      selectedNotes.filter((note) => !completedNoteIds.has(note.note_id)),
      1,
      async (note) => {
        const failures: ExportFailure[] = [];
        const noteOrder = note.rank ?? 0;
        renderCommentProgress(
          noteOrder,
          selectedNotes.length,
          buildCommentProgressText(noteOrder, selectedNotes.length, { status: "开始" }),
        );

        const comments = await collectAllComments(
          note,
          layout,
          options,
          failures,
          commentCooldownState,
          requestBudgetState,
          () => persistCheckpoint(false),
          (state) => {
            if (state.stage === "delay" || state.stage === "cooldown" || state.stage === "backoff") {
              renderCommentProgress(
                noteOrder,
                selectedNotes.length,
                buildCommentProgressText(noteOrder, selectedNotes.length, {
                  status: state.stage === "cooldown"
                    ? "暂停"
                    : state.stage === "backoff"
                      ? "退避"
                      : "等待",
                  collectedCount: state.collectedCount,
                  commentsPageIndex: state.commentsPageIndex,
                  replyPageCount: state.replyPageCount,
                  delayMs: state.delayMs,
                  delayTarget: state.delayTarget,
                  cooldownReason: state.cooldownReason,
                  cooldownEvery: state.cooldownEvery,
                  backoffAttempt: state.backoffAttempt,
                  backoffMaxRetries: state.backoffMaxRetries,
                  requestTarget: state.requestTarget,
                }),
              );
              return;
            }

            renderCommentProgress(
              noteOrder,
              selectedNotes.length,
              buildCommentProgressText(noteOrder, selectedNotes.length, {
                status: state.stage === "replies" ? "抓回复" : "抓评论",
                collectedCount: state.collectedCount,
                commentsPageIndex: state.commentsPageIndex,
                replyPageCount: state.replyPageCount,
              }),
            );
          },
        );

        const commentsWithMedia = await downloadCommentImages(note.note_id, comments, layout, options);
        writeJson(normalizedCommentsPath(layout, note.note_id), commentsWithMedia);
        const markdownPath = commentsMarkdownPath(layout, note.rank ?? 0, note.note_id);
        writeText(markdownPath, renderCommentsMarkdown(note, commentsWithMedia, markdownPath));
        completedNoteIds.add(note.note_id);
        persistCheckpoint(false);
        renderCommentProgress(
          noteOrder,
          selectedNotes.length,
          buildCommentProgressText(noteOrder, selectedNotes.length, {
            status: "完成",
            commentCount: commentsWithMedia.length,
          }),
        );
        return {
          note,
          comments: commentsWithMedia,
          markdownPath,
          failures,
        };
      },
    );

    const completedResults = selectedNotes.map((note) => {
      const finished = perNoteResults.find((result) => result.note.note_id === note.note_id);
      if (finished) return finished;
      const existingComments = readJsonIfExists<CommentRecord[]>(normalizedCommentsPath(layout, note.note_id)) || [];
      const markdownPath = commentsMarkdownPath(layout, note.rank ?? 0, note.note_id);
      return {
        note,
        comments: existingComments,
        markdownPath,
        failures: [] as ExportFailure[],
      };
    });

    writeText(
      layout.markdownCommentsIndexPath,
      renderCommentsIndex(
        completedResults.map((item) => ({ note: item.note, commentCount: item.comments.length })),
      ),
    );

    manifest.note_count = selectedNotes.length;
    manifest.comment_count = completedResults.reduce((sum, item) => sum + item.comments.length, 0);
    manifest.failures = [
      ...Object.entries(failedNotes).map(([id, message]) => ({ scope: "note", id, message })),
      ...completedResults.flatMap((item) => item.failures),
    ];
    manifest.completed_at = new Date().toISOString();
    manifest.files.normalized_notes = relative(layout.baseDir, layout.normalizedNotesPath);
    manifest.files.normalized_comments = completedResults.map((item) =>
      relative(layout.baseDir, normalizedCommentsPath(layout, item.note.note_id))
    );
    manifest.files.comments_markdown = completedResults.map((item) => relative(layout.baseDir, item.markdownPath));
    writeJson(layout.manifestPath, manifest);

    persistCheckpoint(true);

    return {
      outputDir: layout.baseDir,
      noteCount: selectedNotes.length,
      commentCount: manifest.comment_count,
      manifestPath: layout.manifestPath,
    };
  } finally {
    progress.finish();
  }
}
*/

export async function exportCommentsWorkflow(options: ExportCommentsOptions): Promise<ExportCommentsResult> {
  const progress = new TerminalProgress();

  try {
    const layout = createLayout(options.outputDir);
    const checkpointPath = commentsCheckpointPath(layout);
    const checkpoint = options.resume ? loadCheckpoint<CommentsCheckpoint>(checkpointPath, "comments") : undefined;
    const activeCooldownUntil = parseFutureIso(checkpoint?.cooldown_until);

    if (activeCooldownUntil && activeCooldownUntil.getTime() > Date.now()) {
      const reasonText = checkpoint?.cooldown_reason
        ? ` 最近一次错误：${checkpoint.cooldown_reason}`
        : "";
      throw new Error(
        `评论导出仍处于冷却期，请在 ${formatDateTime(activeCooldownUntil)} 之后再次执行 --resume。${reasonText}`.trim(),
      );
    }

    const manifest = createManifest("comments", options.keyword, options.topNotes);
    const existingNotes = options.resume ? readJsonIfExists<NoteRecord[]>(layout.normalizedNotesPath) || [] : [];
    const notesById = new Map(existingNotes.map((note) => [note.note_id, note]));
    const selectedNoteIds = new Set(checkpoint?.selected_note_ids || existingNotes.map((note) => note.note_id));
    const completedNoteIds = new Set(checkpoint?.completed_note_ids || []);
    const failedNotes = { ...(checkpoint?.failed_notes || {}) };
    let cooldownUntil: string | null = null;
    let cooldownReason: string | null = null;

    const commentCooldownState: CommentCooldownState = {
      commentEvery: options.commentCooldownEvery ?? DEFAULT_COMMENT_COOLDOWN_EVERY,
      commentMs: options.commentCooldownMs ?? DEFAULT_COMMENT_COOLDOWN_MS,
      collectedSinceCooldown: 0,
      requestPageEvery: options.commentRequestCooldownEveryPages ?? DEFAULT_COMMENT_REQUEST_COOLDOWN_EVERY_PAGES,
      requestPageMs: options.commentRequestCooldownMs ?? DEFAULT_COMMENT_REQUEST_COOLDOWN_MS,
      requestPagesSinceCooldown: 0,
    };
    const requestBudgetState: CommentRequestBudgetState = {
      maxPagesPerRun: options.commentMaxRequestPagesPerRun ?? DEFAULT_COMMENT_MAX_REQUEST_PAGES_PER_RUN,
      usedPagesThisRun: 0,
    };
    const createRhythmState = (): CommentRhythmState => ({
      noteWarmupMinMs: options.noteWarmupMinMs ?? DEFAULT_NOTE_WARMUP_MIN_MS,
      noteWarmupMaxMs: options.noteWarmupMaxMs ?? DEFAULT_NOTE_WARMUP_MAX_MS,
      topCommentsBurstPages: options.topCommentsBurstPages ?? DEFAULT_TOP_COMMENTS_BURST_PAGES,
      replyBurstPages: options.replyBurstPages ?? DEFAULT_REPLY_BURST_PAGES,
      burstCooldownMinMs: options.burstCooldownMinMs ?? DEFAULT_BURST_COOLDOWN_MIN_MS,
      burstCooldownMaxMs: options.burstCooldownMaxMs ?? DEFAULT_BURST_COOLDOWN_MAX_MS,
      topCommentsPagesSinceBurst: 0,
      replyPagesSinceBurst: 0,
    });
    let page = checkpoint?.selection_next_page ?? 1;
    let hasMore = true;

    function renderSelectionProgress(label: string, detail?: string): void {
      progress.update({
        label,
        current: Math.min(notesById.size, options.topNotes),
        total: Math.max(options.topNotes, 1),
        detail: detail ?? `搜索页 ${page}，已选 ${notesById.size}，失败 ${Object.keys(failedNotes).length}`,
      });
    }

    function renderCommentProgress(noteOrder: number, noteTotal: number, detail: string): void {
      progress.update({
        label: "抓取评论",
        current: Math.min(noteOrder, Math.max(noteTotal, 1)),
        total: Math.max(noteTotal, 1),
        detail,
      });
    }

    function buildCommentProgressText(
      noteOrder: number,
      noteTotal: number,
      state: {
        collectedCount?: number;
        commentsPageIndex?: number;
        replyPageCount?: number;
        delayMs?: number;
        delayTarget?: "top-comments" | "replies";
        cooldownReason?: "comment-count" | "request-pages" | "burst-top-comments" | "burst-replies";
        cooldownEvery?: number;
        backoffAttempt?: number;
        backoffMaxRetries?: number;
        requestTarget?: "top-comments" | "replies";
        status?:
          | "start"
          | "fetch-top-comments"
          | "fetch-replies"
          | "wait"
          | "cooldown"
          | "backoff"
          | "done";
        commentCount?: number;
      },
    ): string {
      const noteText = `第 ${noteOrder}/${noteTotal} 篇笔记`;
      const collectedText = typeof state.collectedCount === "number"
        ? `已采集 ${state.collectedCount} 条评论（含回复）`
        : "";
      const pageContext: string[] = [];

      if (typeof state.commentsPageIndex === "number") {
        pageContext.push(`一级评论页=${state.commentsPageIndex}`);
      }
      if (typeof state.replyPageCount === "number" && state.replyPageCount > 0) {
        pageContext.push(`累计回复页=${state.replyPageCount}`);
      }

      const pageText = pageContext.join("，");
      const delayText = typeof state.delayMs === "number"
        ? `${(state.delayMs / 1000).toFixed(state.delayMs % 1000 === 0 ? 0 : 1)} 秒`
        : "";
      const doneCount = typeof state.commentCount === "number" ? state.commentCount : state.collectedCount;
      const joinText = (...parts: Array<string | undefined>): string =>
        parts.filter((part) => Boolean(part && part.trim())).join("，");

      switch (state.status) {
        case "start":
          return `${noteText}：准备开始抓取评论`;
        case "fetch-top-comments":
          return `${noteText}：${joinText(collectedText, "正在抓取一级评论", pageText)}`;
        case "fetch-replies":
          return `${noteText}：${joinText(collectedText, "正在轮转抓取楼中楼回复", pageText)}`;
        case "wait": {
          const targetText = state.delayTarget === "replies" ? "楼中楼回复" : "一级评论";
          return `${noteText}：${joinText(collectedText, `${delayText}后继续抓取${targetText}`, pageText)}`;
        }
        case "cooldown": {
          const cooldownText = state.cooldownReason === "request-pages"
            ? `每 ${state.cooldownEvery ?? 0} 个请求页暂停一次`
            : state.cooldownReason === "comment-count"
              ? `每 ${state.cooldownEvery ?? 0} 条评论暂停一次`
              : state.cooldownReason === "burst-top-comments"
                ? `连续抓取 ${state.cooldownEvery ?? 0} 页一级评论后暂停`
                : `连续抓取 ${state.cooldownEvery ?? 0} 页回复后暂停`;
          return `${noteText}：${joinText(collectedText, `按节奏暂停 ${delayText}`, cooldownText, pageText)}`;
        }
        case "backoff": {
          const retryText = typeof state.backoffAttempt === "number" && typeof state.backoffMaxRetries === "number"
            ? `第 ${state.backoffAttempt}/${state.backoffMaxRetries} 次重试`
            : "";
          const targetText = state.requestTarget === "replies" ? "楼中楼回复" : "一级评论";
          return `${noteText}：${joinText(collectedText, `触发访问限制，${delayText}后重试${targetText}`, retryText, pageText)}`;
        }
        case "done":
          return `${noteText}：已完成，共导出 ${doneCount ?? 0} 条评论`;
        default:
          return `${noteText}：${joinText(collectedText, pageText)}`;
      }
    }

    function persistCheckpoint(completed: boolean): void {
      const nextCheckpoint: CommentsCheckpoint = {
        workflow: "comments",
        keyword: options.keyword,
        top_notes: options.topNotes,
        selection_next_page: page,
        selected_note_ids: [...selectedNoteIds],
        completed_note_ids: [...completedNoteIds],
        failed_notes: failedNotes,
        cooldown_until: completed ? null : cooldownUntil,
        cooldown_reason: completed ? null : cooldownReason,
        completed,
      };
      saveCheckpoint(checkpointPath, nextCheckpoint);
    }

    async function processSummary(summary: SearchPageNote): Promise<void> {
      if (notesById.size >= options.topNotes) return;
      if (notesById.has(summary.note_id)) return;

      renderSelectionProgress("抓取候选详情", `搜索页 ${page}，笔记=${summary.note_id}`);
      try {
        const detail = await noteDetail(summary.note_id, summary.xsec_token, options);
        writeJson(rawNotePath(layout, summary.note_id), detail);
        const merged = mergeNote(summary, detail as unknown as Record<string, unknown>);
        const withMedia = await downloadNoteMedia(merged, layout, options);
        notesById.set(withMedia.note_id, withMedia);
        delete failedNotes[withMedia.note_id];
      } catch (error) {
        failedNotes[summary.note_id] = error instanceof Error ? error.message : String(error);
      }
      renderSelectionProgress("挑选高评论笔记");
    }

    renderSelectionProgress("挑选高评论笔记");

    while (notesById.size < options.topNotes && hasMore) {
      renderSelectionProgress("搜索结果页", `正在加载第 ${page} 页`);
      const pageResult = await searchPage(options.keyword, options.sort || "comments", page, 20, options);
      writeJson(rawSearchPagePath(layout, page), pageResult);
      const candidates = pageResult.notes.filter((note) => {
        if (!note.note_id) return false;
        if (selectedNoteIds.has(note.note_id)) return false;
        selectedNoteIds.add(note.note_id);
        return true;
      });

      renderSelectionProgress(
        "挑选高评论笔记",
        `搜索页 ${page}，候选 ${candidates.length}，失败 ${Object.keys(failedNotes).length}`,
      );
      await runWithConcurrency(candidates, 1, processSummary);
      hasMore = pageResult.has_more;
      page += 1;
      persistCheckpoint(false);
    }

    const selectedNotes = [...notesById.values()]
      .sort((left, right) => {
        if (options.sort === "latest") {
          return new Date(right.published_at || 0).getTime() - new Date(left.published_at || 0).getTime();
        }
        if (options.sort === "likes") {
          return (right.liked_count ?? 0) - (left.liked_count ?? 0)
            || (right.comment_count ?? 0) - (left.comment_count ?? 0);
        }
        if (options.sort === "collects") {
          return (right.collect_count ?? 0) - (left.collect_count ?? 0)
            || (right.comment_count ?? 0) - (left.comment_count ?? 0);
        }
        return (right.comment_count ?? 0) - (left.comment_count ?? 0)
          || (right.liked_count ?? 0) - (left.liked_count ?? 0);
      })
      .slice(0, options.topNotes)
      .map((note, index) => ({ ...note, rank: index + 1 }));

    if (options.resume) {
      for (const note of selectedNotes) {
        const existingComments = readJsonIfExists<CommentRecord[]>(normalizedCommentsPath(layout, note.note_id));
        if (existingComments) {
          completedNoteIds.add(note.note_id);
        }
      }
      persistCheckpoint(false);
    }

    writeJson(layout.normalizedNotesPath, selectedNotes);
    progress.update({
      label: "导出评论",
      current: completedNoteIds.size,
      total: Math.max(selectedNotes.length, 1),
      detail: `已完成 ${completedNoteIds.size}，失败 ${Object.keys(failedNotes).length}`,
    });

    const perNoteResults = await runWithConcurrency(
      selectedNotes.filter((note) => !completedNoteIds.has(note.note_id)),
      1,
      async (note) => {
        const failures: ExportFailure[] = [];
        const noteOrder = note.rank ?? 0;
        const rhythmState = createRhythmState();

        renderCommentProgress(
          noteOrder,
          selectedNotes.length,
          buildCommentProgressText(noteOrder, selectedNotes.length, { status: "start" }),
        );

        let comments: CommentRecord[];
        try {
          comments = await collectAllComments(
            note,
            layout,
            options,
            failures,
            commentCooldownState,
            rhythmState,
            requestBudgetState,
            () => persistCheckpoint(false),
            (state) => {
              if (state.stage === "delay" || state.stage === "cooldown" || state.stage === "backoff") {
                renderCommentProgress(
                  noteOrder,
                  selectedNotes.length,
                  buildCommentProgressText(noteOrder, selectedNotes.length, {
                    status: state.stage === "cooldown"
                      ? "cooldown"
                      : state.stage === "backoff"
                        ? "backoff"
                        : "wait",
                    collectedCount: state.collectedCount,
                    commentsPageIndex: state.commentsPageIndex,
                    replyPageCount: state.replyPageCount,
                    delayMs: state.delayMs,
                    delayTarget: state.delayTarget,
                    cooldownReason: state.cooldownReason,
                    cooldownEvery: state.cooldownEvery,
                    backoffAttempt: state.backoffAttempt,
                    backoffMaxRetries: state.backoffMaxRetries,
                    requestTarget: state.requestTarget,
                  }),
                );
                return;
              }

              renderCommentProgress(
                noteOrder,
                selectedNotes.length,
                buildCommentProgressText(noteOrder, selectedNotes.length, {
                  status: state.stage === "replies" ? "fetch-replies" : "fetch-top-comments",
                  collectedCount: state.collectedCount,
                  commentsPageIndex: state.commentsPageIndex,
                  replyPageCount: state.replyPageCount,
                }),
              );
            },
          );
        } catch (error) {
          if (error instanceof CommentRateLimitAbortError) {
            cooldownUntil = error.cooldownUntil;
            cooldownReason = error.rawMessage;
            persistCheckpoint(false);
          }
          throw error;
        }

        const commentsWithMedia = await downloadCommentImages(note.note_id, comments, layout, options);
        writeJson(normalizedCommentsPath(layout, note.note_id), commentsWithMedia);
        const markdownPath = commentsMarkdownPath(layout, note.rank ?? 0, note.note_id);
        writeText(markdownPath, renderCommentsMarkdown(note, commentsWithMedia, markdownPath));
        completedNoteIds.add(note.note_id);
        persistCheckpoint(false);
        renderCommentProgress(
          noteOrder,
          selectedNotes.length,
          buildCommentProgressText(noteOrder, selectedNotes.length, {
            status: "done",
            commentCount: commentsWithMedia.length,
          }),
        );
        return {
          note,
          comments: commentsWithMedia,
          markdownPath,
          failures,
        };
      },
    );

    const completedResults = selectedNotes.map((note) => {
      const finished = perNoteResults.find((result) => result.note.note_id === note.note_id);
      if (finished) return finished;
      const existingComments = readJsonIfExists<CommentRecord[]>(normalizedCommentsPath(layout, note.note_id)) || [];
      const markdownPath = commentsMarkdownPath(layout, note.rank ?? 0, note.note_id);
      return {
        note,
        comments: existingComments,
        markdownPath,
        failures: [] as ExportFailure[],
      };
    });

    writeText(
      layout.markdownCommentsIndexPath,
      renderCommentsIndex(
        completedResults.map((item) => ({ note: item.note, commentCount: item.comments.length })),
      ),
    );

    manifest.note_count = selectedNotes.length;
    manifest.comment_count = completedResults.reduce((sum, item) => sum + item.comments.length, 0);
    manifest.failures = [
      ...Object.entries(failedNotes).map(([id, message]) => ({ scope: "note", id, message })),
      ...completedResults.flatMap((item) => item.failures),
    ];
    manifest.completed_at = new Date().toISOString();
    manifest.files.normalized_notes = relative(layout.baseDir, layout.normalizedNotesPath);
    manifest.files.normalized_comments = completedResults.map((item) =>
      relative(layout.baseDir, normalizedCommentsPath(layout, item.note.note_id))
    );
    manifest.files.comments_markdown = completedResults.map((item) => relative(layout.baseDir, item.markdownPath));
    writeJson(layout.manifestPath, manifest);

    persistCheckpoint(true);

    return {
      outputDir: layout.baseDir,
      noteCount: selectedNotes.length,
      commentCount: manifest.comment_count,
      manifestPath: layout.manifestPath,
    };
  } finally {
    progress.finish();
  }
}
