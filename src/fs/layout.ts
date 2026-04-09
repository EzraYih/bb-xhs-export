import { join, resolve } from "node:path";
import { ensureDir } from "../cache/store.js";

export interface ExportLayout {
  baseDir: string;
  manifestPath: string;
  rawDir: string;
  rawSearchPagesDir: string;
  rawNotesDir: string;
  rawCommentsDir: string;
  rawRepliesDir: string;
  normalizedDir: string;
  normalizedNotesPath: string;
  normalizedCommentsDir: string;
  mediaDir: string;
  coversDir: string;
  avatarsDir: string;
  imagesDir: string;
  videosDir: string;
  commentImagesDir: string;
  markdownDir: string;
  markdownNotesDir: string;
  markdownNotesIndexPath: string;
  markdownCommentsDir: string;
  markdownCommentsIndexPath: string;
  checkpointsDir: string;
}

function safePart(value: string | number | null | undefined): string {
  return String(value ?? "unknown").replace(/[^a-zA-Z0-9._-]+/g, "-");
}

export function createLayout(outputDir: string): ExportLayout {
  const baseDir = resolve(outputDir);
  const layout: ExportLayout = {
    baseDir,
    manifestPath: join(baseDir, "manifest.json"),
    rawDir: join(baseDir, "raw"),
    rawSearchPagesDir: join(baseDir, "raw", "search-pages"),
    rawNotesDir: join(baseDir, "raw", "notes"),
    rawCommentsDir: join(baseDir, "raw", "comments"),
    rawRepliesDir: join(baseDir, "raw", "replies"),
    normalizedDir: join(baseDir, "normalized"),
    normalizedNotesPath: join(baseDir, "normalized", "notes.json"),
    normalizedCommentsDir: join(baseDir, "normalized", "comments"),
    mediaDir: join(baseDir, "media"),
    coversDir: join(baseDir, "media", "covers"),
    avatarsDir: join(baseDir, "media", "avatars"),
    imagesDir: join(baseDir, "media", "images"),
    videosDir: join(baseDir, "media", "videos"),
    commentImagesDir: join(baseDir, "media", "comment-images"),
    markdownDir: join(baseDir, "markdown"),
    markdownNotesDir: join(baseDir, "markdown", "notes"),
    markdownNotesIndexPath: join(baseDir, "markdown", "notes", "index.md"),
    markdownCommentsDir: join(baseDir, "markdown", "comments"),
    markdownCommentsIndexPath: join(baseDir, "markdown", "comments", "index.md"),
    checkpointsDir: join(baseDir, "checkpoints"),
  };

  for (const dir of [
    layout.baseDir,
    layout.rawDir,
    layout.rawSearchPagesDir,
    layout.rawNotesDir,
    layout.rawCommentsDir,
    layout.rawRepliesDir,
    layout.normalizedDir,
    layout.normalizedCommentsDir,
    layout.mediaDir,
    layout.coversDir,
    layout.avatarsDir,
    layout.imagesDir,
    layout.videosDir,
    layout.commentImagesDir,
    layout.markdownDir,
    layout.markdownNotesDir,
    layout.markdownCommentsDir,
    layout.checkpointsDir,
  ]) {
    ensureDir(dir);
  }

  return layout;
}

export function rawSearchPagePath(layout: ExportLayout, page: number): string {
  return join(layout.rawSearchPagesDir, `page-${safePart(page)}.json`);
}

export function rawNotePath(layout: ExportLayout, noteId: string): string {
  return join(layout.rawNotesDir, `${safePart(noteId)}.json`);
}

export function rawCommentsPagePath(layout: ExportLayout, noteId: string, page: number, cursorIn?: string | null): string {
  const cursorPart = cursorIn ? `-${safePart(cursorIn)}` : "";
  return join(layout.rawCommentsDir, `${safePart(noteId)}-page-${safePart(page)}${cursorPart}.json`);
}

export function rawRepliesPagePath(layout: ExportLayout, noteId: string, commentId: string, page: number, cursorIn?: string | null): string {
  const cursorPart = cursorIn ? `-${safePart(cursorIn)}` : "";
  return join(layout.rawRepliesDir, `${safePart(noteId)}-${safePart(commentId)}-page-${safePart(page)}${cursorPart}.json`);
}

export function normalizedCommentsPath(layout: ExportLayout, noteId: string): string {
  return join(layout.normalizedCommentsDir, `${safePart(noteId)}.json`);
}

export function noteMarkdownPath(layout: ExportLayout, rank: number, noteId: string): string {
  return join(layout.markdownNotesDir, `${String(rank).padStart(3, "0")}-${safePart(noteId)}.md`);
}

export function commentsMarkdownPath(layout: ExportLayout, rank: number, noteId: string): string {
  return join(layout.markdownCommentsDir, `${String(rank).padStart(3, "0")}-${safePart(noteId)}.md`);
}

export function notesCheckpointPath(layout: ExportLayout): string {
  return join(layout.checkpointsDir, "notes.json");
}

export function commentsCheckpointPath(layout: ExportLayout): string {
  return join(layout.checkpointsDir, "comments.json");
}
