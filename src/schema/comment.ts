export interface CommentRecord {
  comment_id: string;
  content_text: string | null;
  image_urls: string[];
  image_files: string[];
  liked_count: number | null;
  comment_time: string | null;
  ip_location: string | null;
  sub_comment_count: number | null;
  note_id: string;
  note_url: string | null;
  user_id: string | null;
  user_url: string | null;
  user_name: string | null;
  parent_comment_id: string | null;
  root_comment_id: string | null;
  root_comment_content: string | null;
  quoted_comment_id: string | null;
  quoted_comment_content: string | null;
}

function asString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function asNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asString(item)).filter((item): item is string => Boolean(item));
}

export function normalizeCommentRecord(input: Record<string, unknown>): CommentRecord {
  return {
    comment_id: asString(input.comment_id) ?? "",
    content_text: asString(input.content_text),
    image_urls: asStringArray(input.image_urls),
    image_files: asStringArray(input.image_files),
    liked_count: asNumber(input.liked_count),
    comment_time: asString(input.comment_time),
    ip_location: asString(input.ip_location),
    sub_comment_count: asNumber(input.sub_comment_count),
    note_id: asString(input.note_id) ?? "",
    note_url: asString(input.note_url),
    user_id: asString(input.user_id),
    user_url: asString(input.user_url),
    user_name: asString(input.user_name),
    parent_comment_id: asString(input.parent_comment_id),
    root_comment_id: asString(input.root_comment_id),
    root_comment_content: asString(input.root_comment_content),
    quoted_comment_id: asString(input.quoted_comment_id),
    quoted_comment_content: asString(input.quoted_comment_content),
  };
}
