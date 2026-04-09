import { relative } from "node:path";
import type { NoteRecord } from "../schema/note.js";
import type { CommentRecord } from "../schema/comment.js";

function toPosix(path: string | null): string | null {
  return path ? path.replace(/\\/g, "/") : null;
}

function yamlScalar(value: string | number | null): string {
  if (value == null) return "null";
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

export function renderCommentsMarkdown(note: NoteRecord, comments: CommentRecord[], markdownPath: string): string {
  const frontmatter = [
    "---",
    `note_id: ${yamlScalar(note.note_id)}`,
    `title: ${yamlScalar(note.title)}`,
    `note_url: ${yamlScalar(note.note_url)}`,
    `author_name: ${yamlScalar(note.author_name)}`,
    `comment_count: ${yamlScalar(comments.length)}`,
    "---",
  ].join("\n");

  const blocks = comments.map((comment) => {
    const imageLines = comment.image_urls.length > 0
      ? comment.image_urls.map((url, index) => {
          const local = comment.image_files[index] ? toPosix(relative(markdownPath, comment.image_files[index])) : null;
          return `- ${local || `image-${index + 1}`}: ${url}`;
        })
      : ["-"];

    return [
      `## Comment ${comment.comment_id}`,
      "",
      `- User Name: ${comment.user_name || ""}`,
      `- User ID: ${comment.user_id || ""}`,
      `- User URL: ${comment.user_url || ""}`,
      `- Comment Time: ${comment.comment_time || ""}`,
      `- Likes: ${comment.liked_count ?? ""}`,
      `- IP Location: ${comment.ip_location || ""}`,
      `- Sub Comment Count: ${comment.sub_comment_count ?? ""}`,
      `- Parent Comment ID: ${comment.parent_comment_id || ""}`,
      `- Root Comment ID: ${comment.root_comment_id || ""}`,
      `- Root Comment Content: ${comment.root_comment_content || ""}`,
      `- Quoted Comment ID: ${comment.quoted_comment_id || ""}`,
      `- Quoted Comment Content: ${comment.quoted_comment_content || ""}`,
      "",
      "### Content",
      "",
      comment.content_text || "",
      "",
      "### Images",
      "",
      ...imageLines,
      "",
    ].join("\n");
  });

  return [
    frontmatter,
    "",
    `# Comments for ${note.title || note.note_id}`,
    "",
    "## Note Context",
    "",
    `- Note URL: ${note.note_url || ""}`,
    `- Author: ${note.author_name || ""}`,
    `- Likes: ${note.liked_count ?? ""}`,
    `- Comments: ${note.comment_count ?? ""}`,
    "",
    ...blocks,
  ].join("\n");
}

export function renderCommentsIndex(notes: Array<{ note: NoteRecord; commentCount: number }>): string {
  return [
    "# Comments Index",
    "",
    `- Total Notes: ${notes.length}`,
    `- Total Comments: ${notes.reduce((sum, item) => sum + item.commentCount, 0)}`,
    "",
    ...notes.map((item) => `- ${String(item.note.rank ?? 0).padStart(3, "0")} | ${item.note.note_id} | ${item.note.title || ""} | comments=${item.commentCount}`),
    "",
  ].join("\n");
}
