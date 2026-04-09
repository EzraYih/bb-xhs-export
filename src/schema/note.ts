export interface NoteRecord {
  rank?: number;
  note_id: string;
  xsec_token: string | null;
  title: string | null;
  content_text: string | null;
  note_type: string | null;
  tags: string[];
  note_url: string | null;
  cover_url: string | null;
  cover_file: string | null;
  avatar_url: string | null;
  avatar_file: string | null;
  author_name: string | null;
  author_user_id: string | null;
  author_profile_url: string | null;
  liked_count: number | null;
  comment_count: number | null;
  collect_count: number | null;
  share_count: number | null;
  published_at: string | null;
  last_update_time: string | null;
  ip_location: string | null;
  image_urls: string[];
  image_files: string[];
  video_urls: string[];
  video_files: string[];
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

export function normalizeNoteRecord(input: Record<string, unknown>): NoteRecord {
  return {
    note_id: asString(input.note_id) ?? "",
    xsec_token: asString(input.xsec_token),
    title: asString(input.title),
    content_text: asString(input.content_text),
    note_type: asString(input.note_type),
    tags: asStringArray(input.tags),
    note_url: asString(input.note_url),
    cover_url: asString(input.cover_url),
    cover_file: asString(input.cover_file),
    avatar_url: asString(input.avatar_url),
    avatar_file: asString(input.avatar_file),
    author_name: asString(input.author_name),
    author_user_id: asString(input.author_user_id),
    author_profile_url: asString(input.author_profile_url),
    liked_count: asNumber(input.liked_count),
    comment_count: asNumber(input.comment_count),
    collect_count: asNumber(input.collect_count),
    share_count: asNumber(input.share_count),
    published_at: asString(input.published_at),
    last_update_time: asString(input.last_update_time),
    ip_location: asString(input.ip_location),
    image_urls: asStringArray(input.image_urls),
    image_files: asStringArray(input.image_files),
    video_urls: asStringArray(input.video_urls),
    video_files: asStringArray(input.video_files),
  };
}
