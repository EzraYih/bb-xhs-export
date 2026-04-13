import { readJsonIfExists, writeJson } from "./store.js";

export interface NotesCheckpoint {
  workflow: "notes";
  keyword: string;
  top: number;
  next_search_page: number;
  seen_note_ids: string[];
  completed_note_ids: string[];
  failed_notes: Record<string, string>;
  completed: boolean;
}

export interface CommentsCheckpoint {
  workflow: "comments";
  keyword: string;
  top_notes: number;
  selection_next_page: number;
  selected_note_ids: string[];
  completed_note_ids: string[];
  failed_notes: Record<string, string>;
  cooldown_until?: string | null;
  cooldown_reason?: string | null;
  completed: boolean;
}

export interface ReplyQueueCursorState {
  comment_id: string;
  sub_comment_count: number;
  reply_cursor: string | null;
  reply_page_index: number;
  done: boolean;
}

export interface NoteCommentsCurrentPagePartial {
  cursor_in: string | null;
  page_index: number;
  cursor_out: string | null;
  has_more: boolean;
  roots: ReplyQueueCursorState[];
  rotation_index: number;
}

export interface NoteCommentsPartial {
  note_id: string;
  next_cursor: string | null;
  comments_page_index: number;
  current_page?: NoteCommentsCurrentPagePartial | null;
  reply_page_count?: number;
  request_page_count?: number;
  collected: unknown[];   // typed as CommentRecord[] at call site
  seen_comment_ids: string[];
}

type WorkflowCheckpoint = NotesCheckpoint | CommentsCheckpoint;

/**
 * Loads a workflow checkpoint and validates that the stored `workflow` field
 * matches the expected value. If it does not match (e.g. the user reuses
 * --output-dir between a `notes` and a `comments` run), the stale checkpoint
 * is discarded and undefined is returned, so the workflow starts fresh.
 */
export function loadCheckpoint<T extends WorkflowCheckpoint>(
  path: string,
  workflow: T["workflow"],
): T | undefined {
  const data = readJsonIfExists<T>(path);
  if (!data || data.workflow !== workflow) return undefined;
  return data;
}

export function saveCheckpoint(path: string, checkpoint: unknown): void {
  writeJson(path, checkpoint);
}

// Re-export for callers that load non-workflow partials (e.g. NoteCommentsPartial).
export { readJsonIfExists as loadPartial } from "./store.js";
