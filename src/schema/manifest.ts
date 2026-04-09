export interface ExportFailure {
  scope: string;
  id: string;
  message: string;
}

export interface ExportManifest {
  workflow: "notes" | "comments";
  keyword: string;
  requested_count: number;
  started_at: string;
  completed_at: string | null;
  note_count: number;
  comment_count: number;
  failures: ExportFailure[];
  files: {
    notes_markdown: string[];
    comments_markdown: string[];
    normalized_notes?: string | null;
    normalized_comments?: string[];
  };
}

export function createManifest(workflow: "notes" | "comments", keyword: string, requestedCount: number): ExportManifest {
  return {
    workflow,
    keyword,
    requested_count: requestedCount,
    started_at: new Date().toISOString(),
    completed_at: null,
    note_count: 0,
    comment_count: 0,
    failures: [],
    files: {
      notes_markdown: [],
      comments_markdown: [],
      normalized_notes: null,
      normalized_comments: [],
    },
  };
}
