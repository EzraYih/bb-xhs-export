import { relative } from "node:path";
import {
  searchPage,
  noteDetail,
  commentsPage,
  commentRepliesPage,
  type SearchPageNote,
} from "../bb/xiaohongshu.js";
import type { BbBrowserOptions } from "../bb/run-site.js";
import { loadCheckpoint, saveCheckpoint, type CommentsCheckpoint } from "../cache/checkpoint.js";
import { readJsonIfExists, writeJson, writeText } from "../cache/store.js";
import {
  commentsCheckpointPath,
  commentsMarkdownPath,
  createLayout,
  normalizedCommentsPath,
  rawCommentsPagePath,
  rawNotePath,
  rawRepliesPagePath,
  rawSearchPagePath,
} from "../fs/layout.js";
import { downloadCommentImages, downloadNoteMedia } from "../media/download.js";
import { renderCommentsIndex, renderCommentsMarkdown } from "../render/comments-markdown.js";
import { createManifest, type ExportFailure } from "../schema/manifest.js";
import { normalizeCommentRecord, type CommentRecord } from "../schema/comment.js";
import { normalizeNoteRecord, type NoteRecord } from "../schema/note.js";
import { TerminalProgress } from "../ui/progress.js";

export interface ExportCommentsOptions extends BbBrowserOptions {
  keyword: string;
  topNotes: number;
  outputDir: string;
  resume: boolean;
}

export interface ExportCommentsResult {
  outputDir: string;
  noteCount: number;
  commentCount: number;
  manifestPath: string;
}

interface CommentCollectionProgress {
  stage: "top-comments" | "replies";
  collectedCount: number;
  commentsPageIndex: number;
  replyPageCount: number;
  currentCommentId: string | null;
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

async function collectAllComments(
  note: NoteRecord,
  layout: ReturnType<typeof createLayout>,
  options: ExportCommentsOptions,
  failures: ExportFailure[],
  onProgress?: (progress: CommentCollectionProgress) => void,
): Promise<CommentRecord[]> {
  const collected: CommentRecord[] = [];
  const seenCommentIds = new Set<string>();
  let cursor: string | null = null;
  let commentsPageIndex = 1;
  let replyPageCount = 0;

  while (true) {
    const pageResult = await commentsPage(note.note_id, note.xsec_token, cursor, 50, options);
    writeJson(rawCommentsPagePath(layout, note.note_id, commentsPageIndex, cursor), pageResult);

    const topComments = pageResult.comments.map((comment) => normalizeCommentRecord({
      ...comment,
      image_files: [],
    }));

    for (const topComment of topComments) {
      if (topComment.comment_id && !seenCommentIds.has(topComment.comment_id)) {
        seenCommentIds.add(topComment.comment_id);
        collected.push(topComment);
      }

      if ((topComment.sub_comment_count ?? 0) <= 0 || !topComment.comment_id) {
        continue;
      }

      let replyCursor: string | null = null;
      let repliesPageIndex = 1;
      while (true) {
        try {
          const replyResult = await commentRepliesPage(
            note.note_id,
            topComment.comment_id,
            note.xsec_token,
            replyCursor,
            100,
            options,
          );
          writeJson(rawRepliesPagePath(layout, note.note_id, topComment.comment_id, repliesPageIndex, replyCursor), replyResult);
          replyPageCount += 1;

          for (const reply of replyResult.comments.map((comment) => normalizeCommentRecord({
            ...comment,
            image_files: [],
          }))) {
            if (reply.comment_id && !seenCommentIds.has(reply.comment_id)) {
              seenCommentIds.add(reply.comment_id);
              collected.push(reply);
            }
          }

          onProgress?.({
            stage: "replies",
            collectedCount: collected.length,
            commentsPageIndex,
            replyPageCount,
            currentCommentId: topComment.comment_id,
          });

          if (!replyResult.has_more || !replyResult.cursor_out || replyResult.cursor_out === replyCursor) {
            break;
          }
          replyCursor = replyResult.cursor_out;
          repliesPageIndex += 1;
        } catch (error) {
          failures.push({
            scope: "reply",
            id: `${note.note_id}:${topComment.comment_id}`,
            message: error instanceof Error ? error.message : String(error),
          });
          break;
        }
      }
    }

    onProgress?.({
      stage: "top-comments",
      collectedCount: collected.length,
      commentsPageIndex,
      replyPageCount,
      currentCommentId: null,
    });

    if (!pageResult.has_more || !pageResult.cursor_out || pageResult.cursor_out === cursor) {
      break;
    }
    cursor = pageResult.cursor_out;
    commentsPageIndex += 1;
  }

  return collected;
}

export async function exportCommentsWorkflow(options: ExportCommentsOptions): Promise<ExportCommentsResult> {
  const progress = new TerminalProgress();
  const layout = createLayout(options.outputDir);
  const checkpointPath = commentsCheckpointPath(layout);
  const checkpoint = options.resume ? loadCheckpoint<CommentsCheckpoint>(checkpointPath) : undefined;
  const manifest = createManifest("comments", options.keyword, options.topNotes);
  const existingNotes = options.resume ? readJsonIfExists<NoteRecord[]>(layout.normalizedNotesPath) || [] : [];
  const notesById = new Map(existingNotes.map((note) => [note.note_id, note]));
  const selectedNoteIds = new Set(checkpoint?.selected_note_ids || existingNotes.map((note) => note.note_id));
  const completedNoteIds = new Set(checkpoint?.completed_note_ids || []);
  const failedNotes = { ...(checkpoint?.failed_notes || {}) };
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
      renderSelectionProgress("搜索结果页", `正在加载第 ${page} 页`);
      const pageResult = await searchPage(options.keyword, "comments", page, 20, options);
      writeJson(rawSearchPagePath(layout, page), pageResult);
      const candidates = pageResult.notes.filter((note) => {
        if (!note.note_id) return false;
        if (selectedNoteIds.has(note.note_id)) return false;
        selectedNoteIds.add(note.note_id);
        return true;
      });
      renderSelectionProgress("挑选高评论笔记", `搜索页=${page} 候选=${candidates.length} 失败=${Object.keys(failedNotes).length}`);
      await runWithConcurrency(candidates, 1, processSummary);
      hasMore = pageResult.has_more;
      page += 1;
      persistCheckpoint(false);
    }

    const selectedNotes = [...notesById.values()]
      .sort((left, right) => (right.comment_count ?? 0) - (left.comment_count ?? 0) || (right.liked_count ?? 0) - (left.liked_count ?? 0))
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
        progress.update({
          label: "抓取评论",
          current: completedNoteIds.size,
          total: Math.max(selectedNotes.length, 1),
          detail: `笔记=${noteOrder}/${selectedNotes.length} ID=${note.note_id} 开始`,
        });
        const comments = await collectAllComments(note, layout, options, failures, (state) => {
          const stageDetail = state.stage === "replies"
            ? `笔记=${noteOrder}/${selectedNotes.length} ID=${note.note_id} 已收集评论=${state.collectedCount} 一级页数=${state.commentsPageIndex} 回复页数=${state.replyPageCount} 当前一级评论=${state.currentCommentId || ""}`
            : `笔记=${noteOrder}/${selectedNotes.length} ID=${note.note_id} 已收集评论=${state.collectedCount} 一级页数=${state.commentsPageIndex} 回复页数=${state.replyPageCount}`;
          progress.update({
            label: "抓取评论",
            current: completedNoteIds.size,
            total: Math.max(selectedNotes.length, 1),
            detail: stageDetail,
          });
        });
        const commentsWithMedia = await downloadCommentImages(note.note_id, comments, layout, options);
        writeJson(normalizedCommentsPath(layout, note.note_id), commentsWithMedia);
        const markdownPath = commentsMarkdownPath(layout, note.rank ?? 0, note.note_id);
        writeText(markdownPath, renderCommentsMarkdown(note, commentsWithMedia, markdownPath));
        completedNoteIds.add(note.note_id);
        persistCheckpoint(false);
        progress.update({
          label: "抓取评论",
          current: completedNoteIds.size,
          total: Math.max(selectedNotes.length, 1),
          detail: `笔记=${noteOrder}/${selectedNotes.length} ID=${note.note_id} 完成 评论=${commentsWithMedia.length}`,
        });
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
      renderCommentsIndex(completedResults.map((item) => ({ note: item.note, commentCount: item.comments.length }))),
    );

    manifest.note_count = selectedNotes.length;
    manifest.comment_count = completedResults.reduce((sum, item) => sum + item.comments.length, 0);
    manifest.failures = [
      ...Object.entries(failedNotes).map(([id, message]) => ({ scope: "note", id, message })),
      ...completedResults.flatMap((item) => item.failures),
    ];
    manifest.completed_at = new Date().toISOString();
    manifest.files.normalized_notes = relative(layout.baseDir, layout.normalizedNotesPath);
    manifest.files.normalized_comments = completedResults.map((item) => relative(layout.baseDir, normalizedCommentsPath(layout, item.note.note_id)));
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
