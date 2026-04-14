import { relative } from "node:path";
import {
  searchPage,
  notesChunk,
  type SearchPageNote,
  type NoteDetailResult,
  type NotesChunkFailure,
} from "../bb/xiaohongshu.js";
import { mergeNote } from "./shared.js";
import type { BbBrowserOptions } from "../bb/run-site.js";
import { loadCheckpoint, saveCheckpoint, type NotesCheckpoint } from "../cache/checkpoint.js";
import { readJsonIfExists, writeJson, writeText } from "../cache/store.js";
import {
  createLayout,
  noteMarkdownPath,
  notesCheckpointPath,
  rawNotePath,
  rawSearchPagePath,
} from "../fs/layout.js";
import { downloadNoteMedia } from "../media/download.js";
import { renderNoteMarkdown, renderNotesIndex } from "../render/notes-markdown.js";
import { createManifest } from "../schema/manifest.js";
import type { NoteRecord } from "../schema/note.js";
import { TerminalProgress } from "../ui/progress.js";

export interface ExportNotesOptions extends BbBrowserOptions {
  keyword: string;
  top: number;
  outputDir: string;
  resume: boolean;
  sort?: "likes" | "comments" | "latest" | "general" | "collects";
  noteDetailDelayMinMs?: number;
  noteDetailDelayMaxMs?: number;
  notesChunkSize?: number;
  notesChunkPauseMinMs?: number;
  notesChunkPauseMaxMs?: number;
  selectionBufferSize?: number;
}

export interface ExportNotesResult {
  outputDir: string;
  noteCount: number;
  manifestPath: string;
  summary: ExportNotesSummary;
}

export interface ExportNotesNoteSummary {
  rank: number;
  noteId: string;
  title: string | null;
  likedCount: number | null;
  commentCount: number | null;
  collectCount: number | null;
  status: "completed" | "failed";
  failureMessage: string | null;
}

export interface ExportNotesSummary {
  requestedNoteCount: number;
  attemptedNoteCount: number;
  completedNoteCount: number;
  failedNoteCount: number;
  likedCountTotal: number;
  commentCountTotal: number;
  collectCountTotal: number;
  elapsedMs: number;
  notes: ExportNotesNoteSummary[];
}

export const NOTES_EXPORT_DEFAULTS = {
  noteDetailDelayMinMs: 1000,
  noteDetailDelayMaxMs: 5000,
  notesChunkSize: 2,
  notesChunkPauseMinMs: 8000,
  notesChunkPauseMaxMs: 15000,
  selectionBufferSize: 20,
} as const;

const DEFAULT_NOTE_DETAIL_DELAY_MIN_MS = NOTES_EXPORT_DEFAULTS.noteDetailDelayMinMs;
const DEFAULT_NOTE_DETAIL_DELAY_MAX_MS = NOTES_EXPORT_DEFAULTS.noteDetailDelayMaxMs;
const DEFAULT_NOTES_CHUNK_SIZE = NOTES_EXPORT_DEFAULTS.notesChunkSize;
const DEFAULT_NOTES_CHUNK_PAUSE_MIN_MS = NOTES_EXPORT_DEFAULTS.notesChunkPauseMinMs;
const DEFAULT_NOTES_CHUNK_PAUSE_MAX_MS = NOTES_EXPORT_DEFAULTS.notesChunkPauseMaxMs;
const DEFAULT_SELECTION_BUFFER_SIZE = NOTES_EXPORT_DEFAULTS.selectionBufferSize;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min: number, max: number): number {
  const lower = Math.max(0, Math.floor(Math.min(min, max)));
  const upper = Math.max(lower, Math.floor(Math.max(min, max)));
  return lower + Math.floor(Math.random() * (upper - lower + 1));
}

function formatWaitSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)} 秒`;
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

function isNoteRateLimited(error: unknown): boolean {
  return /HTTP 429|rate.?limit|too many requests|security.?restriction|visit.?too.?frequently|300013|安全限制|访问过于频繁|请稍后再试/i.test(
    getErrorText(error),
  );
}

function sortCandidateNotes(
  notes: SearchPageNote[],
  sort: ExportNotesOptions["sort"],
): SearchPageNote[] {
  return [...notes].sort((left, right) => {
    if (sort === "latest") {
      return new Date(right.published_at || 0).getTime() - new Date(left.published_at || 0).getTime();
    }
    if (sort === "comments") {
      return (right.comment_count ?? 0) - (left.comment_count ?? 0)
        || (right.liked_count ?? 0) - (left.liked_count ?? 0);
    }
    if (sort === "collects") {
      return (right.collect_count ?? 0) - (left.collect_count ?? 0)
        || (right.liked_count ?? 0) - (left.liked_count ?? 0);
    }
    if (sort === "general") {
      return (right.liked_count ?? 0) - (left.liked_count ?? 0)
        || (right.comment_count ?? 0) - (left.comment_count ?? 0);
    }
    return (right.liked_count ?? 0) - (left.liked_count ?? 0)
      || (right.comment_count ?? 0) - (left.comment_count ?? 0);
  });
}

function sortSelectedNotes(
  notes: NoteRecord[],
  sort: ExportNotesOptions["sort"],
): NoteRecord[] {
  return [...notes]
    .sort((left, right) => {
      if (sort === "latest") {
        return new Date(right.published_at || 0).getTime() - new Date(left.published_at || 0).getTime();
      }
      if (sort === "comments") {
        return (right.comment_count ?? 0) - (left.comment_count ?? 0)
          || (right.liked_count ?? 0) - (left.liked_count ?? 0);
      }
      if (sort === "collects") {
        return (right.collect_count ?? 0) - (left.collect_count ?? 0)
          || (right.liked_count ?? 0) - (left.liked_count ?? 0);
      }
      if (sort === "general") {
        return (right.liked_count ?? 0) - (left.liked_count ?? 0)
          || (right.comment_count ?? 0) - (left.comment_count ?? 0);
      }
      return (right.liked_count ?? 0) - (left.liked_count ?? 0)
        || (right.comment_count ?? 0) - (left.comment_count ?? 0);
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

function buildSummaryFromDetail(detail: NoteDetailResult): SearchPageNote {
  return {
    note_id: detail.note_id,
    xsec_token: detail.xsec_token,
    title: detail.title,
    note_url: detail.note_url,
    note_type: detail.note_type,
    cover_url: detail.cover_url,
    author_name: detail.author_name,
    author_user_id: detail.author_user_id,
    author_profile_url: detail.author_profile_url,
    avatar_url: detail.avatar_url,
    liked_count: detail.liked_count,
    comment_count: detail.comment_count,
    collect_count: detail.collect_count,
    share_count: detail.share_count,
    published_at: detail.published_at,
  };
}

function buildSummaryFromNoteRecord(note: NoteRecord): SearchPageNote {
  return {
    note_id: note.note_id,
    xsec_token: note.xsec_token,
    title: note.title,
    note_url: note.note_url,
    note_type: note.note_type,
    cover_url: note.cover_url,
    author_name: note.author_name,
    author_user_id: note.author_user_id,
    author_profile_url: note.author_profile_url,
    avatar_url: note.avatar_url,
    liked_count: note.liked_count,
    comment_count: note.comment_count,
    collect_count: note.collect_count,
    share_count: note.share_count,
    published_at: note.published_at,
  };
}

function buildChunkFailureMessage(failure: NotesChunkFailure): string {
  const parts = [failure.error, failure.hint].filter((value): value is string => Boolean(value && value.trim()));
  return parts.join("；") || "Unknown error";
}

export async function exportNotesWorkflow(options: ExportNotesOptions): Promise<ExportNotesResult> {
  const startedAt = Date.now();
  const progress = new TerminalProgress();
  const layout = createLayout(options.outputDir);
  const checkpointPath = notesCheckpointPath(layout);
  const checkpoint = options.resume ? loadCheckpoint<NotesCheckpoint>(checkpointPath, "notes") : undefined;
  const manifest = createManifest("notes", options.keyword, options.top);
  const existingNotes = options.resume ? readJsonIfExists<NoteRecord[]>(layout.normalizedNotesPath) || [] : [];
  const existingCandidates = Array.isArray(checkpoint?.candidate_notes)
    ? checkpoint.candidate_notes.map(normalizeSearchCandidate).filter((note): note is SearchPageNote => Boolean(note))
    : [];
  const notesById = new Map(existingNotes.map((note) => [note.note_id, note]));
  const candidateNotes = new Map(existingCandidates.map((note) => [note.note_id, note]));
  const knownNoteSummaries = new Map<string, SearchPageNote>([
    ...existingNotes.map((note) => [note.note_id, buildSummaryFromNoteRecord(note)] as const),
    ...existingCandidates.map((note) => [note.note_id, note] as const),
  ]);
  const seenNoteIds = new Set([
    ...(checkpoint?.seen_note_ids || []),
    ...existingCandidates.map((note) => note.note_id),
    ...existingNotes.map((note) => note.note_id),
  ]);
  const completedNoteIds = new Set(checkpoint?.completed_note_ids || existingNotes.map((note) => note.note_id));
  const failedNotes = { ...(checkpoint?.failed_notes || {}) };
  let page = checkpoint?.selection_next_page ?? checkpoint?.next_search_page ?? 1;
  let hasMore = typeof checkpoint?.selection_has_more === "boolean" ? checkpoint.selection_has_more : true;
  const noteDetailDelayMinMs = options.noteDetailDelayMinMs ?? DEFAULT_NOTE_DETAIL_DELAY_MIN_MS;
  const noteDetailDelayMaxMs = options.noteDetailDelayMaxMs ?? DEFAULT_NOTE_DETAIL_DELAY_MAX_MS;
  const notesChunkSize = Math.max(1, options.notesChunkSize ?? DEFAULT_NOTES_CHUNK_SIZE);
  const notesChunkPauseMinMs = options.notesChunkPauseMinMs ?? DEFAULT_NOTES_CHUNK_PAUSE_MIN_MS;
  const notesChunkPauseMaxMs = options.notesChunkPauseMaxMs ?? DEFAULT_NOTES_CHUNK_PAUSE_MAX_MS;
  const selectionBufferSize = Math.max(options.top, options.selectionBufferSize ?? DEFAULT_SELECTION_BUFFER_SIZE);

  function renderSelectionProgress(label: string, detail?: string): void {
    progress.update({
      label,
      current: Math.min(notesById.size, options.top),
      total: Math.max(options.top, 1),
      detail: detail ?? `搜索页 ${page}，候选 ${candidateNotes.size}，已完成 ${notesById.size}，失败=${Object.keys(failedNotes).length}`,
    });
  }

  function persistProgress(completed: boolean): void {
    const sortedNotes = sortSelectedNotes([...notesById.values()], options.sort).slice(0, options.top);
    writeJson(layout.normalizedNotesPath, sortedNotes);
    const nextCheckpoint: NotesCheckpoint = {
      workflow: "notes",
      keyword: options.keyword,
      top: options.top,
      next_search_page: page,
      selection_next_page: page,
      selection_has_more: hasMore,
      candidate_notes: completed ? [] : [...candidateNotes.values()],
      seen_note_ids: [...seenNoteIds],
      completed_note_ids: [...completedNoteIds],
      failed_notes: failedNotes,
      completed,
    };
    saveCheckpoint(checkpointPath, nextCheckpoint);
  }

  async function loadSearchPageCandidates(): Promise<void> {
    renderSelectionProgress("搜索结果页", `正在加载第 ${page} 页`);
    const pageResult = await searchPage(options.keyword, options.sort || "likes", page, 20, options);
    writeJson(rawSearchPagePath(layout, page), pageResult);
    for (const note of pageResult.notes) {
      if (!note.note_id || seenNoteIds.has(note.note_id)) {
        continue;
      }
      seenNoteIds.add(note.note_id);
      candidateNotes.set(note.note_id, note);
      knownNoteSummaries.set(note.note_id, note);
    }
    hasMore = pageResult.has_more;
    page += 1;
    persistProgress(false);
  }

  function getPendingChunkCandidates(): SearchPageNote[] {
    return sortCandidateNotes([...candidateNotes.values()], options.sort)
      .filter((summary) => !notesById.has(summary.note_id) && !completedNoteIds.has(summary.note_id) && !failedNotes[summary.note_id])
      .slice(0, notesChunkSize);
  }

  async function integrateChunkResult(
    summaries: SearchPageNote[],
    details: NoteDetailResult[],
    failures: NotesChunkFailure[],
  ): Promise<boolean> {
    const summaryById = new Map(summaries.map((summary) => [summary.note_id, summary]));
    let rateLimited = false;

    for (const detail of details) {
      const noteId = String(detail.note_id || "").trim();
      if (!noteId) {
        continue;
      }
      try {
        renderSelectionProgress("抓取入选详情", `正在整理笔记 ${noteId}`);
        writeJson(rawNotePath(layout, noteId), detail);
        const summary = summaryById.get(noteId) || candidateNotes.get(noteId) || buildSummaryFromDetail(detail);
        knownNoteSummaries.set(noteId, summary);
        const merged = mergeNote(summary, detail as unknown as Record<string, unknown>);
        const withMedia = await downloadNoteMedia(merged, layout, options);
        notesById.set(withMedia.note_id, withMedia);
        knownNoteSummaries.set(withMedia.note_id, buildSummaryFromNoteRecord(withMedia));
        completedNoteIds.add(withMedia.note_id);
        delete failedNotes[withMedia.note_id];
        candidateNotes.delete(withMedia.note_id);
        persistProgress(false);
      } catch (error) {
        const message = getErrorText(error);
        failedNotes[noteId] = message;
        candidateNotes.delete(noteId);
        persistProgress(false);
      }
    }

    for (const failure of failures) {
      const message = buildChunkFailureMessage(failure);
      if (isNoteRateLimited(message)) {
        rateLimited = true;
        continue;
      }
      const noteId = typeof failure.note_id === "string" ? failure.note_id.trim() : "";
      if (!noteId) {
        continue;
      }
      const fallbackSummary = summaryById.get(noteId) || candidateNotes.get(noteId);
      if (fallbackSummary) {
        knownNoteSummaries.set(noteId, fallbackSummary);
      }
      failedNotes[noteId] = message;
      candidateNotes.delete(noteId);
    }

    persistProgress(false);
    return rateLimited;
  }

  try {
    renderSelectionProgress("收集笔记");

    while (notesById.size < options.top) {
      while (candidateNotes.size < selectionBufferSize && hasMore) {
        await loadSearchPageCandidates();
      }

      const pendingChunk = getPendingChunkCandidates();
      if (pendingChunk.length === 0) {
        if (!hasMore) {
          break;
        }
        await loadSearchPageCandidates();
        continue;
      }

      renderSelectionProgress(
        "抓取入选详情",
        `本轮分块 ${pendingChunk.length} 篇，候选池 ${candidateNotes.size}，已完成 ${notesById.size}`,
      );
      const chunkResult = await notesChunk(
        pendingChunk.map((summary) => ({
          note_id: summary.note_id,
          xsec_token: summary.xsec_token,
          title: summary.title,
          note_url: summary.note_url,
        })),
        {
          ...options,
          maxItems: notesChunkSize,
          idleMinMs: noteDetailDelayMinMs,
          idleMaxMs: noteDetailDelayMaxMs,
        },
      );

      const rateLimited = await integrateChunkResult(pendingChunk, chunkResult.notes, chunkResult.failures);
      if (rateLimited || chunkResult.stats.rate_limited || chunkResult.stats.stop_reason === "security_restriction") {
        persistProgress(false);
        throw new Error("笔记详情采集触发小红书安全限制，请稍后使用 --resume 继续");
      }

      if (notesById.size >= options.top) {
        break;
      }

      const hasPendingWork = hasMore || getPendingChunkCandidates().length > 0;
      if (hasPendingWork && notesChunkPauseMaxMs > 0) {
        const waitMs = randomBetween(notesChunkPauseMinMs, notesChunkPauseMaxMs);
        if (waitMs > 0) {
          progress.update({
            label: "等待下一轮详情分块",
            current: Math.min(notesById.size, options.top),
            total: Math.max(options.top, 1),
            detail: `已完成 ${notesById.size}/${options.top}，等待 ${formatWaitSeconds(waitMs)} 后继续`,
          });
          await sleep(waitMs);
        }
      }
    }

    const notes = sortSelectedNotes([...notesById.values()], options.sort).slice(0, options.top);
    writeJson(layout.normalizedNotesPath, notes);
    const markdownPaths: string[] = [];
    let written = 0;
    for (const note of notes) {
      const path = noteMarkdownPath(layout, note.rank ?? 0, note.note_id);
      markdownPaths.push(path);
      writeText(path, renderNoteMarkdown(note, path));
      written += 1;
      progress.update({
        label: "写入 Markdown",
        current: written,
        total: Math.max(notes.length, 1),
        detail: `笔记=${note.note_id}`,
      });
    }
    writeText(layout.markdownNotesIndexPath, renderNotesIndex(notes));

    manifest.note_count = notes.length;
    manifest.failures = Object.entries(failedNotes).map(([id, message]) => ({ scope: "note", id, message }));
    manifest.completed_at = new Date().toISOString();
    manifest.files.normalized_notes = relative(layout.baseDir, layout.normalizedNotesPath);
    manifest.files.notes_markdown = markdownPaths.map((path) => relative(layout.baseDir, path));
    writeJson(layout.manifestPath, manifest);

    const failedNoteIds = Object.keys(failedNotes).filter((noteId) => !notesById.has(noteId));
    const failedNoteSummaries = sortCandidateNotes(
      failedNoteIds
        .map((noteId) => knownNoteSummaries.get(noteId))
        .filter((note): note is SearchPageNote => Boolean(note)),
      options.sort,
    ).filter((summary) => !notesById.has(summary.note_id));
    const failedNoteRows = [
      ...failedNoteSummaries.map((note, index) => ({
        rank: notes.length + index + 1,
        noteId: note.note_id,
        title: note.title,
        likedCount: note.liked_count,
        commentCount: note.comment_count,
        collectCount: note.collect_count,
        status: "failed" as const,
        failureMessage: failedNotes[note.note_id] || null,
      })),
      ...failedNoteIds
        .filter((noteId) => !failedNoteSummaries.some((note) => note.note_id === noteId))
        .map((noteId, index) => ({
          rank: notes.length + failedNoteSummaries.length + index + 1,
          noteId,
          title: null,
          likedCount: null,
          commentCount: null,
          collectCount: null,
          status: "failed" as const,
          failureMessage: failedNotes[noteId] || null,
        })),
    ];
    const summary: ExportNotesSummary = {
      requestedNoteCount: options.top,
      attemptedNoteCount: notes.length + failedNoteRows.length,
      completedNoteCount: notes.length,
      failedNoteCount: failedNoteRows.length,
      likedCountTotal: notes.reduce((sum, note) => sum + (note.liked_count ?? 0), 0),
      commentCountTotal: notes.reduce((sum, note) => sum + (note.comment_count ?? 0), 0),
      collectCountTotal: notes.reduce((sum, note) => sum + (note.collect_count ?? 0), 0),
      elapsedMs: Date.now() - startedAt,
      notes: [
        ...notes.map((note) => ({
          rank: note.rank ?? 0,
          noteId: note.note_id,
          title: note.title,
          likedCount: note.liked_count,
          commentCount: note.comment_count,
          collectCount: note.collect_count,
          status: "completed" as const,
          failureMessage: null,
        })),
        ...failedNoteRows,
      ],
    };

    const doneCheckpoint: NotesCheckpoint = {
      workflow: "notes",
      keyword: options.keyword,
      top: options.top,
      next_search_page: page,
      selection_next_page: page,
      selection_has_more: hasMore,
      candidate_notes: [],
      seen_note_ids: [...seenNoteIds],
      completed_note_ids: [...completedNoteIds],
      failed_notes: failedNotes,
      completed: true,
    };
    saveCheckpoint(checkpointPath, doneCheckpoint);

    return {
      outputDir: layout.baseDir,
      noteCount: notes.length,
      manifestPath: layout.manifestPath,
      summary,
    };
  } finally {
    progress.finish();
  }
}
