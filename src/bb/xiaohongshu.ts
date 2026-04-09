import { BbBrowserError, runBbBrowserJson, runSiteJson, type BbBrowserOptions } from "./run-site.js";

export interface SearchPageNote {
  note_id: string;
  xsec_token: string | null;
  title: string | null;
  note_url: string | null;
  note_type: string | null;
  cover_url: string | null;
  author_name: string | null;
  author_user_id: string | null;
  author_profile_url: string | null;
  avatar_url: string | null;
  liked_count: number | null;
  comment_count: number | null;
  collect_count: number | null;
  share_count: number | null;
  published_at: string | null;
}

export interface SearchPageResult {
  keyword: string;
  sort: string;
  sort_label?: string;
  page: number;
  count: number;
  has_more: boolean;
  notes: SearchPageNote[];
}

export interface NoteDetailResult {
  note_id: string;
  xsec_token: string | null;
  title: string | null;
  content_text: string | null;
  note_type: string | null;
  tags: string[];
  note_url: string | null;
  cover_url: string | null;
  avatar_url: string | null;
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
  video_urls: string[];
}

export interface CommentPageRecord {
  comment_id: string;
  content_text: string | null;
  image_urls: string[];
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

export interface CommentsPageResult {
  note_id: string;
  note_url: string | null;
  cursor_in: string | null;
  cursor_out: string | null;
  has_more: boolean;
  count: number;
  comments: CommentPageRecord[];
}

export interface CommentRepliesPageResult extends CommentsPageResult {
  comment_id: string;
}

interface BrowserTab {
  index: number;
  url: string;
  title: string;
  active: boolean;
  tabId: number | string;
  tab?: string;
}

interface BbBrowserEnvelope<T> {
  success?: boolean;
  error?: string;
  hint?: string;
  data?: T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBbError(error: unknown): BbBrowserError {
  return error instanceof BbBrowserError
    ? error
    : new BbBrowserError(error instanceof Error ? error.message : String(error));
}

function isRetryableXiaohongshuError(error: BbBrowserError): boolean {
  return /Chrome not connected|CDP WebSocket closed unexpectedly|Daemon request timed out|Inspected target navigated or closed|Target closed|Tab not found|Page not ready|User store not found|Search store not found|Router not found|ECONNRESET|socket hang up/i.test(
    [error.message, error.stderr, error.stdout].join("\n"),
  );
}

function isXiaohongshuUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "www.xiaohongshu.com" || parsed.hostname.endsWith(".xiaohongshu.com");
  } catch {
    return false;
  }
}

function scoreXiaohongshuTab(tab: BrowserTab): number {
  let score = 0;
  if (tab.active) score += 100;
  if (tab.url && !/^about:blank$/i.test(tab.url)) score += 20;
  if (tab.title && !/^(new tab|blank|about:blank)$/i.test(tab.title.trim())) score += 10;
  if (tab.url.includes("/explore/")) score += 8;
  if (tab.url.includes("/search_result")) score += 7;
  if (tab.url.includes("/explore")) score += 6;
  return score;
}

let cachedXiaohongshuTab: string | null = null;

async function listTabs(options: BbBrowserOptions): Promise<BrowserTab[]> {
  const envelope = await runBbBrowserJson<BbBrowserEnvelope<{ tabs?: BrowserTab[] }>>(["tab", "list"], options);
  if (!envelope.success) {
    throw new BbBrowserError(envelope.error || "Failed to list browser tabs", JSON.stringify(envelope), envelope.hint || "");
  }
  return envelope.data?.tabs || [];
}

async function openXiaohongshuTab(options: BbBrowserOptions): Promise<string> {
  const envelope = await runBbBrowserJson<BbBrowserEnvelope<{ tab?: string; tabId?: number | string }>>(
    ["open", "https://www.xiaohongshu.com/explore"],
    options,
  );
  if (!envelope.success) {
    throw new BbBrowserError(envelope.error || "Failed to open Xiaohongshu tab", JSON.stringify(envelope), envelope.hint || "");
  }
  const tab = envelope.data?.tab;
  if (!tab) {
    throw new BbBrowserError("bb-browser did not return a Xiaohongshu tab id");
  }
  await sleep(1500);
  return tab;
}

async function ensureXiaohongshuWorkTab(options: BbBrowserOptions): Promise<string> {
  if (options.tabId != null) {
    return options.tabId;
  }

  const tabs = await listTabs(options);
  if (cachedXiaohongshuTab) {
    const existing = tabs.find((tab) => String(tab.tab) === cachedXiaohongshuTab && isXiaohongshuUrl(tab.url));
    if (existing?.tab) {
      return existing.tab;
    }
    cachedXiaohongshuTab = null;
  }

  const best = tabs
    .filter((tab) => isXiaohongshuUrl(tab.url))
    .sort((left, right) => scoreXiaohongshuTab(right) - scoreXiaohongshuTab(left))[0];

  if (best?.tab) {
    cachedXiaohongshuTab = best.tab;
    return best.tab;
  }

  cachedXiaohongshuTab = await openXiaohongshuTab(options);
  return cachedXiaohongshuTab;
}

async function runXiaohongshuSiteJson<T>(adapter: string, adapterArgs: string[], options: BbBrowserOptions = {}): Promise<T> {
  const maxAttempts = 4;
  let lastError: BbBrowserError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const tabId = await ensureXiaohongshuWorkTab(options);
    try {
      return await runSiteJson<T>(adapter, adapterArgs, { ...options, tabId });
    } catch (error) {
      const bbError = normalizeBbError(error);
      lastError = bbError;
      if (!isRetryableXiaohongshuError(bbError) || attempt === maxAttempts) {
        throw bbError;
      }
      cachedXiaohongshuTab = null;
      await sleep(1000 * attempt);
    }
  }

  throw lastError || new BbBrowserError(`Adapter ${adapter} failed`);
}

export async function searchPage(
  keyword: string,
  sort: "likes" | "comments" | "latest" | "general" | "collects",
  page: number,
  limit: number,
  options: BbBrowserOptions = {},
): Promise<SearchPageResult> {
  return await runXiaohongshuSiteJson<SearchPageResult>(
    "xiaohongshu/search-page",
    [keyword, "--sort", sort, "--page", String(page), "--limit", String(limit)],
    options,
  );
}

export async function noteDetail(noteId: string, xsecToken: string | null, options: BbBrowserOptions = {}): Promise<NoteDetailResult> {
  const args = [noteId];
  if (xsecToken) args.push("--xsec_token", xsecToken);
  return await runXiaohongshuSiteJson<NoteDetailResult>("xiaohongshu/note-detail", args, options);
}

export async function commentsPage(
  noteId: string,
  xsecToken: string | null,
  cursor: string | null,
  limit: number,
  options: BbBrowserOptions = {},
): Promise<CommentsPageResult> {
  const args = [noteId, "--limit", String(limit)];
  if (xsecToken) args.push("--xsec_token", xsecToken);
  if (cursor) args.push("--cursor", cursor);
  return await runXiaohongshuSiteJson<CommentsPageResult>("xiaohongshu/comments-page", args, options);
}

export async function commentRepliesPage(
  noteId: string,
  commentId: string,
  xsecToken: string | null,
  cursor: string | null,
  limit: number,
  options: BbBrowserOptions = {},
): Promise<CommentRepliesPageResult> {
  const args = [noteId, commentId, "--limit", String(limit)];
  if (xsecToken) args.push("--xsec_token", xsecToken);
  if (cursor) args.push("--cursor", cursor);
  return await runXiaohongshuSiteJson<CommentRepliesPageResult>("xiaohongshu/comment-replies-page", args, options);
}
