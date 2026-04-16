# GitHub 代码分析器

一个基于 Next.js 16 构建的 GitHub 仓库分析工具。输入公开仓库地址后，应用会拉取仓库文件树、展示源码内容，并使用 OpenAI 兼容接口对项目进行结构化分析。

## 中文说明

### 功能

- 解析公开 GitHub 仓库地址并加载默认分支
- 可视化展示仓库目录结构
- 在线查看文件内容与语法高亮
- 识别项目主要编程语言、技术栈标签和可能的入口文件
- 对候选入口文件做二次研判，按文件内容确认真实入口
- 从已确认入口函数出发，识别直接调用的关键子函数并输出结构化 JSON
- 在源码面板右侧展示可拖拽、可缩放的函数全景图
- 在工作日志面板中展示分析过程、AI 请求摘要和入口研判结果

### 运行环境

- Node.js 20.9 及以上
- npm、pnpm、yarn 或 bun 任一包管理器

### 快速开始

1. 安装依赖

```bash
npm install
```

2. 配置环境变量

在项目根目录创建或编辑 `.env.local`：

```env
# 必填：OpenAI 兼容接口的基础地址，通常以 /v1 结尾
OPENAI_COMPAT_BASE_URL=https://your-provider.example/v1

# 必填：OpenAI 兼容接口的 API Key
OPENAI_COMPAT_API_KEY=your_api_key

# 可选：仓库主分析使用的模型
OPENAI_COMPAT_MODEL=gpt-5.4

# 可选：项目入口研判单独使用的模型
# 不填写时，入口研判会默认复用 OPENAI_COMPAT_MODEL
# OPENAI_COMPAT_ENTRY_MODEL=gpt-5.4

# 可选：入口函数关键子函数识别模型
# 不填写时会默认复用 OPENAI_COMPAT_MODEL
# OPENAI_COMPAT_FUNCTION_MODEL=gpt-5.4
# 可选：递归下钻深度（从入口函数的直接子函数开始计为 1）
# 例如 2 表示会继续分析到“子函数的子函数”这一层
# OPENAI_COMPAT_FUNCTION_MAX_DEPTH=2
# GITHUB_TOKEN=github_pat_xxx
```

3. 启动开发服务器

```bash
npm run dev
```

4. 打开浏览器访问 [http://localhost:3000](http://localhost:3000)

### 常用命令

```bash
npm run dev
npm run lint
npm run build
npm run start
```

### 分析流程说明

1. 应用先从 GitHub 拉取仓库信息和完整文件树。
2. 根据代码文件和配置文件路径，让 AI 识别主要语言、技术栈和候选入口文件。
3. 对候选入口文件逐个读取正文。
4. 如果文件不超过 4000 行，则发送全文；超过 4000 行时，发送前 2000 行和后 2000 行。
5. 将仓库链接、简介、已识别语言、技术栈和文件内容一起交给 AI 进行入口研判。
6. 一旦确认真实入口文件，就停止后续候选文件的研判。
7. 读取入口文件和 README 简介，识别入口函数及其直接调用的关键子函数。
8. 将入口函数与关键子函数渲染为右侧函数全景图，供后续递归分析扩展。

### 注意事项

- 当前只支持公开 GitHub 仓库。
- AI 服务必须兼容 OpenAI `chat/completions` 接口。
- 如果你的服务商不支持某些模型名，请在 `.env.local` 中显式配置可用模型。
- 入口复核和关键子函数识别默认复用 `.env.local` 中的 `OPENAI_COMPAT_MODEL`，也可以分别单独覆盖。
- 递归下钻深度默认是 `2`（从入口函数直接子函数开始计为第 1 层），可通过 `OPENAI_COMPAT_FUNCTION_MAX_DEPTH` 调整。

## English

### Overview

GitHub Code Analyzer is a Next.js 16 application for inspecting public GitHub repositories. It loads the repository tree, renders source files in the browser, and uses an OpenAI-compatible API to generate structured repository analysis.

### Features

- Parse public GitHub repository URLs
- Load the default branch and repository file tree
- Browse source files with syntax highlighting
- Detect primary languages, tech stack tags, and candidate entry files
- Re-check candidate entry files using actual file content
- Identify key child functions called by the verified entry function and recursively drill into important branches
- Render a draggable and zoomable function overview panel beside the code viewer
- Show AI analysis progress and entry-point review logs in the UI

### Requirements

- Node.js 20.9+
- Any of `npm`, `pnpm`, `yarn`, or `bun`

### Setup

1. Install dependencies

```bash
npm install
```

2. Configure `.env.local`

```env
OPENAI_COMPAT_BASE_URL=https://your-provider.example/v1
OPENAI_COMPAT_API_KEY=your_api_key
OPENAI_COMPAT_MODEL=gpt-5.4
# OPENAI_COMPAT_ENTRY_MODEL=gpt-5.4
# OPENAI_COMPAT_FUNCTION_MODEL=gpt-5.4
# Drill-down depth starts at direct children of the entry function as level 1.
# OPENAI_COMPAT_FUNCTION_MAX_DEPTH=2
# Network / timeout tuning for slower OpenAI-compatible providers.
# OPENAI_COMPAT_CONNECT_TIMEOUT_MS=30000
# OPENAI_COMPAT_REQUEST_TIMEOUT_MS=120000
# OPENAI_COMPAT_HEADERS_TIMEOUT_MS=120000
# OPENAI_COMPAT_BODY_TIMEOUT_MS=120000
# OPENAI_COMPAT_RETRY_COUNT=2
# OPENAI_COMPAT_RETRY_BACKOFF_MS=1500
# GITHUB_TOKEN=github_pat_xxx
```

3. Start the development server

```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000)

### Scripts

```bash
npm run dev
npm run lint
npm run build
npm run start
```

### Notes

- Public GitHub repositories only
- The AI provider must support an OpenAI-compatible `chat/completions` endpoint
- Configure `GITHUB_TOKEN` or `GITHUB_API_TOKEN` in `.env.local` if you want a higher GitHub API rate limit
- Entry-point verification reuses `OPENAI_COMPAT_MODEL` by default unless `OPENAI_COMPAT_ENTRY_MODEL` is set
- Function-level key child analysis also reuses `OPENAI_COMPAT_MODEL` by default unless `OPENAI_COMPAT_FUNCTION_MODEL` is set
- Recursive drill-down depth defaults to `2` (entry child level is counted as level `1`) and can be overridden with `OPENAI_COMPAT_FUNCTION_MAX_DEPTH`
- If your provider is slow to establish connections or occasionally returns `fetch failed` / `Connect Timeout`, tune `OPENAI_COMPAT_CONNECT_TIMEOUT_MS`, `OPENAI_COMPAT_REQUEST_TIMEOUT_MS`, and `OPENAI_COMPAT_RETRY_COUNT`
