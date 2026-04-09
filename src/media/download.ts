import type { NoteRecord } from "../schema/note.js";
import type { CommentRecord } from "../schema/comment.js";
import type { ExportLayout } from "../fs/layout.js";
import type { BbBrowserOptions } from "../bb/run-site.js";

export async function downloadNoteMedia(note: NoteRecord, _layout: ExportLayout, _options: BbBrowserOptions): Promise<NoteRecord> {
  return {
    ...note,
    cover_file: null,
    avatar_file: null,
    image_files: [],
    video_files: [],
  };
}

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
