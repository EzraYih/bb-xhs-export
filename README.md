<div align="center">

# bb-xhs-export

### 小红书导出工具 for bb-browser

**将小红书笔记和评论导出为原始 JSON、规范化为 JSON 和 Markdown。**

[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![基于 bb-browser](https://img.shields.io/badge/基于-bb--browser-111827)](https://github.com/epiral/bb-browser)

</div>

---

`bb-xhs-export` 基于 [bb-browser](https://github.com/epiral/bb-browser) 和 [bb-sites](https://github.com/epiral/bb-sites) 中的小红书工作流原语构建。它复用你的真实浏览器会话，调用站点适配器，并将结果转换为可恢复的导出任务。

```bash
node dist/cli.js notes --keyword outfit --top 10 --output-dir ./exports/notes
node dist/cli.js comments --keyword outfit --top-notes 5 --output-dir ./exports/comments
node dist/cli.js comments --keyword outfit --top-notes 5 --output-dir ./exports/comments --resume
```

## 工作流

`bb-browser` 提供稳定的小红书适配器原语，如 `search-page`、`note-detail`、`comments-page` 和 `comment-replies-page`。`bb-xhs-export` 将这些原语打包为两个高级工作流：

| 工作流 | 功能 | 输出 |
|---|---|---|
| `notes` | 按关键词搜索小红书，按点赞排序，获取热门笔记详情，渲染笔记 Markdown | 原始搜索页、原始笔记 JSON、`normalized/notes.json`、`markdown/notes/*.md`、`markdown/notes/index.md` |
| `comments` | 按关键词搜索小红书，按评论排序选取热门笔记，爬取顶层评论和回复页 | 原始搜索页、原始笔记 JSON、原始评论/回复 JSON、`normalized/notes.json`、`normalized/comments/*.json`、`markdown/comments/*.md`、`markdown/comments/index.md` |

每次成功运行都会写入 `manifest.json`，包含摘要计数、失败记录和生成的文件路径。

## 快速开始

### 1. 环境初始化

项目要求三个仓库同级目录：

```text
02-Labs/
├── bb-browser/      # 浏览器控制层
├── bb-sites/        # 站点适配器（小红书适配器所在）
└── bb-xhs-export/   # 导出工具
```

分别构建每个项目：

```bash
# bb-browser
cd ../bb-browser && pnpm install && pnpm build

# bb-sites
cd ../bb-sites && pnpm install && pnpm build

# bb-xhs-export
cd ../bb-xhs-export && pnpm install && pnpm build
```

### 2. 确保 `bb-browser` 可用

`bb-browser` 的解析顺序：

1. `--bb-browser-bin <command>`
2. `BB_BROWSER_BIN`
3. 同级目录 `../bb-browser/dist/cli.js`（如果存在）
4. `PATH` 上的 `bb-browser` 或 `bb-browser.cmd`

如果将 `bb-browser` 和 `bb-xhs-export` 放在同级目录，且已在 `bb-browser` 中运行过 `pnpm build`，则无需额外参数。

### 3. 更新适配器并验证小红书会话

首先在你的真实浏览器中打开已登录的小红书标签页。

```bash
bb-browser site update
bb-browser open https://www.xiaohongshu.com
bb-browser site xiaohongshu/me
```

如果 `xiaohongshu/me` 失败，请先修复浏览器会话再进行导出。

### 4. 运行导出

```bash
node dist/cli.js notes --keyword outfit --top 10 --output-dir ./exports/notes
node dist/cli.js comments --keyword outfit --top-notes 5 --output-dir ./exports/comments
```

如果需要指定特定的 `bb-browser` 命令：

```bash
node dist/cli.js notes --keyword outfit --top 10 --output-dir ./exports/notes --bb-browser-bin "node ../bb-browser/dist/cli.js"
```

## 架构与目录结构

本项目以高内聚、低耦合的分层架构进行组织，确保后续抓取/导出的扩展性：

```text
bb-xhs-export/
├── src/
│   ├── bb/           # 底层驱动：负责与 bb-browser 进程通信，封装浏览器原语的执行与单层重试机制
│   ├── cache/        # 持久化：文件系统 IO 工具与 checkpoint 架构，实现断点续传与粗细粒度恢复
│   ├── fs/           # 布局：导出产物生命周期路径的统一映射（Raw -> Normalized -> Markdown）
│   ├── media/        # 媒体：负责外部资源拉取管道逻辑
│   ├── render/       # 展示：基于抓取到的标准数据源将笔记内容渲染为 Markdown
│   ├── schema/       # 数据：统一定义并清洗原始数据至纯净的数据模型（NoteRecord, CommentRecord）
│   ├── ui/           # 界面：终端（TTY 与非 TTY）输出和富进度条控制台交互组件
│   ├── workflows/    # 服务：顶层爬取业务串联封装（并行控制、任务拆分分发）
│   └── cli.ts        # 入口：外围 CLI 参数解析分发
```

## 命令

```bash
bb-xhs-export notes --keyword <q> --top <n> --output-dir <dir> [--resume] [--bb-browser-bin <path>]
bb-xhs-export comments --keyword <q> --top-notes <n> --output-dir <dir> [--resume] [--bb-browser-bin <path>]
```

| 选项 | 适用 | 含义 |
|---|---|---|
| `--keyword` | 两者 | 小红书搜索关键词 |
| `--top` | `notes` | 最终导出保留的笔记数量 |
| `--top-notes` | `comments` | 要导出评论的笔记数量 |
| `--output-dir` | 两者 | 原始数据、规范化 JSON、检查点和 Markdown 的根目录 |
| `--resume` | 两者 | 从 `checkpoints/` 下的检查点文件继续 |
| `--bb-browser-bin` | 两者 | 显式指定 `bb-browser` 命令，如 `bb-browser`、`bb-browser.cmd` 或 `node ../bb-browser/dist/cli.js` |

CLI 会在成功运行后打印最终输出目录和 manifest 路径。

## 输出目录结构

典型结构：

```text
exports/
  manifest.json
  checkpoints/
    notes.json
    comments.json
  raw/
    search-pages/
      page-1.json
    notes/
      <note_id>.json
    comments/
      <note_id>-page-1.json
    replies/
      <note_id>-<comment_id>-page-1.json
  normalized/
    notes.json
    comments/
      <note_id>.json
  markdown/
    notes/
      index.md
      001-<note_id>.md
    comments/
      index.md
      001-<note_id>.md
  media/
    covers/
    avatars/
    images/
    videos/
    comment-images/
```

注意：

- `notes` 运行不会生成 `normalized/comments/` 或 `markdown/comments/`。
- `comments` 运行仍会写入 `normalized/notes.json`，以便每个评论导出保留笔记上下文。
- `manifest.json` 在成功运行结束时写入。如果任务中断，检查点文件和部分原始输出会保留在磁盘上，但 manifest 可能尚未存在。

## 与 AI 模型配合使用

不要将整个导出目录发送给模型。

按层级使用输出：

| 目录/文件 | 发送给模型？ | 用途 |
|---|---|---|
| `manifest.json` | 是 | 数据集摘要、样本量、失败记录、文件清单 |
| `normalized/notes.json` | 是 | 结构化分析、筛选、排名、统计 |
| `normalized/comments/*.json` | 是 | 结构化评论分析、评论层级统计 |
| `markdown/notes/*.md` 和 `markdown/notes/index.md` | 是 | 内容分析、主题聚类、定性笔记审查 |
| `markdown/comments/*.md` 和 `markdown/comments/index.md` | 是 | 评论链分析、情感、论点模式、回复链审查 |
| `raw/` | 否 | 仅工程/调试数据 |
| `checkpoints/` | 否 | 仅恢复状态 |

推荐模式：

- 笔记分析：
  - 发送 `manifest.json`
  - 然后发送 `normalized/notes.json` 或 `markdown/notes/` 下的文件
- 评论分析：
  - 发送 `manifest.json`
  - 然后发送 `normalized/comments/*.json` 或 `markdown/comments/` 下的文件
- 不要发送 `raw/`，除非在调试爬虫。
- 不要发送 `checkpoints/`；它们不是分析数据。

如果导出的笔记或评论文件很多，请分批发送而不是一次性在 prompt 中发送全部。推荐顺序：

1. `manifest.json`
2. `markdown/.../index.md`
3. 一批笔记或评论文件

笔记导出示例：

- 好的模型输入：
  - `manifest.json`
  - `normalized/notes.json`
  - 或 `markdown/notes/index.md` + `markdown/notes/*.md`
- 不推荐：
  - `raw/search-pages/`
  - `raw/notes/`
  - `checkpoints/`

## 恢复行为

两个工作流都有检查点：

- `notes` 记录下一个搜索页、已见过的笔记 ID、已完成的笔记 ID 和笔记级失败。
- `comments` 记录笔记选择页、已选择的笔记 ID、已完成的笔记 ID 和笔记级失败。

重新运行相同命令，加上相同的 `--output-dir` 和 `--resume` 即可恢复。

```bash
node dist/cli.js comments --keyword outfit --top-notes 5 --output-dir ./exports/comments --resume
```

## 当前限制

- 需要保持登录状态的小红书浏览器会话。本工具不管理登录。
- 依赖 `bb-browser` 和 `bb-sites` 中的当前小红书适配器。大规模导出前请运行 `bb-browser site update`。
- 媒体文件目前有意未下载。`media/` 目录仍会创建，但 `cover_file`、`avatar_file`、`image_files` 和 `video_files` 保持为空占位符。
- 为稳定性考虑，导出工作流目前串行运行请求。

## 开发

```bash
pnpm install
pnpm build
node dist/cli.js --help
```

本地迭代：

```bash
pnpm dev -- --help
pnpm dev -- notes --keyword outfit --top 3 --output-dir ./tmp-smoke-notes
pnpm dev -- comments --keyword outfit --top-notes 2 --output-dir ./tmp-smoke-comments
```

## 相关项目

- [bb-browser](https://github.com/epiral/bb-browser): 将你的真实浏览器用作 API 表面
- [bb-sites](https://github.com/epiral/bb-sites): 社区站点适配器，包括小红书工作流原语