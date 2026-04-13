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

## 🎯 核心功能 (Workflows)

`bb-browser` 提供稳定的小红书页面抓取原语（如 `search-page`、`note-detail`、`comments-page` 等）。本项目将这些原语打包为两类高阶导出工作流：

| 工作流 | 功能说明 | 核心输出 |
|---|---|---|
| `notes` | 按关键词搜索小红书，按点赞量选取热门笔记，抓取并渲染笔记详情。 | 原始 JSON、规范化 `notes.json`、Markdown 格式的笔记文件集合。 |
| `comments` | 按关键词搜索小红书，获取热门笔记，并进一步爬取这些笔记的顶层评论及回复流。 | 原始 JSON、规范化 `notes.json` 及 `comments/*.json`、Markdown 格式评论集合。 |

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
node dist/cli.js notes --keyword <q> --top <n> [--output-dir <dir>] [--sort <sort>] [--resume] [--bb-browser-bin <path>] [--note-delay-min-ms <n>] [--note-delay-max-ms <n>]
node dist/cli.js comments --keyword <q> --top-notes <n> [--output-dir <dir>] [--sort <sort>] [--resume] [--bb-browser-bin <path>] [--comment-delay-min-ms <n>] [--comment-delay-max-ms <n>] [--top-comments-page-size <n>] [--reply-page-size <n>] [--note-warmup-min-ms <n>] [--note-warmup-max-ms <n>] [--top-comments-burst-pages <n>] [--reply-burst-pages <n>] [--burst-cooldown-min-ms <n>] [--burst-cooldown-max-ms <n>] [--comment-cooldown-every <n>] [--comment-cooldown-ms <n>] [--comment-request-cooldown-every-pages <n>] [--comment-request-cooldown-ms <n>] [--comment-max-request-pages-per-run <n>] [--heavy-reply-threshold <n>] [--max-reply-pages-per-thread-per-run <n>] [--comment-backoff-min-ms <n>] [--comment-backoff-max-ms <n>] [--comment-backoff-max-retries <n>] [--rate-limit-cooldown-min-ms <n>] [--rate-limit-cooldown-max-ms <n>]
```

| 参数选项 | 适用工作流 | 含义说明 |
|---|---|---|
| `--keyword` | 两者皆可 | 必填：用于搜索定位的小红书关键词。 |
| `--sort` | 两者皆可 | 可选：筛选数据的排序规则，可选 `likes`、`comments`、`latest`、`general`、`collects`。如果你不传，`notes` 工作流默认寻找**点赞最多(`likes`)**，而 `comments` 工作流默认寻找**评论最多(`comments`)**。<br><br>**不传 sort 时的具体排序逻辑**：搜索 API 先按指定排序获取笔记，随后在本地聚合阶段，**默认按点赞数(likes)降序排列**，若点赞数相同则按**评论数**降序排列。 |
| `--top` | `notes` | 将关键词搜索结果按指定排序规则，将前 top 个笔记导出。 |
| `--top-notes` | `comments` | 将关键词搜索结果按指定排序规则，将前 top-notes 个笔记的评论全部导出 |
| `--output-dir` | 两者皆可 | 可选：保存原始数据、格式化 JSON、Markdown 和检查点的根路径。默认存放在当前命令执行目录下的 `./export` 目录。 |
| `--resume` | 两者皆可 | 可选：从之前意外中断时的检查点数据恢复流程续传。 |
| `--bb-browser-bin` | 两者皆可 | 可选：当你未按照同级存放的推荐模式时，显式指定你的 `bb-browser` 实际执行命令文件。 |
| `--note-delay-min-ms` | `notes` | 可选：逐条读取笔记详情前的最小随机等待时间（毫秒），默认 `1000`。传 `0` 可关闭最小等待。 |
| `--note-delay-max-ms` | `notes` | 可选：逐条读取笔记详情前的最大随机等待时间（毫秒），默认 `5000`。必须大于等于 `--note-delay-min-ms`。 |
| `--comment-delay-min-ms` | `comments` | 可选：评论抓取请求之间的最小随机等待时间（毫秒），默认 `500`。传 `0` 可关闭最小等待。 |
| `--comment-delay-max-ms` | `comments` | 可选：评论抓取请求之间的最大随机等待时间（毫秒），默认 `2000`。必须大于等于 `--comment-delay-min-ms`。 |
| `--top-comments-page-size` | `comments` | 可选：一级评论分页大小，默认 `20`。数值越大，请求总页数更少，但单次接口负载更高。 |
| `--reply-page-size` | `comments` | 可选：楼中楼回复分页大小，默认 `20`。 |
| `--note-warmup-min-ms` | `comments` | 可选：进入某条笔记后，在首个评论请求前的最小预热停留时间（毫秒），默认 `4000`。 |
| `--note-warmup-max-ms` | `comments` | 可选：进入某条笔记后，在首个评论请求前的最大预热停留时间（毫秒），默认 `8000`。必须大于等于 `--note-warmup-min-ms`。 |
| `--top-comments-burst-pages` | `comments` | 可选：单轮连续抓取的一级评论页数，默认 `4`。达到后会进入一段较长休息。 |
| `--reply-burst-pages` | `comments` | 可选：单轮连续抓取的回复页数，默认 `1`。 |
| `--burst-cooldown-min-ms` | `comments` | 可选：burst 间休息的最小时间（毫秒），默认 `5000`。 |
| `--burst-cooldown-max-ms` | `comments` | 可选：burst 间休息的最大时间（毫秒），默认 `20000`。必须大于等于 `--burst-cooldown-min-ms`。 |
| `--comment-cooldown-every` | `comments` | 可选：每累计抓到多少条评论后做一次冷却，默认 `1000`。传 `0` 可关闭。 |
| `--comment-cooldown-ms` | `comments` | 可选：按评论条数触发的冷却时长（毫秒），默认 `10000`。 |
| `--comment-request-cooldown-every-pages` | `comments` | 可选：每抓取多少个请求页后做一次冷却，默认 `20`。传 `0` 可关闭。 |
| `--comment-request-cooldown-ms` | `comments` | 可选：按请求页触发的冷却时长（毫秒），默认 `20000`。 |
| `--comment-max-request-pages-per-run` | `comments` | 可选：单次运行允许消耗的请求页预算，默认 `160`。传 `0` 可关闭该预算。 |
| `--heavy-reply-threshold` | `comments` | 可选：将某条 root comment 判定为“重线程”的回复数阈值，默认 `100`。重线程会被更保守地分批抓取。 |
| `--max-reply-pages-per-thread-per-run` | `comments` | 可选：单个 root comment 在一次运行中最多抓取多少页回复，默认 `20`。传 `0` 可关闭。 |
| `--comment-backoff-min-ms` | `comments` | 可选：遇到限流后，单次退避等待的最小时间（毫秒），默认 `120000`。 |
| `--comment-backoff-max-ms` | `comments` | 可选：遇到限流后，单次退避等待的最大时间（毫秒），默认 `300000`。必须大于等于 `--comment-backoff-min-ms`。 |
| `--comment-backoff-max-retries` | `comments` | 可选：单次运行内，遇到限流后最多重试多少次，默认 `1`。传 `0` 可关闭。 |
| `--rate-limit-cooldown-min-ms` | `comments` | 可选：触发强风控后写入 checkpoint 的最小冷却时间（毫秒），默认 `1800000`。 |
| `--rate-limit-cooldown-max-ms` | `comments` | 可选：触发强风控后写入 checkpoint 的最大冷却时间（毫秒），默认 `5400000`。必须大于等于 `--rate-limit-cooldown-min-ms`。 |

### 运行示例

导出 10 篇跟「穿搭」相关的热门笔记：
```bash
node dist/cli.js notes --keyword outfit --top 10 --output-dir ./exports/notes/outfit
```

导出 10 篇笔记，并将每条详情抓取间隔配置为 `2~6` 秒：
```bash
node dist/cli.js notes --keyword outfit --top 10 --output-dir ./exports/notes/outfit --note-delay-min-ms 2000 --note-delay-max-ms 6000
```

导出 5 篇穿搭笔记及其下方的**所有相关评论记录**：
```bash
node dist/cli.js comments --keyword outfit --top-notes 5 --output-dir ./exports/comments/outfit
```

导出评论，并将评论页/回复页请求间隔配置为 `0.8~1.5` 秒：
```bash
node dist/cli.js comments --keyword outfit --top-notes 5 --output-dir ./exports/comments/outfit --comment-delay-min-ms 800 --comment-delay-max-ms 1500
```

> **💡 最佳实践与数据隔离**
> 如果连续执行两次命令搜索不同的 `--keyword`，且没有更换指定的 `--output-dir` 目录，生成的 `normalized/notes.json` 等结果归档库文件**将会彻底覆盖 (Overwrite)** 为最新这一批 keyword 的结果。
> 
> 对此，**强烈建议：** 针对不同维度的提取主题，应当如上方的 CLI 示例代码所示，通过 `--output-dir` 显式隔离开来归档（例如分别输出到 `/outfit` 与 `/makeup` 的多级子目录之下），切勿混杂使用同一级目录，以免造成数据覆盖与丢失。

### 评论导出高级节奏参数

`comments` 工作流除了基础的请求间隔，还支持更细的“分页节奏”控制。建议优先调整这几组参数：

- **分页大小**：`--top-comments-page-size`、`--reply-page-size`
- **进入笔记后的预热停留**：`--note-warmup-min-ms`、`--note-warmup-max-ms`
- **分段抓取节奏**：`--top-comments-burst-pages`、`--reply-burst-pages`、`--burst-cooldown-min-ms`、`--burst-cooldown-max-ms`
- **总量预算与重线程限制**：`--comment-max-request-pages-per-run`、`--heavy-reply-threshold`、`--max-reply-pages-per-thread-per-run`
- **限流恢复**：`--comment-backoff-*`、`--rate-limit-cooldown-*`

当前默认值（与代码保持同步）：

```text
top-comments-page-size = 20
reply-page-size = 20
note-warmup = 4000~8000 ms
top-comments-burst-pages = 4
reply-burst-pages = 1
burst-cooldown = 5000~20000 ms
comment-cooldown = every 1000 comments, 10000 ms
request-page-cooldown = every 20 pages, 20000 ms
request-page-budget = 160 pages per run
heavy-reply-threshold = 100
max-reply-pages-per-thread-per-run = 20
comment-backoff = 120000~300000 ms x1
rate-limit-cooldown = 1800000~5400000 ms
```

### 推荐配置模板

保守模板：适合新关键词、新账号或刚恢复会话后的第一轮试跑。

```bash
node dist/cli.js comments --keyword outfit --top-notes 5 --output-dir ./exports/comments/outfit --comment-delay-min-ms 800 --comment-delay-max-ms 2000 --top-comments-page-size 20 --reply-page-size 20 --note-warmup-min-ms 4000 --note-warmup-max-ms 8000 --top-comments-burst-pages 2 --reply-burst-pages 1 --burst-cooldown-min-ms 5000 --burst-cooldown-max-ms 20000 --comment-max-request-pages-per-run 80 --max-reply-pages-per-thread-per-run 10
```

当前推荐模板：用于已经连续多轮稳定、希望兼顾效率和风控的常用配置。

```bash
node dist/cli.js comments --keyword outfit --top-notes 5 --output-dir ./exports/comments/outfit --comment-delay-min-ms 500 --comment-delay-max-ms 2000 --top-comments-page-size 20 --reply-page-size 20 --note-warmup-min-ms 4000 --note-warmup-max-ms 8000 --top-comments-burst-pages 4 --reply-burst-pages 1 --burst-cooldown-min-ms 5000 --burst-cooldown-max-ms 20000 --comment-request-cooldown-every-pages 20 --comment-request-cooldown-ms 20000 --comment-max-request-pages-per-run 160 --heavy-reply-threshold 100 --max-reply-pages-per-thread-per-run 20 --comment-backoff-min-ms 120000 --comment-backoff-max-ms 300000 --comment-backoff-max-retries 1 --rate-limit-cooldown-min-ms 1800000 --rate-limit-cooldown-max-ms 5400000
```

激进观察模板：仅建议在连续多轮无风控后再上调，用于短期验证吞吐上限。

```bash
node dist/cli.js comments --keyword outfit --top-notes 5 --output-dir ./exports/comments/outfit --comment-delay-min-ms 500 --comment-delay-max-ms 1500 --top-comments-page-size 20 --reply-page-size 20 --note-warmup-min-ms 3000 --note-warmup-max-ms 6000 --top-comments-burst-pages 4 --reply-burst-pages 1 --burst-cooldown-min-ms 10000 --burst-cooldown-max-ms 25000 --comment-request-cooldown-every-pages 20 --comment-request-cooldown-ms 20000 --comment-max-request-pages-per-run 160 --heavy-reply-threshold 100 --max-reply-pages-per-thread-per-run 20
```

### 任务恢复与断点续传 (Resume)

该工具中的两类工作流都有运行过程的 Checkpoint（检查点保存机制）：
- `notes` 会记录浏览到的搜索页进度、当前已解析的笔记 ID 列表等。
- `comments` 会附带记录选择页状态、评论进度和抓取失败情况。

如果命令中途停止，只需要加上相同的 `--output-dir` 参数同时添加 `--resume` 标志，即可恢复执行：
```bash
node dist/cli.js comments --keyword outfit --top-notes 5 --output-dir ./exports/comments --resume
```

## 📂 输出结构与数据应用

所有的提取结果将按照明确的高规约目录组织归档：

```text
exports/
├── manifest.json              # 任务全局统计元数据（含文件清单列表）
├── checkpoints/               # [状态持久化] 中断恢复记录配置
├── raw/                       # [底层数据] 从页面直接捕获的未加工数据
│   ├── search-pages/
│   ├── notes/
│   ├── comments/
│   └── replies/
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
    └── avatars/ ...
```

*注：`comments` 运行模式下，除生成评论本身的对应文件外，依然会建立 `normalized/notes.json` 及笔记对应的详情内容（这样在做分析时可以同时掌握评论及其从属的上下文环境）。*

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
