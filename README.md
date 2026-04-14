<div align="center">

# bb-xhs-export

### 小红书导出工具 for bb-browser

**将小红书笔记和评论导出为原始 JSON、规范化为 JSON 和 Markdown。**

[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![基于 bb-browser](https://img.shields.io/badge/基于-bb--browser-111827)](https://github.com/epiral/bb-browser)

</div>

---

`bb-xhs-export` 基于社区版 `bb-browser` 和 `bb-sites` 的二次开发 fork 分支构建。它复用你的真实浏览器会话，调用站点适配器，并将结果转换为可恢复的导出任务。

社区原版项目为 [epiral/bb-browser](https://github.com/epiral/bb-browser) 和 [epiral/bb-sites](https://github.com/epiral/bb-sites)。
本项目所依赖的定制化 fork 分仓库地址为 [EzraYih/bb-browser](https://github.com/EzraYih/bb-browser) 和 [EzraYih/bb-sites](https://github.com/EzraYih/bb-sites)。

> **版本配套要求**
> 当前已验证可用的组合为：
> - `bb-xhs-export`：当前仓库 `main`
> - `bb-browser`：`0.11.3` 版本的 `feature/xhs-export` 分支
> - `bb-sites`：`feature/xhs-export` 分支，直接放在 `~/.bb-browser/bb-sites`
>
> `bb-xhs-export` 不要和 npm 全局安装的社区版 `bb-browser`，或被 `bb-browser site update` 覆盖过的社区版 `bb-sites` 混用。否则 `notes-chunk`、`comments-chunk` 等小红书导出工作流原语可能不存在，或行为与本文档不一致。

## 🎯 核心功能 (Workflows)

`bb-browser` 提供稳定的小红书页面抓取原语（如 `search-page`、`note-detail`），并通过 `notes-chunk` 与 `comments-chunk` 提供浏览器页内的分块详情/评论采集能力。本项目将这些原语打包为两类高阶导出工作流：

| 工作流 | 功能说明 | 核心输出 |
|---|---|---|
| `notes` | 按关键词搜索小红书，先积累候选摘要，再以 `notes-chunk` 分块抓取入选笔记详情并渲染。 | 原始搜索页与笔记详情 JSON、规范化 `notes.json`、Markdown 格式的笔记文件集合、可恢复 checkpoint。 |
| `comments` | 按关键词搜索小红书，先基于搜索摘要选择候选笔记，只对最终入选笔记拉取详情，再以 chunk 方式持续抓取顶层评论及回复。 | 原始搜索页与笔记详情 JSON、规范化 `notes.json` 及 `comments/*.json`、Markdown 格式评论集合、可恢复 checkpoint。 |

*每次成功运行结束后，会自动在导出目录生成 `manifest.json`，汇总摘要计数、失败记录及文件路径列表。*

## 🚀 快速开始

当前项目需通过源码构建运行。请按照以下步骤完成环境初始化并启动导出。

### 1. 环境准备与编译

建议将包含 `bb-browser` 的相关工程放置在同级目录。需要确保你已经正确获取了 `bb-sites` 适配器（固定放在用户目录下）。

目录结构的建议流：
```text
02-Labs/
├── bb-browser/      # 浏览器控制层（请克隆 EzraYih/bb-browser 分支）
└── bb-xhs-export/   # 本项目：导出工具

C:\Users\<username>\.bb-browser\
└── bb-sites/        # 站点适配器（须从 EzraYih/bb-sites 克隆到此处）
```

分别构建每个项目（`bb-sites` 为纯 JS 项目，无需构建）：
```bash
# 构建 bb-browser
cd ../bb-browser && pnpm install && pnpm build

# 构建 bb-xhs-export
cd ../bb-xhs-export && pnpm install && pnpm build
```

> **注意：请勿使用 `npm install -g bb-browser`，这会安装旧版的社区版本。本项目依赖 fork 版本的 bb-browser 和 bb-sites。**

当 `bb-browser` 和 `bb-xhs-export` 存放在同级目录且均已被 build 后，CLI 将自动解析并调用本地的 `bb-browser`，无需额外环境变量。

### 2. 校验浏览器状态

导出工具高度依赖真实的浏览器会话。在执行批量导出前，**优先在真实浏览器内打开小红书并确认处于已登录状态**。

验证你的会话和适配器是否就绪：
```bash
# （注意：严禁运行 bb-browser site update，这会将其覆盖为社区版适配器）
# 如果需要更新适配器，请在 ~/.bb-browser/bb-sites/ 目录下直接执行 git pull

# 打开小红书确认登录状态
bb-browser open https://www.xiaohongshu.com

# 检查权限与抓取会话 (这一步必须成功)
bb-browser site xiaohongshu/me
```
*如果最后一步失败，请立即去打开的浏览器内处理任何可能的滑块验证码或其他登录状态问题。*

## 💻 使用方法 (Commands)

基本命令语法如下：

```bash
cd bb-xhs-export
node dist/cli.js notes --keyword <q> --top <n> [--output-dir <dir>] [--sort <sort>] [--resume] [--bb-browser-bin <path>] [--note-delay-min-ms <n>] [--note-delay-max-ms <n>] [--notes-chunk-size <n>] [--notes-chunk-pause-min-ms <n>] [--notes-chunk-pause-max-ms <n>] [--selection-buffer-size <n>]
node dist/cli.js comments --keyword <q> --top-notes <n> [--output-dir <dir>] [--sort <sort>] [--resume] [--bb-browser-bin <path>] [--chunk-max-requests <n>] [--chunk-pause-min-ms <n>] [--chunk-pause-max-ms <n>] [--note-pause-min-ms <n>] [--note-pause-max-ms <n>]
```

| 参数选项 | 适用工作流 | 含义说明 |
|---|---|---|
| `--keyword` | 两者皆可 | 必填：用于搜索定位的小红书关键词。 |
| `--sort` | 两者皆可 | 可选：筛选数据的排序规则，可选 `likes`、`comments`、`latest`、`general`、`collects`。如果你不传，`notes` 工作流默认寻找**点赞最多(`likes`)**，而 `comments` 工作流默认寻找**评论最多(`comments`)**。 |
| `--top` | `notes` | 将关键词搜索结果按指定排序规则，将前 top 个笔记导出。 |
| `--top-notes` | `comments` | 将关键词搜索结果按指定排序规则，将前 top-notes 个笔记的评论全部导出。 |
| `--output-dir` | 两者皆可 | 可选：保存原始数据、格式化 JSON、Markdown 和检查点的根路径。默认存放在当前命令执行目录下的 `./export` 目录。 |
| `--resume` | 两者皆可 | 可选：从之前意外中断时的检查点数据恢复流程续传。 |
| `--bb-browser-bin` | 两者皆可 | 可选：当你未按照同级存放的推荐模式时，显式指定你的 `bb-browser` 实际执行命令文件。 |
| `--note-delay-min-ms` | `notes` | 可选：同一轮 `notes-chunk` 内，两篇笔记详情之间的最小随机停留时间（毫秒），默认 `1000`。传 `0` 可关闭最小等待。 |
| `--note-delay-max-ms` | `notes` | 可选：同一轮 `notes-chunk` 内，两篇笔记详情之间的最大随机停留时间（毫秒），默认 `5000`。必须大于等于 `--note-delay-min-ms`。 |
| `--notes-chunk-size` | `notes` | 可选：单轮详情分块最多连续抓取多少篇笔记详情，默认 `2`。建议保持小批量，不要激进放大。 |
| `--notes-chunk-pause-min-ms` | `notes` | 可选：相邻两轮 `notes-chunk` 之间的最小暂停时间（毫秒），默认 `8000`。 |
| `--notes-chunk-pause-max-ms` | `notes` | 可选：相邻两轮 `notes-chunk` 之间的最大暂停时间（毫秒），默认 `15000`。必须大于等于 `--notes-chunk-pause-min-ms`。 |
| `--chunk-max-requests` | `comments` | 可选：单个 chunk 在浏览器页内最多发起多少次评论 API 请求，默认 `14`。 |
| `--chunk-pause-min-ms` | `comments` | 可选：相邻两个 chunk 之间的最小暂停时间（毫秒），默认 `3000`。 |
| `--chunk-pause-max-ms` | `comments` | 可选：相邻两个 chunk 之间的最大暂停时间（毫秒），默认 `8000`。必须大于等于 `--chunk-pause-min-ms`。 |
| `--note-pause-min-ms` | `comments` | 可选：切换到下一条笔记前的最小暂停时间（毫秒），默认 `10000`。 |
| `--note-pause-max-ms` | `comments` | 可选：切换到下一条笔记前的最大暂停时间（毫秒），默认 `20000`。必须大于等于 `--note-pause-min-ms`。 |
| `--selection-buffer-size` | `notes` | 可选：搜索阶段先积累多少条候选摘要再做最终选笔记。`notes` 默认 `20`，并始终不小于 `--top`。 |

评论导出现在只保留 5 个公开调参面：`--chunk-max-requests`、`--chunk-pause-min-ms`、`--chunk-pause-max-ms`、`--note-pause-min-ms`、`--note-pause-max-ms`。
旧的分页、预热、候选池、回复线程和冷却时间参数已改为内部默认值，不再开放 CLI 调参。

### 运行示例

导出 10 篇跟「穿搭」相关的热门笔记：
```bash
node dist/cli.js notes --keyword outfit --top 10 --output-dir ./exports/notes/outfit
```

导出 10 篇笔记，并使用默认的安全优先详情分块节奏：
```bash
node dist/cli.js notes --keyword outfit --top 10 --output-dir ./exports/notes/outfit --notes-chunk-size 2 --notes-chunk-pause-min-ms 8000 --notes-chunk-pause-max-ms 15000
```

导出 10 篇笔记，并将同一轮分块内的笔记停留时间调到 `2~6` 秒：
```bash
node dist/cli.js notes --keyword outfit --top 10 --output-dir ./exports/notes/outfit --note-delay-min-ms 2000 --note-delay-max-ms 6000 --notes-chunk-size 2 --notes-chunk-pause-min-ms 10000 --notes-chunk-pause-max-ms 18000
```

导出 5 篇穿搭笔记及其下方的**所有相关评论记录**：
```bash
node dist/cli.js comments --keyword outfit --top-notes 5 --output-dir ./exports/comments/outfit
```

导出评论，并采用当前默认的公开参数配置：
```bash
node dist/cli.js comments --keyword outfit --top-notes 5 --output-dir ./exports/comments/outfit --chunk-max-requests 14 --chunk-pause-min-ms 3000 --chunk-pause-max-ms 8000 --note-pause-min-ms 10000 --note-pause-max-ms 20000
```

导出评论，并采用更保守的节奏做首轮试跑：
```bash
node dist/cli.js comments --keyword outfit --top-notes 5 --output-dir ./exports/comments/outfit --chunk-max-requests 10 --chunk-pause-min-ms 5000 --chunk-pause-max-ms 10000 --note-pause-min-ms 15000 --note-pause-max-ms 25000
```

> **💡 最佳实践与数据隔离**
> 如果连续执行两次命令搜索不同的 `--keyword`，且没有更换指定的 `--output-dir` 目录，生成的 `normalized/notes.json` 等结果归档文件会被最新一次运行覆盖。
>
> 强烈建议按主题显式隔离输出目录，例如分别输出到 `./exports/comments/outfit` 和 `./exports/comments/makeup`，避免数据混用。

### 笔记工作流设计变化

新的 `notes` 工作流不再对每篇候选笔记单独调用一次 `note-detail`，而是改成了“候选池 + 分块详情”的模型：

1. 搜索阶段先调用 `search-page`，积累候选笔记摘要与 `xsec_token`。
2. 达到 `selection-buffer-size` 后，先按摘要字段（如 `liked_count`、`comment_count`、`published_at`）做本地排序，再挑出当前最值得抓取的一小批笔记。
3. 详情阶段改为调用 `xiaohongshu/notes-chunk`，一轮连续抓取少量笔记详情，随后暂停一段时间，再继续下一轮。
4. 断点续传会保存候选池、搜索进度、已完成笔记和失败笔记，并持续刷新 `normalized/notes.json`，避免中途中断后丢失已抓到的详情。

这里的 `notes chunk` 可以理解成“**一轮小批量连续抓取笔记详情**”。默认每轮只抓 2 篇详情，目标是减少 CLI 与浏览器之间的往返，同时尽量保持接近自然浏览的打开节奏。

### 评论工作流设计变化

新的 `comments` 工作流不再由 exporter 在外层逐页调度评论 API，而是改成了更粗粒度的分块模型：

1. 搜索阶段先调用 `search-page`，积累候选笔记摘要。
2. 达到内部候选池阈值后，先按摘要字段（如 `comment_count`、`liked_count`）做本地排序，再只对最终入选笔记拉取 `note-detail`。
3. 评论阶段改为调用 `xiaohongshu/comments-chunk`，一次推进多页一级评论和多页楼中楼回复，减少 CLI 与浏览器之间的往返。
4. 断点续传改为保存候选池、每条笔记的 chunk session state，以及已收集的 `comment_id` 集合。

通俗地说，新的采集过程不是“打开一篇笔记后一路抓到底”，而是：

1. 先抓一小段。
2. 停一下。
3. 再抓下一小段。
4. 重复这个过程，直到这一篇笔记的评论抓完。

这里的 `chunk` 可以理解成“**一轮小批量连续采集**”。这样做的目的不是追求一次跑完，而是在不明显触发平台安全限制的前提下，把浏览器内能连续推进的评论页尽量合并到同一轮里，提高整体吞吐。

### 终端进度提示怎么看

评论导出启动时，CLI 会先打印一行总体策略，例如：

```text
开始导出评论，关键词=outfit，目标笔记数=5，每轮分块最多发起 14 次评论请求，分块间隔=3 秒~8 秒，笔记间隔=10 秒~20 秒
```

这行的含义是：

- `每轮分块最多发起 14 次评论请求`
  - 表示一轮小批量采集里，最多连续调用 14 次评论相关接口，然后就先停一下。
- `分块间隔`
  - 表示同一篇笔记里，两轮小批量采集之间会随机停顿多久。
- `笔记间隔`
  - 表示一篇笔记抓完后，切换到下一篇笔记前会随机停顿多久。

运行过程中，进度条会显示类似下面的文案：

```text
第 3/5 篇笔记：已采集 220 条评论，累计抓取主评论 6 页、楼中楼回复 36 页，刚完成第 4 轮分块（本轮 14 次请求，新增主评论 2 页、回复 12 页），还有 5 个评论楼层待继续展开
```

这行的含义是：

- `已采集 220 条评论`
  - 当前这篇笔记已经累计拿到了 220 条评论记录，包含一级评论和楼中楼回复。
- `累计抓取主评论 6 页`
  - 当前这篇笔记下面的一级评论，已经累计翻了 6 页。
- `累计抓取楼中楼回复 36 页`
  - 当前这篇笔记下面各个评论线程的回复，已经累计翻了 36 页。
- `刚完成第 4 轮分块`
  - 表示这已经是当前笔记的第 4 轮小批量采集。
- `本轮 14 次请求，新增主评论 2 页、回复 12 页`
  - 表示刚结束的这一轮里，连续推进了多少次评论接口请求，以及这轮具体新增了多少页主评论和回复。
- `还有 5 个评论楼层待继续展开`
  - 表示还有 5 个一级评论的楼中楼回复线程没有抓完，后续轮次会继续推进。

如果看到下面这种提示：

```text
第 3/5 篇笔记：已采集 220 条评论，累计抓取主评论 6 页、楼中楼回复 36 页，等待 6.5 秒后继续当前笔记
```

表示当前只是这一篇笔记的两轮分块之间在暂停，还会继续抓当前笔记。

如果看到下面这种提示：

```text
第 3/5 篇笔记：本篇已采集 220 条评论，本篇已完成，等待 6.5 秒后切换到下一篇笔记
```

表示当前这篇笔记已经抓完，程序只是在切换到下一篇笔记前做停顿。

### 采集完成后的统计信息

两类工作流在采集完成后都会先收起进度条，再输出一段独立的汇总统计块。

- `notes`
  - 只输出总汇总，不再展开分笔记明细。
  - 当前会显示：目标笔记数、本次尝试详情的笔记数、成功导出笔记数、失败笔记数、累计点赞数、累计评论数、累计收藏数、总耗时。
- `comments`
  - 会输出总汇总，并继续保留分笔记统计。
  - 当前会显示：目标笔记数、实际入选笔记数、已完成笔记数、失败笔记数、笔记页显示评论总数、已采集评论总数、总耗时，以及每篇笔记的评论采集明细与失败原因。

### 评论导出关键节奏参数

建议优先调整这几组参数：

- **单次 chunk 预算**：`--chunk-max-requests`
- **chunk 之间的停顿**：`--chunk-pause-min-ms`、`--chunk-pause-max-ms`
- **切换笔记时的停顿**：`--note-pause-min-ms`、`--note-pause-max-ms`

当前公开默认值（与代码保持同步）：

```text
chunk-max-requests = 14
chunk-pause = 3000~8000 ms
note-pause = 10000~20000 ms
```

当前内部固定默认值：

```text
top-comments-page-size = 20
reply-page-size = 10
chunk-max-top-pages = 2
chunk-max-reply-pages = 12
note-context-warmup = 2000~4000 ms
intra-chunk-idle = 150~400 ms
heavy-reply-threshold = 100
selection-buffer-size = 20
rate-limit-cooldown = 1800000~5400000 ms
```

### 推荐配置模板

默认模板：适合已经稳定运行的新一轮导出，不需要额外参数。

```bash
node dist/cli.js comments --keyword outfit --top-notes 5 --output-dir ./exports/comments/outfit
```

平衡模板：适合已经稳定跑过一轮，想兼顾效率和风控的常用配置。

```bash
node dist/cli.js comments --keyword outfit --top-notes 5 --output-dir ./exports/comments/outfit --chunk-max-requests 14 --chunk-pause-min-ms 3000 --chunk-pause-max-ms 8000 --note-pause-min-ms 10000 --note-pause-max-ms 20000
```

保守模板：适合新关键词、新账号或刚恢复会话后的第一轮试跑。

```bash
node dist/cli.js comments --keyword outfit --top-notes 5 --output-dir ./exports/comments/outfit --chunk-max-requests 10 --chunk-pause-min-ms 5000 --chunk-pause-max-ms 10000 --note-pause-min-ms 15000 --note-pause-max-ms 25000
```

### 任务恢复与断点续传 (Resume)

该工具中的两类工作流都有运行过程的 Checkpoint（检查点保存机制）：
- `notes` 会记录搜索页进度、候选笔记池、已完成笔记、失败笔记，并在运行过程中持续刷新 `normalized/notes.json`。
- `comments` 会记录候选笔记池、已选笔记、已完成笔记、失败笔记，以及触发强风控后的冷却时间。
- `comments` 的每条笔记还会单独写入 `checkpoints/comments-partial-<note_id>.json`，里面保存已收集评论、`seen_comment_ids`、`session_id` 和 `session_state`。

如果浏览器页内的临时会话丢失，`--resume` 会优先使用 checkpoint 中的 `session_state` 重建 chunk 状态。极端情况下，当前笔记可能回放少量已抓过的请求页，但 exporter 会基于 `comment_id` 去重，不会重复写入最终结果。

如果命令中途停止，只需要加上相同的 `--output-dir` 参数同时添加 `--resume` 标志，即可恢复执行：
```bash
node dist/cli.js notes --keyword outfit --top 10 --output-dir ./exports/notes/outfit --resume
```

```bash
node dist/cli.js comments --keyword outfit --top-notes 5 --output-dir ./exports/comments/outfit --resume
```

### 笔记分块的安全边界

`notes-chunk` 已上线，但它的目标仍然是“减少本地往返开销”，而不是“让平台看到更高频的开笔记行为”。

当前默认值（与代码保持同步）：

```text
notes-chunk-size = 2
per-note-idle = 1000~5000 ms
chunk-pause = 8000~15000 ms
selection-buffer-size = 20（且不小于 --top）
detail-concurrency = 1
```

需要重点避免的风险点：

- **短时间连续打开过多篇笔记详情**
  - 对平台来说，这仍然是一连串真实的详情页访问，不会因为本地合并成一个 chunk 就自动变安全。
- **同一个 tab 在短时间内持续跳转多个 `/explore/<note_id>`**
  - `notes-chunk` 只是把多次详情抓取收敛到一次浏览器内执行，平台看到的仍然是连续详情访问。
- **单个 chunk 内笔记数量过多**
  - 一轮连续打开 4 篇以上笔记，风险会明显高于当前默认值。
- **笔记之间的停留时间压得过短**
  - 如果把 `--note-delay-*` 压到 `1s` 左右甚至更低，容易表现出自动化节奏。
- **chunk 之间没有足够的随机停顿**
  - 如果把 `--notes-chunk-pause-*` 压得太短，长任务会更像持续扫详情页。
- **多 tab 并发抓笔记详情**
  - 这是明确不建议的高风险方案，当前实现也保持固定并发 `1`。
- **在同一轮任务中把详情抓取、评论抓取都推到高频**
  - 即使单条链路看似安全，同一账号、同一会话同时高频抓详情和翻评论，整体风险仍会叠加。

如果你要用更保守的节奏做首轮试跑，建议优先提高这两组参数：

- `--note-delay-min-ms` / `--note-delay-max-ms`
- `--notes-chunk-pause-min-ms` / `--notes-chunk-pause-max-ms`

## 📂 输出结构与数据应用

所有的提取结果将按照明确的目录结构组织归档：

```text
exports/
├── manifest.json              # 任务全局统计元数据（含文件清单列表）
├── checkpoints/               # [状态持久化] 中断恢复记录配置
│   ├── comments.json
│   ├── notes.json
│   └── comments-partial-<note_id>.json
├── raw/                       # [底层数据] 从页面直接捕获的未加工数据
│   ├── search-pages/
│   └── notes/
├── normalized/                # [清洗与结构化] 结构统一、过滤多余字段的实用核心 JSON
│   ├── notes.json
│   └── comments/
│       └── <note_id>.json
├── markdown/                  # [用于阅读/语料] 可视化且易于 LLM 阅读的轻量化文本
│   ├── notes/
│   │   ├── index.md
│   │   └── 001-<note_id>.md
│   └── comments/
│       ├── index.md
│       └── 001-<note_id>.md
└── media/                     # [多媒体预留]
    ├── covers/
    ├── avatars/
    ├── images/
    ├── videos/
    └── comment-images/
```

补充说明：

- `comments` 运行模式下，除评论文件外，依然会生成 `normalized/notes.json` 及笔记详情，方便分析评论时同时保留上下文。
- 新的 chunk 流程默认只落盘 `raw/search-pages/` 和 `raw/notes/`。旧版逐页 `raw/comments/`、`raw/replies/` 调试输出不再默认生成。
- `checkpoints/comments-partial-<note_id>.json` 是评论断点续传的核心文件，里面包含已收集评论与 chunk session state。

### 🤖 与 AI 模型结合使用指南

导出此数据的最终目的是辅助大语言模型（LLMs）进行特定业务逻辑与统计。**不要一次性将整个提取目录拖塞进去发送**！

推荐依据目录层级分类组合 Prompt：

| 数据集类型 | 能否发给模型 | 适合发出的阶段与用途 |
| --- | --- | --- |
| `manifest.json` | ✅ 推荐发送 | 先导篇发送，了解全体抓取规模清单、整体分布和异常说明。 |
| `markdown/.../*` | ✅ 推荐发送 | 发给文本理解类模型用来进行主观倾向判断、话题聚类或评论情感分析判定。 |
| `normalized/...` | ✅ 推荐发送 | 有助于 Code Agent 进行基于数据形态的定制代码开发，提取某些明确统计值。 |
| `raw/` 及其子目录 | ❌ **不应发送** | 仅开发调试用，数据严重冗余影响推理效果。 |
| `checkpoints/` | ❌ **不应发送** | 用于系统续传机制，毫无分析价值。 |

**多轮对话分析典型建议：**
1. 传入 `manifest.json`。
2. 传入 `markdown/notes/index.md` 供模型理解各帖子标题和导引内容。
3. 进而挑选有价值的具体内容，再喂给关联的特定 `.md` 文件或特定 JSON 文件。

## 🛠 开发与代码架构

本项目以高内聚、低耦合的分层架构进行组织，确保后续爬取、结构化逻辑的独立变更和平滑拓展：

```text
src/
├── cli.ts                      # CLI 入口，处理命令行参数解析
├── bb/                         # 底层接口层 (包装并调用 bb-browser 及 XHS 适配器，含安全重试)
├── workflows/                  # 业务主干 (控制 notes / comments 的具体抓取行为逻辑流)
├── schema/                     # 数据定义层 (输入格式接口 Type 定义与清洗过程逻辑转化)
├── render/                     # Markdown 渲染呈现引擎层
├── cache/                      # 工具集类 (控制 Checkpoint, 抽象化的 JSON 持久化管理)
├── fs/layout.ts                # IO管理层 (管理整体导出目录规则和路径规范编排)
└── media/download.ts           # 媒体支持 (预留层)
```

**本地运行与调试迭代流：**
```bash
# 自动编译加运行查看帮助信息
pnpm dev -- --help

# 快速获取较少量数据用来观察本地代码修改结果
pnpm dev -- notes --keyword outfit --top 3 --output-dir ./tmp-smoke-notes
```

## ⚠️ 当前限制

- **登录要求**：需要在打开的小红书浏览器会话中始终保持你的登录态进行防护，本工具本身不介入复杂的登录协议处理。
- **媒体文件占位**：目前 `media/` 会建立图片封面的占位，但为了爬虫速度并未开启真正的图片或视频文件本地批量下载能力。
- **并发策略**：由于小红书严格的反爬频控，`workflows` 系列导出任务目前采用串行控制，以时间换取稳健性。
- **适配依赖**：深度依赖 `bb-sites` 当前对小红书节点特征的捕获规则，如果线上 UI 发生变动则需要更新社区适配器。

## 🌐 相关项目

- [EzraYih/bb-browser](https://github.com/EzraYih/bb-browser): 针对小红书导出功能特别定制的浏览器控制层 fork (原项目为 epiral/bb-browser)
- [EzraYih/bb-sites](https://github.com/EzraYih/bb-sites): 包含针对本项目优化的专属小红书抓取支持节点 (原项目为 epiral/bb-sites)
