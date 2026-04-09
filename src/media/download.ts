// Media download is intentionally not implemented.
// URLs are preserved in NoteRecord/CommentRecord for downstream consumers.
// file fields (cover_file, avatar_file, image_files, video_files) are left as
// empty placeholders so the schema and Markdown output remain stable when
// download is eventually added.

import type { NoteRecord } from "../schema/note.js";
import type { CommentRecord } from "../schema/comment.js";
import type { ExportLayout } from "../fs/layout.js";
import type { BbBrowserOptions } from "../bb/run-site.js";

// Intentional no-op: returns the note unchanged with empty file fields.
export async function downloadNoteMedia(note: NoteRecord, _layout: ExportLayout, _options: BbBrowserOptions): Promise<NoteRecord> {
  return {
    ...note,
    cover_file: null,
    avatar_file: null,
    image_files: [],
    video_files: [],
  };
}

// Intentional no-op: returns comments unchanged with empty image_files arrays.
export async function downloadCommentImages(
  _noteId: string,
  comments: CommentRecord[],
  _layout: ExportLayout,
  _options: BbBrowserOptions,
): Promise<CommentRecord[]> {
  return comments.map((comment) => ({
    ...comment,
    image_files: [],
  }));
}
