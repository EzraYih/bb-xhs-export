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
  completed: boolean;
}

export function loadCheckpoint<T>(path: string): T | undefined {
  return readJsonIfExists<T>(path);
}

export function saveCheckpoint(path: string, checkpoint: unknown): void {
  writeJson(path, checkpoint);
}
