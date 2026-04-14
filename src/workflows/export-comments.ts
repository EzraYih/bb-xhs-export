import { relative } from "node:path";
import {
  searchPage,
  noteDetail,
  commentsChunk,
  type SearchPageNote,
  type CommentPageRecord,
  type CommentsChunkResult,
  type CommentsChunkSessionState,
} from "../bb/xiaohongshu.js";
import { mergeNote } from "./shared.js";
import type { BbBrowserOptions } from "../bb/run-site.js";
import {
  loadCheckpoint,
  saveCheckpoint,
  type CommentsCheckpoint,
  type NoteCommentsPartial,
  type NoteCommentsSessionPartial,
  type ReplyQueueCursorState,
  loadPartial,
} from "../cache/checkpoint.js";
import { readJsonIfExists, writeJson, writeText } from "../cache/store.js";
import {
  commentsCheckpointPath,
  commentsMarkdownPath,
  createLayout,
  normalizedCommentsPath,
  noteCommentsPartialPath,
  rawNotePath,
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
  chunkMaxRequests?: number;
  chunkPauseMinMs?: number;
  chunkPauseMaxMs?: number;
  notePauseMinMs?: number;
  notePauseMaxMs?: number;
}

export interface ExportCommentsResult {
  outputDir: string;
  noteCount: number;
  commentCount: number;
  manifestPath: string;
  summary: ExportCommentsSummary;
}

export interface ExportCommentsNoteSummary {
  rank: number;
  noteId: string;
  title: string | null;
  displayedCommentCount: number | null;
  collectedCommentCount: number;
  status: "completed" | "failed";
  failureMessage: string | null;
}

export interface ExportCommentsSummary {
  requestedNoteCount: number;
  selectedNoteCount: number;
  completedNoteCount: number;
  failedNoteCount: number;
  displayedCommentCountTotal: number;
  displayedCommentCountKnownNotes: number;
  collectedCommentCountTotal: number;
  elapsedMs: number;
  notes: ExportCommentsNoteSummary[];
}

interface NoteCommentProgress {
  status: "start" | "chunk" | "wait_chunk" | "wait_note" | "done";
  collectedCount: number;
  topPageCount: number;
  replyPageCount: number;
  requestPageCount: number;
  replyQueueSize: number;
  chunkCount: number;
  chunkResult?: CommentsChunkResult;
  waitMs?: number;
}

export const COMMENT_EXPORT_DEFAULTS = {
  topCommentsPageSize: 20,
  replyPageSize: 10,
  chunkMaxRequests: 14,
  chunkMaxTopPages: 2,
  chunkMaxReplyPages: 12,
  chunkPauseMinMs: 3000,
  chunkPauseMaxMs: 8000,
  notePauseMinMs: 10000,
  notePauseMaxMs: 20000,
  noteContextWarmupMinMs: 2000,
  noteContextWarmupMaxMs: 4000,
  intraChunkIdleMinMs: 150,
  intraChunkIdleMaxMs: 400,
  heavyReplyThreshold: 100,
  selectionBufferSize: 20,
  rateLimitCooldownMinMs: 1800000,
  rateLimitCooldownMaxMs: 5400000,
} as const;

const DEFAULT_TOP_COMMENTS_PAGE_SIZE = COMMENT_EXPORT_DEFAULTS.topCommentsPageSize;
const DEFAULT_REPLY_PAGE_SIZE = COMMENT_EXPORT_DEFAULTS.replyPageSize;
const DEFAULT_CHUNK_MAX_REQUESTS = COMMENT_EXPORT_DEFAULTS.chunkMaxRequests;
const DEFAULT_CHUNK_MAX_TOP_PAGES = COMMENT_EXPORT_DEFAULTS.chunkMaxTopPages;
const DEFAULT_CHUNK_MAX_REPLY_PAGES = COMMENT_EXPORT_DEFAULTS.chunkMaxReplyPages;
const DEFAULT_CHUNK_PAUSE_MIN_MS = COMMENT_EXPORT_DEFAULTS.chunkPauseMinMs;
const DEFAULT_CHUNK_PAUSE_MAX_MS = COMMENT_EXPORT_DEFAULTS.chunkPauseMaxMs;
const DEFAULT_NOTE_PAUSE_MIN_MS = COMMENT_EXPORT_DEFAULTS.notePauseMinMs;
const DEFAULT_NOTE_PAUSE_MAX_MS = COMMENT_EXPORT_DEFAULTS.notePauseMaxMs;
const DEFAULT_NOTE_CONTEXT_WARMUP_MIN_MS = COMMENT_EXPORT_DEFAULTS.noteContextWarmupMinMs;
const DEFAULT_NOTE_CONTEXT_WARMUP_MAX_MS = COMMENT_EXPORT_DEFAULTS.noteContextWarmupMaxMs;
const DEFAULT_INTRA_CHUNK_IDLE_MIN_MS = COMMENT_EXPORT_DEFAULTS.intraChunkIdleMinMs;
const DEFAULT_INTRA_CHUNK_IDLE_MAX_MS = COMMENT_EXPORT_DEFAULTS.intraChunkIdleMaxMs;
const DEFAULT_HEAVY_REPLY_THRESHOLD = COMMENT_EXPORT_DEFAULTS.heavyReplyThreshold;
const DEFAULT_SELECTION_BUFFER_SIZE = COMMENT_EXPORT_DEFAULTS.selectionBufferSize;
const DEFAULT_RATE_LIMIT_COOLDOWN_MIN_MS = COMMENT_EXPORT_DEFAULTS.rateLimitCooldownMinMs;
const DEFAULT_RATE_LIMIT_COOLDOWN_MAX_MS = COMMENT_EXPORT_DEFAULTS.rateLimitCooldownMaxMs;
const MAX_INLINE_SESSION_STATE_CHARS = 12000;

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

function getCooldownUntilIso(minMs: number, maxMs: number): string {
  return new Date(Date.now() + randomBetween(minMs, maxMs)).toISOString();
}

function formatWaitSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)} 秒`;
}

function parseFutureIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
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

function buildRateLimitAbortError(
  error: unknown,
  cooldownUntil: string,
): CommentRateLimitAbortError {
  const rawMessage = getErrorText(error).split(/\r?\n/).find((line) => line.trim()) || "HTTP 429";
  return new CommentRateLimitAbortError(
    `评论采集触发小红书安全限制，请在 ${formatDateTime(cooldownUntil)} 之后使用 --resume 继续。原始错误：${rawMessage}`,
    cooldownUntil,
    rawMessage,
  );
}

function sortCandidateNotes(
  notes: SearchPageNote[],
  sort: ExportCommentsOptions["sort"],
): SearchPageNote[] {
  return [...notes].sort((left, right) => {
    if (sort === "latest") {
      return new Date(right.published_at || 0).getTime() - new Date(left.published_at || 0).getTime();
    }
    if (sort === "likes") {
      return (right.liked_count ?? 0) - (left.liked_count ?? 0)
        || (right.comment_count ?? 0) - (left.comment_count ?? 0);
    }
    if (sort === "collects") {
      return (right.collect_count ?? 0) - (left.collect_count ?? 0)
        || (right.comment_count ?? 0) - (left.comment_count ?? 0);
    }
    return (right.comment_count ?? 0) - (left.comment_count ?? 0)
      || (right.liked_count ?? 0) - (left.liked_count ?? 0);
  });
}

function sortSelectedNotes(
  notes: NoteRecord[],
  sort: ExportCommentsOptions["sort"],
): NoteRecord[] {
  return [...notes]
    .sort((left, right) => {
      if (sort === "latest") {
        return new Date(right.published_at || 0).getTime() - new Date(left.published_at || 0).getTime();
      }
      if (sort === "likes") {
        return (right.liked_count ?? 0) - (left.liked_count ?? 0)
          || (right.comment_count ?? 0) - (left.comment_count ?? 0);
      }
      if (sort === "collects") {
        return (right.collect_count ?? 0) - (left.collect_count ?? 0)
          || (right.comment_count ?? 0) - (left.comment_count ?? 0);
      }
      return (right.comment_count ?? 0) - (left.comment_count ?? 0)
        || (right.liked_count ?? 0) - (left.liked_count ?? 0);
    })
    .map((note, index) => ({ ...note, rank: index + 1 }));
}

function normalizeSearchCandidate(item: unknown): SearchPageNote | null {
  if (!item || typeof item !== "object") {
    return null;
  }
  const candidate = item as Record<string, unknown>;
  const noteId = typeof candidate.note_id === "string" ? candidate.note_id.trim() : "";
  if (!noteId) {
    return null;
  }
  const asNullableNumber = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    note_id: noteId,
    xsec_token: typeof candidate.xsec_token === "string" ? candidate.xsec_token : null,
    title: typeof candidate.title === "string" ? candidate.title : null,
    note_url: typeof candidate.note_url === "string" ? candidate.note_url : null,
    note_type: typeof candidate.note_type === "string" ? candidate.note_type : null,
    cover_url: typeof candidate.cover_url === "string" ? candidate.cover_url : null,
    author_name: typeof candidate.author_name === "string" ? candidate.author_name : null,
    author_user_id: typeof candidate.author_user_id === "string" ? candidate.author_user_id : null,
    author_profile_url: typeof candidate.author_profile_url === "string" ? candidate.author_profile_url : null,
    avatar_url: typeof candidate.avatar_url === "string" ? candidate.avatar_url : null,
    liked_count: asNullableNumber(candidate.liked_count),
    comment_count: asNullableNumber(candidate.comment_count),
    collect_count: asNullableNumber(candidate.collect_count),
    share_count: asNullableNumber(candidate.share_count),
    published_at: typeof candidate.published_at === "string" ? candidate.published_at : null,
  };
}

function normalizeCollectedComments(partial?: NoteCommentsPartial): CommentRecord[] {
  const list = Array.isArray(partial?.collected) ? partial.collected : [];
  return list.map((item) => normalizeCommentRecord(item as Record<string, unknown>));
}

function normalizeChunkComments(comments: CommentPageRecord[]): CommentRecord[] {
  return (Array.isArray(comments) ? comments : []).map((comment) => normalizeCommentRecord({
    ...comment,
    image_files: [],
  }));
}

function addUniqueComments(
  collected: CommentRecord[],
  seenCommentIds: Set<string>,
  incoming: CommentRecord[],
): number {
  let addedCount = 0;
  for (const comment of incoming) {
    if (!comment.comment_id || seenCommentIds.has(comment.comment_id)) {
      continue;
    }
    seenCommentIds.add(comment.comment_id);
    collected.push(comment);
    addedCount += 1;
  }
  return addedCount;
}

function normalizeReplyQueue(items: ReplyQueueCursorState[] | undefined): ReplyQueueCursorState[] {
  const queue: ReplyQueueCursorState[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(items) ? items : []) {
    const commentId = String(item?.comment_id || "").trim();
    if (!commentId || seen.has(commentId)) {
      continue;
    }
    seen.add(commentId);
    queue.push({
      comment_id: commentId,
      sub_comment_count: Math.max(0, Number(item?.sub_comment_count) || 0),
      reply_cursor: item?.reply_cursor ? String(item.reply_cursor) : null,
      reply_page_index: Math.max(1, Number(item?.reply_page_index) || 1),
    });
  }
  return queue;
}

function normalizeSessionStateFromPartial(
  noteId: string,
  partial?: NoteCommentsPartial,
): NoteCommentsSessionPartial | null {
  const session = partial?.session_state;
  if (session) {
    return {
      session_id: String(session.session_id || partial?.session_id || `comments:${noteId}`),
      note_id: String(session.note_id || noteId),
      xsec_token: session.xsec_token ? String(session.xsec_token) : null,
      note_url: session.note_url ? String(session.note_url) : null,
      top_cursor: session.top_cursor ? String(session.top_cursor) : null,
      top_page_index: Math.max(1, Number(session.top_page_index) || 1),
      top_done: Boolean(session.top_done),
      reply_queue: normalizeReplyQueue(session.reply_queue),
      request_page_count: Math.max(0, Number(session.request_page_count) || 0),
      top_page_count: Math.max(0, Number(session.top_page_count) || 0),
      reply_page_count: Math.max(0, Number(session.reply_page_count) || 0),
      chunk_count: Math.max(0, Number(session.chunk_count) || 0),
      updated_at: session.updated_at ? String(session.updated_at) : null,
    };
  }

  const legacyRoots = partial?.current_page?.roots
    ?.filter((root) => !root.done)
    .map((root) => ({
      comment_id: String(root.comment_id || "").trim(),
      sub_comment_count: Math.max(0, Number(root.sub_comment_count) || 0),
      reply_cursor: root.reply_cursor ? String(root.reply_cursor) : null,
      reply_page_index: Math.max(1, Number(root.reply_page_index) || 1),
    }))
    .filter((root) => root.comment_id) || [];

  const legacyCursor = partial?.next_cursor ? String(partial.next_cursor) : null;
  const legacyTopPageIndex = Math.max(1, Number(partial?.comments_page_index) || 1);
  if (!legacyCursor && legacyRoots.length === 0 && !partial?.request_page_count && !partial?.reply_page_count) {
    return null;
  }

  return {
    session_id: String(partial?.session_id || `comments:${noteId}`),
    note_id: noteId,
    xsec_token: null,
    note_url: null,
    top_cursor: legacyCursor,
    top_page_index: legacyTopPageIndex,
    top_done: !legacyCursor,
    reply_queue: normalizeReplyQueue(legacyRoots),
    request_page_count: Math.max(0, Number(partial?.request_page_count) || 0),
    top_page_count: Math.max(0, legacyTopPageIndex - 1),
    reply_page_count: Math.max(0, Number(partial?.reply_page_count) || 0),
    chunk_count: 0,
    updated_at: null,
  };
}

function normalizeSessionStateFromChunk(session: CommentsChunkSessionState): NoteCommentsSessionPartial {
  return {
    session_id: session.session_id,
    note_id: session.note_id,
    xsec_token: session.xsec_token,
    note_url: session.note_url,
    top_cursor: session.top_cursor,
    top_page_index: Math.max(1, Number(session.top_page_index) || 1),
    top_done: Boolean(session.top_done),
    reply_queue: normalizeReplyQueue(session.reply_queue),
    request_page_count: Math.max(0, Number(session.request_page_count) || 0),
    top_page_count: Math.max(0, Number(session.top_page_count) || 0),
    reply_page_count: Math.max(0, Number(session.reply_page_count) || 0),
    chunk_count: Math.max(0, Number(session.chunk_count) || 0),
    updated_at: session.updated_at ?? null,
  };
}

function serializeSessionStateForCli(sessionState: NoteCommentsSessionPartial | null): string | undefined {
  if (!sessionState) {
    return undefined;
  }
  const serialized = JSON.stringify(sessionState);
  if (serialized.length > MAX_INLINE_SESSION_STATE_CHARS) {
    return undefined;
  }
  return serialized;
}

function persistNotePartial(
  path: string,
  noteId: string,
  collected: CommentRecord[],
  seenCommentIds: Set<string>,
  sessionState: NoteCommentsSessionPartial | null,
): void {
  const partial: NoteCommentsPartial = {
    note_id: noteId,
    session_id: sessionState?.session_id || `comments:${noteId}`,
    session_state: sessionState,
    next_cursor: sessionState?.top_cursor ?? null,
    comments_page_index: sessionState?.top_page_index ?? 1,
    current_page: null,
    reply_page_count: sessionState?.reply_page_count ?? 0,
    request_page_count: sessionState?.request_page_count ?? 0,
    collected,
    seen_comment_ids: [...seenCommentIds],
  };
  saveCheckpoint(path, partial);
}

function buildSessionId(noteId: string): string {
  return `comments:${noteId}`;
}

function buildNoteFailures(id: string, message: string | undefined): ExportFailure[] {
  return message ? [{ scope: "note", id, message }] : [];
}

interface FinalCommentExportItem {
  note: NoteRecord;
  comments: CommentRecord[];
  markdownPath: string;
  failures: ExportFailure[];
}

function buildCommentsSummary(
  requestedNoteCount: number,
  startedAt: string,
  completedAt: string | null,
  results: FinalCommentExportItem[],
): ExportCommentsSummary {
  const notes: ExportCommentsNoteSummary[] = results.map((item) => ({
    rank: item.note.rank ?? 0,
    noteId: item.note.note_id,
    title: item.note.title,
    displayedCommentCount: item.note.comment_count,
    collectedCommentCount: item.comments.length,
    status: item.failures.length > 0 ? "failed" : "completed",
    failureMessage: item.failures[0]?.message ?? null,
  }));
  const displayedKnownNotes = notes.filter((item) => item.displayedCommentCount !== null);
  const completedAtMs = completedAt ? new Date(completedAt).getTime() : Date.now();
  const startedAtMs = new Date(startedAt).getTime();

  return {
    requestedNoteCount,
    selectedNoteCount: notes.length,
    completedNoteCount: notes.filter((item) => item.status === "completed").length,
    failedNoteCount: notes.filter((item) => item.status === "failed").length,
    displayedCommentCountTotal: displayedKnownNotes.reduce(
      (sum, item) => sum + (item.displayedCommentCount ?? 0),
      0,
    ),
    displayedCommentCountKnownNotes: displayedKnownNotes.length,
    collectedCommentCountTotal: notes.reduce((sum, item) => sum + item.collectedCommentCount, 0),
    elapsedMs: Number.isFinite(completedAtMs) && Number.isFinite(startedAtMs)
      ? Math.max(0, completedAtMs - startedAtMs)
      : 0,
    notes,
  };
}

async function collectAllComments(
  note: NoteRecord,
  layout: ReturnType<typeof createLayout>,
  options: ExportCommentsOptions,
  onProgress?: (progress: NoteCommentProgress) => void,
): Promise<CommentRecord[]> {
  const partialPath = noteCommentsPartialPath(layout, note.note_id);
  const partial = options.resume ? loadPartial<NoteCommentsPartial>(partialPath) : undefined;
  const collected = normalizeCollectedComments(partial);
  const seenCommentIds = new Set<string>([
    ...collected.map((comment) => comment.comment_id).filter(Boolean),
    ...(Array.isArray(partial?.seen_comment_ids) ? partial.seen_comment_ids.map((item) => String(item)) : []),
  ]);

  let sessionState = normalizeSessionStateFromPartial(note.note_id, partial);
  let sessionId = partial?.session_id || sessionState?.session_id || buildSessionId(note.note_id);
  let shouldHydrateSession = Boolean(sessionState);
  let chunkAttempt = 0;

  const topCommentsPageSize = DEFAULT_TOP_COMMENTS_PAGE_SIZE;
  const replyPageSize = DEFAULT_REPLY_PAGE_SIZE;
  const chunkMaxRequests = Math.max(1, options.chunkMaxRequests ?? DEFAULT_CHUNK_MAX_REQUESTS);
  const chunkMaxTopPages = DEFAULT_CHUNK_MAX_TOP_PAGES;
  const chunkMaxReplyPages = DEFAULT_CHUNK_MAX_REPLY_PAGES;
  const chunkPauseMinMs = options.chunkPauseMinMs ?? DEFAULT_CHUNK_PAUSE_MIN_MS;
  const chunkPauseMaxMs = options.chunkPauseMaxMs ?? DEFAULT_CHUNK_PAUSE_MAX_MS;
  const noteContextWarmupMinMs = DEFAULT_NOTE_CONTEXT_WARMUP_MIN_MS;
  const noteContextWarmupMaxMs = DEFAULT_NOTE_CONTEXT_WARMUP_MAX_MS;
  const intraChunkIdleMinMs = DEFAULT_INTRA_CHUNK_IDLE_MIN_MS;
  const intraChunkIdleMaxMs = DEFAULT_INTRA_CHUNK_IDLE_MAX_MS;
  const heavyReplyThreshold = DEFAULT_HEAVY_REPLY_THRESHOLD;

  onProgress?.({
    status: "start",
    collectedCount: collected.length,
    topPageCount: sessionState?.top_page_count ?? 0,
    replyPageCount: sessionState?.reply_page_count ?? 0,
    requestPageCount: sessionState?.request_page_count ?? 0,
    replyQueueSize: sessionState?.reply_queue.length ?? 0,
    chunkCount: sessionState?.chunk_count ?? 0,
  });

  while (true) {
    const inlineSessionState = shouldHydrateSession ? serializeSessionStateForCli(sessionState) : undefined;
    const chunkResult = await commentsChunk(note.note_id, note.xsec_token, {
      ...options,
      sessionId,
      sessionStateJson: inlineSessionState,
      resetSession: !sessionState && chunkAttempt === 0,
      commentContextWarmupMs: chunkAttempt === 0
        ? randomBetween(noteContextWarmupMinMs, noteContextWarmupMaxMs)
        : 0,
      maxRequests: chunkMaxRequests,
      maxTopPages: chunkMaxTopPages,
      maxReplyPages: chunkMaxReplyPages,
      topLimit: topCommentsPageSize,
      replyLimit: replyPageSize,
      intraChunkIdleMinMs,
      intraChunkIdleMaxMs,
      heavyReplyThreshold,
    });

    sessionId = chunkResult.session_id;
    sessionState = normalizeSessionStateFromChunk(chunkResult.session);
    shouldHydrateSession = false;
    chunkAttempt += 1;

    addUniqueComments(collected, seenCommentIds, normalizeChunkComments(chunkResult.comments));
    persistNotePartial(partialPath, note.note_id, collected, seenCommentIds, sessionState);

    onProgress?.({
      status: chunkResult.done ? "done" : "chunk",
      collectedCount: collected.length,
      topPageCount: sessionState.top_page_count ?? 0,
      replyPageCount: sessionState.reply_page_count ?? 0,
      requestPageCount: sessionState.request_page_count ?? 0,
      replyQueueSize: sessionState.reply_queue.length,
      chunkCount: sessionState.chunk_count ?? 0,
      chunkResult,
    });

    if (chunkResult.done) {
      return collected;
    }

    const pauseMs = randomBetween(chunkPauseMinMs, chunkPauseMaxMs);
    onProgress?.({
      status: "wait_chunk",
      collectedCount: collected.length,
      topPageCount: sessionState.top_page_count ?? 0,
      replyPageCount: sessionState.reply_page_count ?? 0,
      requestPageCount: sessionState.request_page_count ?? 0,
      replyQueueSize: sessionState.reply_queue.length,
      chunkCount: sessionState.chunk_count ?? 0,
      waitMs: pauseMs,
    });
    await sleep(pauseMs);
  }
}

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
    const existingCandidates = Array.isArray(checkpoint?.candidate_notes)
      ? checkpoint.candidate_notes.map((item) => normalizeSearchCandidate(item)).filter((item): item is SearchPageNote => Boolean(item))
      : [];
    const candidateNotes = new Map(existingCandidates.map((note) => [note.note_id, note]));
    const seenCandidateIds = new Set<string>([
      ...(checkpoint?.selected_note_ids || []),
      ...existingCandidates.map((note) => note.note_id),
      ...existingNotes.map((note) => note.note_id),
    ]);
    const completedNoteIds = new Set(checkpoint?.completed_note_ids || []);
    const failedNotes = { ...(checkpoint?.failed_notes || {}) };
    let cooldownUntil: string | null = null;
    let cooldownReason: string | null = null;
    let page = checkpoint?.selection_next_page ?? 1;
    let hasMore = true;
    const selectionBufferSize = Math.max(options.topNotes, DEFAULT_SELECTION_BUFFER_SIZE);
    const selectedNotesById = new Map(existingNotes.map((note) => [note.note_id, note]));

    function persistCheckpoint(completed: boolean): void {
      const nextCheckpoint: CommentsCheckpoint = {
        workflow: "comments",
        keyword: options.keyword,
        top_notes: options.topNotes,
        selection_next_page: page,
        selected_note_ids: [...seenCandidateIds],
        candidate_notes: [...candidateNotes.values()],
        completed_note_ids: [...completedNoteIds],
        failed_notes: failedNotes,
        cooldown_until: completed ? null : cooldownUntil,
        cooldown_reason: completed ? null : cooldownReason,
        completed,
      };
      saveCheckpoint(checkpointPath, nextCheckpoint);
    }

    function renderSelectionProgress(label: string, detail?: string): void {
      progress.update({
        label,
        current: Math.min(selectedNotesById.size, options.topNotes),
        total: Math.max(options.topNotes, 1),
        detail: detail ?? `搜索页 ${page}，候选 ${candidateNotes.size}，已选 ${selectedNotesById.size}`,
      });
    }

    function renderCommentProgress(noteOrder: number, noteTotal: number, progressState: NoteCommentProgress): void {
      const base = `第 ${noteOrder}/${noteTotal} 篇笔记`;
      let detail = progressState.status === "wait_note"
        ? `${base}：本篇已采集 ${progressState.collectedCount} 条评论`
        : `${base}：已采集 ${progressState.collectedCount} 条评论，累计抓取主评论 ${progressState.topPageCount} 页、楼中楼回复 ${progressState.replyPageCount} 页`;
      if (progressState.status === "chunk" && progressState.chunkResult) {
        detail += `，刚完成第 ${Math.max(progressState.chunkCount, 1)} 轮分块`;
        detail += `（本轮 ${progressState.chunkResult.stats.request_count} 次请求，新增主评论 ${progressState.chunkResult.stats.top_pages_fetched} 页、回复 ${progressState.chunkResult.stats.reply_pages_fetched} 页）`;
        if (progressState.replyQueueSize > 0) {
          detail += `，还有 ${progressState.replyQueueSize} 个评论楼层待继续展开`;
        }
      } else if (progressState.status === "wait_chunk" && typeof progressState.waitMs === "number") {
        detail += `，等待 ${formatWaitSeconds(progressState.waitMs)} 后继续当前笔记`;
      } else if (progressState.status === "wait_note" && typeof progressState.waitMs === "number") {
        detail += `，本篇已完成，等待 ${formatWaitSeconds(progressState.waitMs)} 后切换到下一篇笔记`;
      } else if (progressState.status === "done") {
        detail += "，本篇已完成";
      } else if (progressState.status === "start") {
        detail += "，准备开始";
      }
      progress.update({
        label: "抓取评论",
        current: Math.min(noteOrder, Math.max(noteTotal, 1)),
        total: Math.max(noteTotal, 1),
        detail,
      });
    }

    async function loadSearchPageCandidates(): Promise<void> {
      renderSelectionProgress("搜索结果页", `正在加载第 ${page} 页`);
      const pageResult = await searchPage(options.keyword, options.sort || "comments", page, 20, options);
      writeJson(rawSearchPagePath(layout, page), pageResult);
      for (const note of pageResult.notes) {
        if (!note.note_id || seenCandidateIds.has(note.note_id)) {
          continue;
        }
        seenCandidateIds.add(note.note_id);
        candidateNotes.set(note.note_id, note);
      }
      hasMore = pageResult.has_more;
      page += 1;
      persistCheckpoint(false);
    }

    if (selectedNotesById.size < options.topNotes) {
      renderSelectionProgress("挑选高评论笔记");

      while (selectedNotesById.size < options.topNotes) {
        while (candidateNotes.size < selectionBufferSize && hasMore) {
          await loadSearchPageCandidates();
        }

        const nextSummary = sortCandidateNotes([...candidateNotes.values()], options.sort).find((summary) => (
          !selectedNotesById.has(summary.note_id) && !failedNotes[summary.note_id]
        ));

        if (!nextSummary) {
          if (!hasMore) {
            break;
          }
          await loadSearchPageCandidates();
          continue;
        }

        renderSelectionProgress("抓取入选详情", `笔记=${nextSummary.note_id}`);
        try {
          const detail = await noteDetail(nextSummary.note_id, nextSummary.xsec_token, options);
          writeJson(rawNotePath(layout, nextSummary.note_id), detail);
          const merged = mergeNote(nextSummary, detail as unknown as Record<string, unknown>);
          const withMedia = await downloadNoteMedia(merged, layout, options);
          selectedNotesById.set(withMedia.note_id, withMedia);
          delete failedNotes[withMedia.note_id];
        } catch (error) {
          failedNotes[nextSummary.note_id] = error instanceof Error ? error.message : String(error);
        }
        persistCheckpoint(false);
      }
    }

    const selectedNotes = sortSelectedNotes([...selectedNotesById.values()], options.sort).slice(0, options.topNotes);
    writeJson(layout.normalizedNotesPath, selectedNotes);

    if (options.resume) {
      for (const note of selectedNotes) {
        const existingComments = readJsonIfExists<CommentRecord[]>(normalizedCommentsPath(layout, note.note_id));
        if (existingComments) {
          completedNoteIds.add(note.note_id);
        }
      }
      persistCheckpoint(false);
    }

    progress.update({
      label: "导出评论",
      current: completedNoteIds.size,
      total: Math.max(selectedNotes.length, 1),
      detail: `已完成 ${completedNoteIds.size}，失败 ${Object.keys(failedNotes).length}`,
    });

    const completedResults: FinalCommentExportItem[] = [];
    const notePauseMinMs = options.notePauseMinMs ?? DEFAULT_NOTE_PAUSE_MIN_MS;
    const notePauseMaxMs = options.notePauseMaxMs ?? DEFAULT_NOTE_PAUSE_MAX_MS;
    const rateLimitCooldownMinMs = DEFAULT_RATE_LIMIT_COOLDOWN_MIN_MS;
    const rateLimitCooldownMaxMs = DEFAULT_RATE_LIMIT_COOLDOWN_MAX_MS;

    for (const note of selectedNotes) {
      const noteOrder = note.rank ?? 0;
      if (completedNoteIds.has(note.note_id)) {
        const existingComments = readJsonIfExists<CommentRecord[]>(normalizedCommentsPath(layout, note.note_id)) || [];
        const markdownPath = commentsMarkdownPath(layout, note.rank ?? 0, note.note_id);
        completedResults.push({
          note,
          comments: existingComments,
          markdownPath,
          failures: [],
        });
        continue;
      }

      try {
        const comments = await collectAllComments(note, layout, options, (progressState) => {
          renderCommentProgress(noteOrder, selectedNotes.length, progressState);
        });
        const commentsWithMedia = await downloadCommentImages(note.note_id, comments, layout, options);
        writeJson(normalizedCommentsPath(layout, note.note_id), commentsWithMedia);
        const markdownPath = commentsMarkdownPath(layout, note.rank ?? 0, note.note_id);
        writeText(markdownPath, renderCommentsMarkdown(note, commentsWithMedia, markdownPath));
        completedNoteIds.add(note.note_id);
        delete failedNotes[note.note_id];
        persistCheckpoint(false);
        completedResults.push({
          note,
          comments: commentsWithMedia,
          markdownPath,
          failures: [],
        });

        if (noteOrder < selectedNotes.length) {
          const pauseMs = randomBetween(notePauseMinMs, notePauseMaxMs);
          renderCommentProgress(noteOrder, selectedNotes.length, {
            status: "wait_note",
            collectedCount: commentsWithMedia.length,
            topPageCount: 0,
            replyPageCount: 0,
            requestPageCount: 0,
            replyQueueSize: 0,
            chunkCount: 0,
            waitMs: pauseMs,
          });
          await sleep(pauseMs);
        }
      } catch (error) {
        if (isCommentRateLimited(error)) {
          cooldownUntil = getCooldownUntilIso(rateLimitCooldownMinMs, rateLimitCooldownMaxMs);
          cooldownReason = getErrorText(error).split(/\r?\n/).find((line) => line.trim()) || "HTTP 429";
          persistCheckpoint(false);
          throw buildRateLimitAbortError(error, cooldownUntil);
        }

        failedNotes[note.note_id] = error instanceof Error ? error.message : String(error);
        persistCheckpoint(false);
      }
    }

    const finalResults = selectedNotes.map((note) => {
      const finished = completedResults.find((item) => item.note.note_id === note.note_id);
      if (finished) {
        return finished;
      }
      const existingComments = readJsonIfExists<CommentRecord[]>(normalizedCommentsPath(layout, note.note_id)) || [];
      const markdownPath = commentsMarkdownPath(layout, note.rank ?? 0, note.note_id);
      return {
        note,
        comments: existingComments,
        markdownPath,
        failures: buildNoteFailures(note.note_id, failedNotes[note.note_id]),
      };
    });

    writeText(
      layout.markdownCommentsIndexPath,
      renderCommentsIndex(
        finalResults.map((item) => ({ note: item.note, commentCount: item.comments.length })),
      ),
    );

    manifest.note_count = selectedNotes.length;
    manifest.comment_count = finalResults.reduce((sum, item) => sum + item.comments.length, 0);
    manifest.failures = [
      ...Object.entries(failedNotes).flatMap(([id, message]) => buildNoteFailures(id, message)),
      ...finalResults.flatMap((item) => item.failures),
    ];
    manifest.completed_at = new Date().toISOString();
    manifest.files.normalized_notes = relative(layout.baseDir, layout.normalizedNotesPath);
    manifest.files.normalized_comments = finalResults.map((item) =>
      relative(layout.baseDir, normalizedCommentsPath(layout, item.note.note_id))
    );
    manifest.files.comments_markdown = finalResults.map((item) => relative(layout.baseDir, item.markdownPath));
    writeJson(layout.manifestPath, manifest);
    const summary = buildCommentsSummary(
      options.topNotes,
      manifest.started_at,
      manifest.completed_at,
      finalResults,
    );

    persistCheckpoint(true);

    return {
      outputDir: layout.baseDir,
      noteCount: selectedNotes.length,
      commentCount: manifest.comment_count,
      manifestPath: layout.manifestPath,
      summary,
    };
  } finally {
    progress.finish();
  }
}
