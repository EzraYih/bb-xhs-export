import { relative } from "node:path";
import { searchPage, noteDetail, type SearchPageNote } from "../bb/xiaohongshu.js";
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
import { normalizeNoteRecord, type NoteRecord } from "../schema/note.js";
import { TerminalProgress } from "../ui/progress.js";

export interface ExportNotesOptions extends BbBrowserOptions {
  keyword: string;
  top: number;
  outputDir: string;
  resume: boolean;
}

export interface ExportNotesResult {
  outputDir: string;
  noteCount: number;
  manifestPath: string;
}

async function runWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let index = 0;

  async function runner(): Promise<void> {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runner()));
  return results;
}

function mergeNote(summary: SearchPageNote, detail: Record<string, unknown>): NoteRecord {
  return normalizeNoteRecord({
    ...summary,
    ...detail,
    cover_url: detail.cover_url ?? summary.cover_url,
    avatar_url: detail.avatar_url ?? summary.avatar_url,
    author_name: detail.author_name ?? summary.author_name,
    author_user_id: detail.author_user_id ?? summary.author_user_id,
    author_profile_url: detail.author_profile_url ?? summary.author_profile_url,
    liked_count: detail.liked_count ?? summary.liked_count,
    comment_count: detail.comment_count ?? summary.comment_count,
    collect_count: detail.collect_count ?? summary.collect_count,
    share_count: detail.share_count ?? summary.share_count,
    published_at: detail.published_at ?? summary.published_at,
    image_files: [],
    video_files: [],
    cover_file: null,
    avatar_file: null,
  });
}

export async function exportNotesWorkflow(options: ExportNotesOptions): Promise<ExportNotesResult> {
  const progress = new TerminalProgress();
  const layout = createLayout(options.outputDir);
  const checkpointPath = notesCheckpointPath(layout);
  const checkpoint = options.resume ? loadCheckpoint<NotesCheckpoint>(checkpointPath) : undefined;
  const manifest = createManifest("notes", options.keyword, options.top);
  const existingNotes = options.resume ? readJsonIfExists<NoteRecord[]>(layout.normalizedNotesPath) || [] : [];
  const notesById = new Map(existingNotes.map((note) => [note.note_id, note]));
  const seenNoteIds = new Set(checkpoint?.seen_note_ids || existingNotes.map((note) => note.note_id));
  const completedNoteIds = new Set(checkpoint?.completed_note_ids || existingNotes.map((note) => note.note_id));
  const failedNotes = { ...(checkpoint?.failed_notes || {}) };
  let page = checkpoint?.next_search_page ?? 1;
  let hasMore = true;

  function renderSelectionProgress(label: string, detail?: string): void {
    progress.update({
      label,
      current: Math.min(notesById.size, options.top),
      total: Math.max(options.top, 1),
      detail: detail ?? `搜索页=${page} 已收集=${notesById.size} 失败=${Object.keys(failedNotes).length}`,
    });
  }

  async function processSummary(summary: SearchPageNote): Promise<void> {
    if (notesById.size >= options.top) return;
    if (notesById.has(summary.note_id) || completedNoteIds.has(summary.note_id)) return;
    renderSelectionProgress("抓取笔记详情", `搜索页=${page} 笔记=${summary.note_id}`);
    try {
      const detail = await noteDetail(summary.note_id, summary.xsec_token, options);
      writeJson(rawNotePath(layout, summary.note_id), detail);
      const merged = mergeNote(summary, detail as unknown as Record<string, unknown>);
      const withMedia = await downloadNoteMedia(merged, layout, options);
      notesById.set(withMedia.note_id, withMedia);
      completedNoteIds.add(withMedia.note_id);
      delete failedNotes[withMedia.note_id];
    } catch (error) {
      failedNotes[summary.note_id] = error instanceof Error ? error.message : String(error);
    }
    renderSelectionProgress("收集笔记");
  }

  try {
    renderSelectionProgress("收集笔记");

    while (notesById.size < options.top && hasMore) {
      renderSelectionProgress("搜索结果页", `正在加载第 ${page} 页`);
      const pageResult = await searchPage(options.keyword, "likes", page, 20, options);
      writeJson(rawSearchPagePath(layout, page), pageResult);
      const candidates = pageResult.notes.filter((note) => {
        if (!note.note_id) return false;
        if (seenNoteIds.has(note.note_id)) return false;
        seenNoteIds.add(note.note_id);
        return true;
      });

      renderSelectionProgress("收集笔记", `搜索页=${page} 候选=${candidates.length} 失败=${Object.keys(failedNotes).length}`);
      await runWithConcurrency(candidates, 1, processSummary);
      hasMore = pageResult.has_more;
      page += 1;
      const nextCheckpoint: NotesCheckpoint = {
        workflow: "notes",
        keyword: options.keyword,
        top: options.top,
        next_search_page: page,
        seen_note_ids: [...seenNoteIds],
        completed_note_ids: [...completedNoteIds],
        failed_notes: failedNotes,
        completed: false,
      };
      saveCheckpoint(checkpointPath, nextCheckpoint);
    }

    const notes = [...notesById.values()]
      .sort((left, right) => (right.liked_count ?? 0) - (left.liked_count ?? 0) || (right.comment_count ?? 0) - (left.comment_count ?? 0))
      .slice(0, options.top)
      .map((note, index) => ({ ...note, rank: index + 1 }));

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

    const doneCheckpoint: NotesCheckpoint = {
      workflow: "notes",
      keyword: options.keyword,
      top: options.top,
      next_search_page: page,
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
    };
  } finally {
    progress.finish();
  }
}
