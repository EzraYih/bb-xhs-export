#!/usr/bin/env node

import {
  NOTES_EXPORT_DEFAULTS,
  exportNotesWorkflow,
} from './workflows/export-notes.js'
import {
  COMMENT_EXPORT_DEFAULTS,
  exportCommentsWorkflow,
} from './workflows/export-comments.js'

type FlagValue = string | boolean
type SortOption = 'likes' | 'comments' | 'latest' | 'general' | 'collects'

const REMOVED_COMMENT_FLAGS = [
  'top-comments-page-size',
  'reply-page-size',
  'chunk-max-top-pages',
  'chunk-max-reply-pages',
  'note-context-warmup-min-ms',
  'note-context-warmup-max-ms',
  'intra-chunk-idle-min-ms',
  'intra-chunk-idle-max-ms',
  'heavy-reply-threshold',
  'selection-buffer-size',
  'rate-limit-cooldown-min-ms',
  'rate-limit-cooldown-max-ms',
  'comment-max-request-pages-per-run',
  'note-warmup-min-ms',
  'note-warmup-max-ms',
] as const

function timestamp(): string {
  return new Date().toISOString()
}

function log(...args: unknown[]): void {
  console.log(`[${timestamp()}]`, ...args)
}

function parseFlags(args: string[]): Record<string, FlagValue> {
  const flags: Record<string, FlagValue> = {}
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index]
    if (!current || !current.startsWith('--')) continue
    const key = current.slice(2)
    const next = args[index + 1]
    if (!next || next.startsWith('--')) {
      flags[key] = true
      continue
    }
    flags[key] = next
    index += 1
  }
  return flags
}

function assertNoRemovedCommentFlags(flags: Record<string, FlagValue>): void {
  const used = REMOVED_COMMENT_FLAGS.filter((flag) => flags[flag] !== undefined)
  if (used.length === 0) {
    return
  }
  const removedText = used.map((flag) => `--${flag}`).join('、')
  throw new Error(
    `以下评论参数已移除：${removedText}。评论导出当前仅保留 5 个公开调参面：--chunk-max-requests、--chunk-pause-min-ms、--chunk-pause-max-ms、--note-pause-min-ms、--note-pause-max-ms。其余节奏参数已改为内部默认值。`,
  )
}

function requireString(flags: Record<string, FlagValue>, key: string): string {
  const value = flags[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`缺少必填参数 --${key}`)
  }
  return value.trim()
}

function parseNumber(flags: Record<string, FlagValue>, key: string): number {
  const value = requireString(flags, key)
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`参数 --${key} 必须是正整数，当前值: ${value}`)
  }
  return parsed
}

function parseOptionalNonNegativeNumber(
  flags: Record<string, FlagValue>,
  key: string,
): number | undefined {
  const value = flags[key]
  if (value === undefined || value === false) {
    return undefined
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`参数 --${key} 必须是非负整数`)
  }
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`参数 --${key} 必须是非负整数，当前值: ${value}`)
  }
  return parsed
}

function formatDurationMs(ms: number): string {
  if (ms >= 1000) {
    const seconds = ms / 1000
    return `${seconds.toFixed(ms % 1000 === 0 ? 0 : 1)} 秒`
  }
  return `${ms} 毫秒`
}

function formatDurationRange(minMs: number, maxMs: number): string {
  return `${formatDurationMs(minMs)}~${formatDurationMs(maxMs)}`
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value)
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const parts: string[] = []
  if (hours > 0) parts.push(`${hours} 小时`)
  if (minutes > 0 || hours > 0) parts.push(`${minutes} 分`)
  parts.push(`${seconds} 秒`)
  return parts.join('')
}

function toSingleLine(
  text: string | null | undefined,
  maxLength = 36,
): string | null {
  const normalized = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return null
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
}

function printNotesSummary(
  result: Awaited<ReturnType<typeof exportNotesWorkflow>>,
): void {
  const { summary } = result
  const divider = '='.repeat(72)

  console.log('')
  console.log(divider)
  console.log('笔记采集统计')
  console.log(`  目标笔记数: ${formatCount(summary.requestedNoteCount)}`)
  console.log(
    `  本次尝试详情的笔记数: ${formatCount(summary.attemptedNoteCount)}`,
  )
  console.log(`  成功导出笔记数: ${formatCount(summary.completedNoteCount)}`)
  console.log(`  失败笔记数: ${formatCount(summary.failedNoteCount)}`)
  console.log(`  累计点赞数: ${formatCount(summary.likedCountTotal)}`)
  console.log(`  累计评论数: ${formatCount(summary.commentCountTotal)}`)
  console.log(`  累计收藏数: ${formatCount(summary.collectCountTotal)}`)
  console.log(`  总耗时: ${formatElapsed(summary.elapsedMs)}`)

  /*
  if (summary.notes.length > 0) {
    console.log("分笔记统计");
    for (const note of summary.notes) {
      const title = toSingleLine(note.title, 32);
      const likedText = note.likedCount === null ? "未知" : formatCount(note.likedCount);
      const commentText = note.commentCount === null ? "未知" : formatCount(note.commentCount);
      const collectText = note.collectCount === null ? "未知" : formatCount(note.collectCount);
      let line = `  ${note.rank}. ${note.noteId} | 点赞 ${likedText} | 评论 ${commentText} | 收藏 ${collectText} | ${note.status === "completed" ? "完成" : "失败"}`;
      if (title) {
        line += ` | ${title}`;
      }
      console.log(line);
      if (note.failureMessage) {
        console.log(`     原因: ${toSingleLine(note.failureMessage, 72)}`);
      }
    }
  }
  */
  console.log(divider)
  console.log('')
}

function printCommentsSummary(
  result: Awaited<ReturnType<typeof exportCommentsWorkflow>>,
): void {
  const { summary } = result
  const displayedTotalText =
    summary.displayedCommentCountKnownNotes === summary.selectedNoteCount
      ? formatCount(summary.displayedCommentCountTotal)
      : `${formatCount(summary.displayedCommentCountTotal)}（已知 ${formatCount(summary.displayedCommentCountKnownNotes)}/${formatCount(summary.selectedNoteCount)} 篇）`
  const divider = '='.repeat(72)

  console.log('')
  console.log(divider)
  console.log('评论采集统计')
  console.log(`  目标笔记数: ${formatCount(summary.requestedNoteCount)}`)
  console.log(`  实际入选笔记数: ${formatCount(summary.selectedNoteCount)}`)
  console.log(`  已完成笔记数: ${formatCount(summary.completedNoteCount)}`)
  console.log(`  失败笔记数: ${formatCount(summary.failedNoteCount)}`)
  console.log(`  笔记页显示评论总数: ${displayedTotalText}`)
  console.log(
    `  已采集评论总数: ${formatCount(summary.collectedCommentCountTotal)}`,
  )
  console.log(`  总耗时: ${formatElapsed(summary.elapsedMs)}`)

  if (summary.notes.length > 0) {
    console.log('分笔记统计')
    for (const note of summary.notes) {
      const displayedText =
        note.displayedCommentCount === null
          ? '未知'
          : formatCount(note.displayedCommentCount)
      const title = toSingleLine(note.title, 32)
      let line = `  ${note.rank}. ${note.noteId} | 笔记页显示 ${displayedText} | 已采集 ${formatCount(note.collectedCommentCount)} | ${note.status === 'completed' ? '完成' : '失败'}`
      if (title) {
        line += ` | ${title}`
      }
      console.log(line)
      if (note.failureMessage) {
        console.log(`     原因: ${toSingleLine(note.failureMessage, 72)}`)
      }
    }
  }
  console.log(divider)
  console.log('')
}

function printHelp(): void {
  console.log(
    [
      'bb-xhs-export',
      '',
      '用法:',
      '  node dist/cli.js notes --keyword <q> --top <n> [--output-dir <dir>] [--sort <sort>] [--resume] [--bb-browser-bin <path>] [--note-delay-min-ms <n>] [--note-delay-max-ms <n>] [--notes-chunk-size <n>] [--notes-chunk-pause-min-ms <n>] [--notes-chunk-pause-max-ms <n>] [--selection-buffer-size <n>]',
      '  node dist/cli.js comments --keyword <q> --top-notes <n> [--output-dir <dir>] [--sort <sort>] [--resume] [--bb-browser-bin <path>] [--chunk-max-requests <n>] [--chunk-pause-min-ms <n>] [--chunk-pause-max-ms <n>] [--note-pause-min-ms <n>] [--note-pause-max-ms <n>]',
    ].join('\n'),
  )
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv
  if (!command || command === '--help' || command === '-h') {
    printHelp()
    return
  }

  const flags = parseFlags(rest)
  const bbBrowserBin =
    typeof flags['bb-browser-bin'] === 'string'
      ? String(flags['bb-browser-bin'])
      : undefined
  const resume = Boolean(flags.resume)
  const sort =
    typeof flags.sort === 'string' ? (flags.sort as SortOption) : undefined
  const outputDir =
    typeof flags['output-dir'] === 'string' && flags['output-dir'].trim()
      ? flags['output-dir'].trim()
      : './export'

  if (command === 'notes') {
    const keyword = requireString(flags, 'keyword')
    const top = parseNumber(flags, 'top')
    const noteDetailDelayMinMs =
      parseOptionalNonNegativeNumber(flags, 'note-delay-min-ms') ??
      NOTES_EXPORT_DEFAULTS.noteDetailDelayMinMs
    const noteDetailDelayMaxMs =
      parseOptionalNonNegativeNumber(flags, 'note-delay-max-ms') ??
      NOTES_EXPORT_DEFAULTS.noteDetailDelayMaxMs
    const notesChunkSize =
      parseOptionalNonNegativeNumber(flags, 'notes-chunk-size') ??
      NOTES_EXPORT_DEFAULTS.notesChunkSize
    const notesChunkPauseMinMs =
      parseOptionalNonNegativeNumber(flags, 'notes-chunk-pause-min-ms') ??
      NOTES_EXPORT_DEFAULTS.notesChunkPauseMinMs
    const notesChunkPauseMaxMs =
      parseOptionalNonNegativeNumber(flags, 'notes-chunk-pause-max-ms') ??
      NOTES_EXPORT_DEFAULTS.notesChunkPauseMaxMs
    const selectionBufferSize =
      parseOptionalNonNegativeNumber(flags, 'selection-buffer-size') ??
      NOTES_EXPORT_DEFAULTS.selectionBufferSize

    if (noteDetailDelayMaxMs < noteDetailDelayMinMs) {
      throw new Error(
        `参数 --note-delay-max-ms 不能小于 --note-delay-min-ms，当前值: ${noteDetailDelayMaxMs} < ${noteDetailDelayMinMs}`,
      )
    }
    if (notesChunkSize <= 0) {
      throw new Error(
        `参数 --notes-chunk-size 必须是正整数，当前值: ${notesChunkSize}`,
      )
    }
    if (notesChunkPauseMaxMs < notesChunkPauseMinMs) {
      throw new Error(
        `参数 --notes-chunk-pause-max-ms 不能小于 --notes-chunk-pause-min-ms，当前值: ${notesChunkPauseMaxMs} < ${notesChunkPauseMinMs}`,
      )
    }

    // log(
    //   `开始导出笔记，关键词=${keyword}，目标笔记数量=${top}，每轮详情分块最多 ${notesChunkSize} 篇，块内停留=${formatDurationRange(noteDetailDelayMinMs, noteDetailDelayMaxMs)}，分块间隔=${formatDurationRange(notesChunkPauseMinMs, notesChunkPauseMaxMs)}，候选池=${selectionBufferSize}`,
    // );
    log(`开始导出笔记，关键词=${keyword}，目标笔记数量=${top}`)
    const result = await exportNotesWorkflow({
      keyword,
      top,
      outputDir,
      resume,
      bbBrowserBin,
      sort,
      noteDetailDelayMinMs,
      noteDetailDelayMaxMs,
      notesChunkSize,
      notesChunkPauseMinMs,
      notesChunkPauseMaxMs,
      selectionBufferSize,
    })
    log(`笔记导出完成，共 ${result.noteCount} 篇`)
    printNotesSummary(result)
    log(`输出目录: ${result.outputDir}`)
    log(`Manifest: ${result.manifestPath}`)
    return
  }

  if (command === 'comments') {
    const keyword = requireString(flags, 'keyword')
    const topNotes = parseNumber(flags, 'top-notes')
    assertNoRemovedCommentFlags(flags)
    const chunkMaxRequests =
      parseOptionalNonNegativeNumber(flags, 'chunk-max-requests') ??
      COMMENT_EXPORT_DEFAULTS.chunkMaxRequests
    const chunkPauseMinMs =
      parseOptionalNonNegativeNumber(flags, 'chunk-pause-min-ms') ??
      COMMENT_EXPORT_DEFAULTS.chunkPauseMinMs
    const chunkPauseMaxMs =
      parseOptionalNonNegativeNumber(flags, 'chunk-pause-max-ms') ??
      COMMENT_EXPORT_DEFAULTS.chunkPauseMaxMs
    const notePauseMinMs =
      parseOptionalNonNegativeNumber(flags, 'note-pause-min-ms') ??
      COMMENT_EXPORT_DEFAULTS.notePauseMinMs
    const notePauseMaxMs =
      parseOptionalNonNegativeNumber(flags, 'note-pause-max-ms') ??
      COMMENT_EXPORT_DEFAULTS.notePauseMaxMs

    if (chunkPauseMaxMs < chunkPauseMinMs) {
      throw new Error(
        `参数 --chunk-pause-max-ms 不能小于 --chunk-pause-min-ms，当前值: ${chunkPauseMaxMs} < ${chunkPauseMinMs}`,
      )
    }
    if (notePauseMaxMs < notePauseMinMs) {
      throw new Error(
        `参数 --note-pause-max-ms 不能小于 --note-pause-min-ms，当前值: ${notePauseMaxMs} < ${notePauseMinMs}`,
      )
    }

    // log(
    //   `开始导出评论，关键词=${keyword}，目标笔记数=${topNotes}，每轮分块最多发起 ${chunkMaxRequests} 次评论请求，分块间隔=${formatDurationRange(chunkPauseMinMs, chunkPauseMaxMs)}，笔记间隔=${formatDurationRange(notePauseMinMs, notePauseMaxMs)}`,
    // )
    log(`开始导出评论，关键词=${keyword}，目标笔记数=${topNotes}`)
    const result = await exportCommentsWorkflow({
      keyword,
      topNotes,
      outputDir,
      resume,
      bbBrowserBin,
      sort,
      chunkMaxRequests,
      chunkPauseMinMs,
      chunkPauseMaxMs,
      notePauseMinMs,
      notePauseMaxMs,
    })
    log(
      `评论导出完成，笔记 ${result.noteCount} 篇，评论 ${result.commentCount} 条`,
    )
    printCommentsSummary(result)
    log(`输出目录: ${result.outputDir}`)
    log(`Manifest: ${result.manifestPath}`)
    return
  }

  throw new Error(`未知命令: ${command}`)
}

main().catch((error) => {
  log(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
