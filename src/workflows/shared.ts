import { normalizeNoteRecord, type NoteRecord } from "../schema/note.js";
import type { SearchPageNote } from "../bb/xiaohongshu.js";

export async function runWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let index = 0;

  async function runner(): Promise<void> {
    while (index < items.length) {
      const current = index;
      index += 1;
      const item = items[current];
      if (item !== undefined) {
        results[current] = await worker(item);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runner()));
  return results;
}

export function mergeNote(summary: SearchPageNote, detail: Record<string, unknown>): NoteRecord {
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
