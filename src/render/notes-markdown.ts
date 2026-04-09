import { relative } from "node:path";
import type { NoteRecord } from "../schema/note.js";

function toPosix(path: string | null): string | null {
  return path ? path.replace(/\\/g, "/") : null;
}

function yamlScalar(value: string | number | null): string {
  if (value == null) return "null";
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

function yamlArray(key: string, items: string[]): string {
  if (items.length === 0) return `${key}: []`;
  return `${key}:\n${items.map((item) => `  - ${JSON.stringify(item)}`).join("\n")}`;
}

export function renderNoteMarkdown(note: NoteRecord, markdownPath: string): string {
  const relativeCover = note.cover_file ? toPosix(relative(markdownPath, note.cover_file)) : null;
  const relativeAvatar = note.avatar_file ? toPosix(relative(markdownPath, note.avatar_file)) : null;
  const relativeImages = note.image_files.map((file) => toPosix(relative(markdownPath, file)) || "");
  const relativeVideos = note.video_files.map((file) => toPosix(relative(markdownPath, file)) || "");

  const frontmatter = [
    "---",
    `rank: ${yamlScalar(note.rank ?? null)}`,
    `note_id: ${yamlScalar(note.note_id)}`,
    `title: ${yamlScalar(note.title)}`,
    `note_type: ${yamlScalar(note.note_type)}`,
    `note_url: ${yamlScalar(note.note_url)}`,
    `cover_url: ${yamlScalar(note.cover_url)}`,
    `cover_file: ${yamlScalar(relativeCover)}`,
    `avatar_url: ${yamlScalar(note.avatar_url)}`,
    `avatar_file: ${yamlScalar(relativeAvatar)}`,
    `author_name: ${yamlScalar(note.author_name)}`,
    `author_user_id: ${yamlScalar(note.author_user_id)}`,
    `author_profile_url: ${yamlScalar(note.author_profile_url)}`,
    `liked_count: ${yamlScalar(note.liked_count)}`,
    `comment_count: ${yamlScalar(note.comment_count)}`,
    `collect_count: ${yamlScalar(note.collect_count)}`,
    `share_count: ${yamlScalar(note.share_count)}`,
    `published_at: ${yamlScalar(note.published_at)}`,
    `last_update_time: ${yamlScalar(note.last_update_time)}`,
    `ip_location: ${yamlScalar(note.ip_location)}`,
    yamlArray("tags", note.tags),
    yamlArray("image_urls", note.image_urls),
    yamlArray("image_files", relativeImages),
    yamlArray("video_urls", note.video_urls),
    yamlArray("video_files", relativeVideos),
    "---",
  ].join("\n");

  return [
    frontmatter,
    "",
    `# ${note.title || note.note_id}`,
    "",
    "## Content",
    "",
    note.content_text || "",
    "",
    "## Metadata",
    "",
    `- Note URL: ${note.note_url || ""}`,
    `- Author: ${note.author_name || ""}`,
    `- Author URL: ${note.author_profile_url || ""}`,
    `- Likes: ${note.liked_count ?? ""}`,
    `- Comments: ${note.comment_count ?? ""}`,
    `- Collects: ${note.collect_count ?? ""}`,
    `- Shares: ${note.share_count ?? ""}`,
    `- Published At: ${note.published_at || ""}`,
    `- Cover File: ${relativeCover || ""}`,
    `- Avatar File: ${relativeAvatar || ""}`,
    "",
    "## Tags",
    "",
    ...(note.tags.length > 0 ? note.tags.map((tag) => `- ${tag}`) : ["-"]),
    "",
    "## Images",
    "",
    ...(note.image_urls.length > 0
      ? note.image_urls.map((url, index) => {
          const label = relativeImages[index] || `image-${index + 1}`;
          return `- [${label}](${url})`;
        })
      : ["-"]),
    "",
    "## Videos",
    "",
    ...(note.video_urls.length > 0
      ? note.video_urls.map((url, index) => {
          const label = relativeVideos[index] || `video-${index + 1}`;
          return `- [${label}](${url})`;
        })
      : ["-"]),
    "",
  ].join("\n");
}

export function renderNotesIndex(notes: NoteRecord[]): string {
  return [
    "# Notes Index",
    "",
    `- Total Notes: ${notes.length}`,
    "",
    ...notes.map((note) => `- ${String(note.rank ?? 0).padStart(3, "0")} | ${note.note_id} | ${note.title || ""} | likes=${note.liked_count ?? ""} | comments=${note.comment_count ?? ""}`),
    "",
  ].join("\n");
}
