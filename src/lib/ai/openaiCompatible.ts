import "server-only";

import { getFileContent } from "@/lib/githubApi";
import {
  aiAnalysisJsonSchema,
  aiAnalysisJsonTemplate,
  entryPointReviewJsonSchema,
  entryPointReviewJsonTemplate,
  functionCallDrillDownJsonSchema,
  functionCallDrillDownJsonTemplate,
  functionCallOverviewJsonSchema,
  functionCallOverviewJsonTemplate,
  normalizeAIAnalysisResult,
  normalizeEntryPointReviewResult,
  normalizeFunctionCallNode,
  normalizeFunctionCallOverview,
  type AIAnalysisResult,
  type AIModelDebugAttempt,
  type AIModelDebugData,
  type EntryPointReviewAttempt,
  type EntryPointReviewResult,
  type EntryPointVerificationDebugData,
  type FunctionCallNode,
  type FunctionCallAnalysisDebugData,
  type FunctionCallOverview,
  type RepositoryAnalysisContext,
  type RepositoryAnalysisDebugData,
} from "@/types/aiAnalysis";
import {
  countFunctionTreeNodes,
  createRankedFunctionSearchPaths,
  isLikelyNonProjectFunctionName,
  isSearchableFunctionFile,
  normalizeFunctionSearchName,
  searchFunctionDefinitionInFiles,
  type FunctionDefinitionMatch,
} from "@/lib/ai/functionCallSearch";

const DEFAULT_REPOSITORY_ANALYSIS_MODEL =
  process.env.OPENAI_COMPAT_MODEL?.trim() || "gpt-5.4";
const DEFAULT_ENTRY_POINT_REVIEW_MODEL =
  process.env.OPENAI_COMPAT_ENTRY_MODEL?.trim() ||
  DEFAULT_REPOSITORY_ANALYSIS_MODEL;
const DEFAULT_FUNCTION_CALL_ANALYSIS_MODEL =
  process.env.OPENAI_COMPAT_FUNCTION_MODEL?.trim() ||
  DEFAULT_REPOSITORY_ANALYSIS_MODEL;
const MAX_ANALYSIS_PATHS = 1000;
const MAX_LOCATION_GUESS_PROMPT_PATHS = 260;
const MAX_DRILL_DOWN_PROMPT_PATHS = 260;
const FILE_DIRECT_READ_LINE_LIMIT = 4000;
const FILE_SEGMENT_LINE_COUNT = 2000;
const FUNCTION_ANALYSIS_FILE_DIRECT_READ_LINE_LIMIT = 2000;
const FUNCTION_ANALYSIS_FILE_SEGMENT_LINE_COUNT = 1000;
const FUNCTION_SNIPPET_DIRECT_READ_LINE_LIMIT = 300;
const FUNCTION_SNIPPET_SEGMENT_LINE_COUNT = 150;
const PROJECT_INTRO_DIRECT_READ_LINE_LIMIT = 300;
const PROJECT_INTRO_SEGMENT_LINE_COUNT = 150;
const MAX_KEY_SUB_FUNCTIONS = 20;
const MAX_FUNCTION_LOCATION_GUESS_PATHS = 6;
const DEFAULT_FUNCTION_CALL_DRILL_DOWN_DEPTH = parsePositiveIntegerEnv(
  process.env.OPENAI_COMPAT_FUNCTION_MAX_DEPTH,
  2,
);

const TEXT = {
  configMissing:
    "AI 服务尚未配置，请在 .env.local 中设置 OPENAI_COMPAT_BASE_URL 和 OPENAI_COMPAT_API_KEY。",
  repositoryAnalysisSystemMessages: [
    "你是一名资深软件架构师。",
    "只分析提供给你的仓库文件路径，不要猜测不存在的信息。",
    "所有自然语言输出都必须使用简体中文。",
    "summary 字段必须使用简体中文撰写。",
    "当标签是 Next.js、React、TypeScript、Docker、Prisma 之类的专有技术名词时，保留原始技术名词。",
    "只返回合法 JSON。",
    "不要使用 Markdown 代码块包裹 JSON。",
    "结论要保守，避免根据文件名臆造不存在的技术栈。",
    "如果某个字段不确定，优先返回空数组，不要强行猜测。",
  ] as const,
  repositoryAnalysisUserMessages: [
    "请根据下面的文件路径推断仓库的主要编程语言、技术栈标签以及可能的入口文件。",
    "可能的入口文件包括 main.go、src/main.rs、src/index.ts、app/page.tsx、server.js、manage.py 或 cmd/*/main.go 等。",
    "分析结果必须使用简体中文返回。",
    "其中“summary”字段必须是简洁的简体中文项目总结。",
    "请严格按照下面的模板返回 JSON：",
  ] as const,
  entryReviewSystemMessages: [
    "你是一名资深软件架构师。",
    "你正在做项目入口文件复核，只能依据提供的仓库信息和文件内容做保守判断。",
    "所有自然语言输出都必须使用简体中文。",
    "只返回合法 JSON。",
    "不要使用 Markdown 代码块包裹 JSON。",
    "真实入口文件包括应用启动文件、服务启动入口、CLI 主入口，或 Web 框架中用户访问根路径对应的核心入口文件。",
    "普通组件、辅助模块、工具函数、样式文件、测试文件和大多数配置文件都不应判定为真实入口文件。",
  ] as const,
  entryReviewUserMessages: [
    "请判断下面这个候选文件是否是项目的真实入口文件。",
    "判断必须保守，不要因为文件名像入口就直接判定为 true。",
    "如果文件只是普通页面组件、布局片段、库导出、配置、测试或示例，请返回 false。",
    "如果文件明确承担应用启动、服务启动、CLI 主入口，或用户访问根路径的核心入口职责，可以返回 true。",
    "请严格按照下面的模板返回 JSON：",
  ] as const,
  functionOverviewSystemMessages: [
    "你是一名资深软件架构师。",
    "你正在根据已确认的入口文件识别入口函数及其直接调用的关键子函数。",
    "所有自然语言输出都必须使用简体中文。",
    "只返回合法 JSON。",
    "不要使用 Markdown 代码块包裹 JSON。",
    "只分析入口函数或模块启动主链路中直接调用、且对项目核心功能有明显影响的关键子函数。",
    "关键子函数数量不能超过 20 个。",
    "忽略简单常量、样式拼装、薄包装函数、纯展示叶子组件、日志封装、类型定义和明显不重要的辅助函数。",
    "根据函数名、仓库文件列表、项目简介和入口文件内容，保守判断 filePath、summary 和 shouldDive。",
    "shouldDive 只能返回 -1、0、1。",
    "children 字段当前只保留第一层关键子函数，每个子函数的 children 必须返回空数组，为未来递归分析预留。",
  ] as const,
  functionOverviewUserMessages: [
    "请根据项目简介、核心功能逻辑和仓库文件列表，识别入口函数及其直接调用的关键子函数。",
    "root 节点表示入口函数本身，children 表示入口函数直接调用的关键子函数。",
    "如果入口逻辑主要表现为匿名默认导出或模块级启动逻辑，可以使用保守的入口标识名，例如 default export 或 module bootstrap。",
    "每个子函数都要给出最可能的定义文件路径；无法判断时返回 null。",
    "summary 字段必须是简洁的简体中文功能说明。",
    "shouldDive 字段必须使用 -1、0、1，分别表示不需要继续下钻、不确定、需要继续下钻。",
    "关键子函数数量最多 20 个。",
    "请严格按照下面的模板返回 JSON：",
  ] as const,
  schemaIntro: "返回的 JSON 还必须满足以下 Schema：",
  repoPathsIntro: "仓库路径列表：",
  requestFailedPrefix: "AI 服务请求失败，状态码 ",
  fullStop: "。",
  invalidResponseJson: "AI 服务返回的响应不是合法 JSON。",
  emptyContent: "AI 服务返回了空内容。",
  invalidContentJson: "AI 服务返回的内容不是合法 JSON。",
  invalidResult: "AI 分析结果格式无效。",
  repositoryUrl: "仓库 GitHub 链接：",
  repositoryDescription: "仓库简介：",
  repositorySummary: "项目功能简介：",
  primaryLanguages: "主要编程语言：",
  techStack: "技术栈标签：",
  candidatePath: "候选入口文件：",
  verifiedEntryPoint: "已确认入口文件：",
  entryFileContent: "入口文件内容：",
  projectIntroduction: "项目简介：",
  projectIntroductionFile: "项目简介文件：",
  projectIntroductionUnavailable: "未提供可读取的 README 简介。",
  totalLines: "文件总行数：",
  analyzedLines: "本次提供的行数：",
  truncated: "内容是否截断：",
  fileContent: "文件内容：",
  noDescription: "未提供",
  noSummary: "未提供",
  noLanguages: "未识别",
  noTechStack: "未识别",
  yes: "是",
  no: "否",
  truncatedGapPrefix: "[... 中间省略 ",
  truncatedGapSuffix: " 行 ...]",
  candidateMissing:
    "候选文件不在当前仓库文件列表中，可能是上一步 AI 推断出的无效路径。",
  entryFileReadFailedPrefix: "读取候选文件失败：",
  functionOverviewSkippedNoEntry: "未确认真实入口文件，已跳过关键子函数识别。",
  functionOverviewEntryFileReadFailedPrefix: "读取入口文件失败：",
  functionOverviewRootMissing: "函数调用全景结果缺少 root 节点。",
  functionOverviewSuccessPrefix: "已识别入口函数及 ",
  functionOverviewSuccessSuffix: " 个关键子函数。",
} as const;

const functionLocationGuessJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    candidatePaths: {
      type: "array",
      maxItems: MAX_FUNCTION_LOCATION_GUESS_PATHS,
      items: {
        type: "string",
      },
      description:
        "根据函数名、父函数上下文和仓库文件列表推断出的最可能文件路径，按优先级排序。",
    },
    reason: {
      type: "string",
      description: "简体中文说明，解释为什么优先猜测这些文件。",
    },
  },
  required: ["candidatePaths", "reason"],
} as const;

const functionLocationGuessJsonTemplate = `{
  "candidatePaths": ["src/config/loadConfig.ts"],
  "reason": "函数名与配置加载职责高度相关，文件名和目录结构都与该函数语义匹配。"
}`;

const FUNCTION_LOCATION_GUESS_SYSTEM_MESSAGES = [
  "你是一名资深软件架构师。",
  "你正在根据函数名、上级调用上下文和仓库文件列表推断函数最可能存在的文件。",
  "所有自然语言输出必须使用简体中文。",
  "只返回合法 JSON，不要输出 Markdown 代码块。",
  "判断要保守；如果无法确认，只返回少量最可能的路径。",
] as const;

const FUNCTION_LOCATION_GUESS_USER_MESSAGES = [
  "请根据函数名、父函数信息和仓库文件列表，推断目标函数最可能定义在哪些文件中。",
  "只返回项目内真实存在的文件路径，按优先级排序，最多返回 6 个。",
  "如果某个路径只是弱猜测，不要为了凑数量强行返回。",
  "reason 字段必须使用简体中文简洁说明判断依据。",
  "请严格按照下面的模板返回 JSON：",
] as const;

const FUNCTION_DRILL_DOWN_SYSTEM_MESSAGES = [
  "你是一名资深软件架构师。",
  "你正在分析某个已定位函数的源码片段，并识别它直接调用的关键子函数。",
  "所有自然语言输出必须使用简体中文。",
  "只返回合法 JSON，不要输出 Markdown 代码块。",
  "只识别当前函数直接调用、且对核心业务链路有明显影响的关键子函数。",
  "忽略系统函数、标准库函数、第三方库函数、简单包装函数、日志函数、样式拼装和明显非核心的辅助函数。",
  "children 字段只保留第一层关键子函数，每个子函数的 children 必须返回空数组。",
  "shouldDive 只能返回 -1、0、1。",
  "如果当前函数本身已经属于非核心逻辑，可以将 shouldDive 设为 -1，并返回空 children。",
  "关键子函数数量不能超过 20 个。",
  "对于仓库内自定义函数，除非能明确判定为系统函数、库函数或明显的收尾工具逻辑，否则不要轻易返回 -1；拿不准时优先返回 0。",
] as const;

const FUNCTION_DRILL_DOWN_USER_MESSAGES = [
  "请基于当前函数的源码片段，识别它直接调用的关键子函数。",
  "name 和 filePath 字段表示当前正在分析的函数本身，请保守填写。",
  "children 中的每个子函数都要给出最可能的定义文件路径；无法判断时返回 null。",
  "summary 字段必须是简体中文的简洁功能说明。",
  "如果子函数明显属于系统函数、第三方库函数或非关键逻辑，请不要放入 children。",
  "如果某个仓库内自定义函数是否值得继续下钻无法确定，shouldDive 优先返回 0，而不是直接返回 -1。",
  "请严格按照下面的模板返回 JSON：",
] as const;

type OpenAIMessage = {
  role: "system" | "user";
  content: string;
};

type AttemptMode = "json_schema" | "plain_json";

type CompletionAttemptResult =
  | {
      ok: true;
      mode: AttemptMode;
      requestPayload: Record<string, unknown>;
      responsePayload: unknown;
      status: number;
      content: string;
    }
  | {
      ok: false;
      mode: AttemptMode;
      requestPayload: Record<string, unknown>;
      responsePayload: unknown;
      status: number;
      errorMessage: string;
      rawBody: string;
    };

type JsonCompletionOptions<T> = {
  model: string;
  messages: OpenAIMessage[];
  schemaName: string;
  schema: Record<string, unknown>;
  normalize: (value: unknown) => T;
};

type PreparedFileExcerpt = {
  content: string;
  totalLines: number;
  analyzedLines: number;
  truncated: boolean;
};

type PreparedFileExcerptOptions = {
  directLineLimit?: number;
  segmentLineCount?: number;
};

type EntryVerificationOutcome = {
  verifiedEntryPoint: string | null;
  verifiedEntryPointReason: string | null;
  debug: EntryPointVerificationDebugData;
};

type ProjectIntroductionExcerpt = {
  path: string | null;
  excerpt: PreparedFileExcerpt | null;
};

type FunctionOverviewOutcome = {
  result: FunctionCallOverview | null;
  debug: FunctionCallAnalysisDebugData;
};

type FunctionLocationGuessResult = {
  candidatePaths: string[];
  reason: string;
};

type FunctionLocationAttempt = {
  strategy: "same_file" | "ai_guess" | "project_search";
  candidatePaths: string[];
  matchedFilePath: string | null;
  matchedLine: number | null;
  reason: string;
};

type FunctionDrillDownContext = {
  repositoryContext: RepositoryAnalysisContext;
  analysisResult: AIAnalysisResult;
  promptFilePaths: string[];
  searchFilePaths: string[];
  projectIntroduction: ProjectIntroductionExcerpt;
  loadFileContent: (path: string) => Promise<string>;
  maxDepth: number;
  visitedNodeKeys: Set<string>;
};

type FunctionDrillDownResult = {
  node: FunctionCallNode;
  analyzedDepth: number;
};

const CLEAR_STOP_DIVE_NAME_PATTERNS = [
  /^(?:render|format|log|debug|trace|print|stringify|compare|assert|validate|normalize|sanitize|trim|sleep|delay|retry)/i,
  /^(?:is|has|get|set|to|from)[A-Z]/,
] as const;

const CLEAR_STOP_DIVE_SUMMARY_PATTERNS = [
  /日志|埋点|样式|格式化|转换|映射|比较|校验|断言|常量|枚举|拼接|展示|渲染|包装|封装/,
] as const;

function parsePositiveIntegerEnv(
  value: string | undefined,
  fallback: number,
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

function isClearlyStopDiveNode(node: FunctionCallNode): boolean {
  if (!node.filePath) {
    return true;
  }

  return (
    CLEAR_STOP_DIVE_NAME_PATTERNS.some((pattern) => pattern.test(node.name)) ||
    CLEAR_STOP_DIVE_SUMMARY_PATTERNS.some((pattern) =>
      pattern.test(node.summary),
    )
  );
}

function buildDrillDownVisitKey(
  node: Pick<FunctionCallNode, "name" | "filePath">,
): string {
  const normalizedName =
    normalizeFunctionSearchName(node.name)?.toLowerCase() ||
    node.name.trim().toLowerCase();
  const normalizedPath = node.filePath?.trim().toLowerCase() || "__unknown__";

  return `${normalizedPath}::${normalizedName}`;
}

function markNodeAsStopped(
  node: FunctionCallNode,
  filePath?: string | null,
): FunctionCallNode {
  return {
    ...node,
    filePath: filePath ?? node.filePath,
    shouldDive: -1,
    children: [],
  };
}

function shouldStopDrillDownNode(args: {
  node: FunctionCallNode;
  depth: number;
  context: FunctionDrillDownContext;
}): boolean {
  const { node, depth, context } = args;

  if (depth > context.maxDepth || node.shouldDive === -1) {
    return true;
  }

  if (!normalizeFunctionSearchName(node.name)) {
    return true;
  }

  if (!node.filePath && isLikelyNonProjectFunctionName(node.name)) {
    return true;
  }

  if (
    node.filePath &&
    !context.searchFilePaths.includes(node.filePath) &&
    isLikelyNonProjectFunctionName(node.name)
  ) {
    return true;
  }

  if (node.shouldDive !== 1 && isClearlyStopDiveNode(node) && !node.filePath) {
    return true;
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getOpenAICompatibleConfig() {
  const baseUrl = process.env.OPENAI_COMPAT_BASE_URL?.trim();
  const apiKey = process.env.OPENAI_COMPAT_API_KEY?.trim();

  if (!baseUrl || !apiKey) {
    throw new Error(TEXT.configMissing);
  }

  return {
    apiKey,
    baseUrl,
  };
}

function resolveChatCompletionsUrl(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

  if (normalizedBaseUrl.endsWith("/chat/completions")) {
    return normalizedBaseUrl;
  }

  return `${normalizedBaseUrl}/chat/completions`;
}

function parseResponsePayload(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return rawBody;
  }
}

function buildRepositoryAnalysisMessages(filePaths: string[]): OpenAIMessage[] {
  return [
    {
      role: "system",
      content: TEXT.repositoryAnalysisSystemMessages.join(" "),
    },
    {
      role: "user",
      content: [
        ...TEXT.repositoryAnalysisUserMessages,
        aiAnalysisJsonTemplate,
        TEXT.schemaIntro,
        JSON.stringify(aiAnalysisJsonSchema),
        TEXT.repoPathsIntro,
        ...filePaths.map((path) => `- ${path}`),
      ].join("\n"),
    },
  ];
}

function buildEntryReviewMessages(args: {
  repositoryContext: RepositoryAnalysisContext;
  analysisResult: AIAnalysisResult;
  candidatePath: string;
  excerpt: PreparedFileExcerpt;
}): OpenAIMessage[] {
  const {
    repositoryContext,
    analysisResult,
    candidatePath,
    excerpt,
  } = args;

  return [
    {
      role: "system",
      content: TEXT.entryReviewSystemMessages.join(" "),
    },
    {
      role: "user",
      content: [
        ...TEXT.entryReviewUserMessages,
        entryPointReviewJsonTemplate,
        TEXT.schemaIntro,
        JSON.stringify(entryPointReviewJsonSchema),
        `${TEXT.repositoryUrl}${repositoryContext.repositoryUrl}`,
        `${TEXT.repositoryDescription}${
          repositoryContext.repositoryDescription?.trim() || TEXT.noDescription
        }`,
        `${TEXT.repositorySummary}${analysisResult.summary || TEXT.noSummary}`,
        `${TEXT.primaryLanguages}${
          analysisResult.primaryLanguages.join("、") || TEXT.noLanguages
        }`,
        `${TEXT.techStack}${
          analysisResult.techStack.join("、") || TEXT.noTechStack
        }`,
        `${TEXT.candidatePath}${candidatePath}`,
        `${TEXT.totalLines}${excerpt.totalLines}`,
        `${TEXT.analyzedLines}${excerpt.analyzedLines}`,
        `${TEXT.truncated}${excerpt.truncated ? TEXT.yes : TEXT.no}`,
        TEXT.fileContent,
        excerpt.content,
      ].join("\n"),
    },
  ];
}

function buildFunctionOverviewMessages(args: {
  repositoryContext: RepositoryAnalysisContext;
  analysisResult: AIAnalysisResult;
  verifiedEntryPoint: string;
  entryExcerpt: PreparedFileExcerpt;
  projectIntroduction: ProjectIntroductionExcerpt;
  filePaths: string[];
}): OpenAIMessage[] {
  const {
    repositoryContext,
    analysisResult,
    verifiedEntryPoint,
    entryExcerpt,
    projectIntroduction,
    filePaths,
  } = args;

  const projectIntroductionLines = projectIntroduction.excerpt
    ? [
        `${TEXT.projectIntroductionFile}${
          projectIntroduction.path ?? TEXT.noDescription
        }`,
        `${TEXT.totalLines}${projectIntroduction.excerpt.totalLines}`,
        `${TEXT.analyzedLines}${projectIntroduction.excerpt.analyzedLines}`,
        `${TEXT.truncated}${
          projectIntroduction.excerpt.truncated ? TEXT.yes : TEXT.no
        }`,
        TEXT.projectIntroduction,
        projectIntroduction.excerpt.content,
      ]
    : [TEXT.projectIntroductionUnavailable];

  return [
    {
      role: "system",
      content: TEXT.functionOverviewSystemMessages.join(" "),
    },
    {
      role: "user",
      content: [
        ...TEXT.functionOverviewUserMessages,
        functionCallOverviewJsonTemplate,
        TEXT.schemaIntro,
        JSON.stringify(functionCallOverviewJsonSchema),
        `${TEXT.repositoryUrl}${repositoryContext.repositoryUrl}`,
        `${TEXT.repositoryDescription}${
          repositoryContext.repositoryDescription?.trim() || TEXT.noDescription
        }`,
        `${TEXT.repositorySummary}${analysisResult.summary || TEXT.noSummary}`,
        `${TEXT.primaryLanguages}${
          analysisResult.primaryLanguages.join("、") || TEXT.noLanguages
        }`,
        `${TEXT.techStack}${
          analysisResult.techStack.join("、") || TEXT.noTechStack
        }`,
        `${TEXT.verifiedEntryPoint}${verifiedEntryPoint}`,
        ...projectIntroductionLines,
        `${TEXT.totalLines}${entryExcerpt.totalLines}`,
        `${TEXT.analyzedLines}${entryExcerpt.analyzedLines}`,
        `${TEXT.truncated}${entryExcerpt.truncated ? TEXT.yes : TEXT.no}`,
        TEXT.entryFileContent,
        entryExcerpt.content,
        TEXT.repoPathsIntro,
        ...filePaths.map((path) => `- ${path}`),
      ].join("\n"),
    },
  ];
}

function buildProjectIntroductionLines(
  projectIntroduction: ProjectIntroductionExcerpt,
): string[] {
  return projectIntroduction.excerpt
    ? [
        `${TEXT.projectIntroductionFile}${
          projectIntroduction.path ?? TEXT.noDescription
        }`,
        `${TEXT.totalLines}${projectIntroduction.excerpt.totalLines}`,
        `${TEXT.analyzedLines}${projectIntroduction.excerpt.analyzedLines}`,
        `${TEXT.truncated}${
          projectIntroduction.excerpt.truncated ? TEXT.yes : TEXT.no
        }`,
        TEXT.projectIntroduction,
        projectIntroduction.excerpt.content,
      ]
    : [TEXT.projectIntroductionUnavailable];
}

function normalizeFunctionLocationGuessResult(
  value: unknown,
): FunctionLocationGuessResult {
  if (!value || typeof value !== "object") {
    throw new Error("函数文件定位结果必须是 JSON 对象。");
  }

  const result = value as Record<string, unknown>;

  if (!Array.isArray(result.candidatePaths)) {
    throw new Error("函数文件定位结果字段 candidatePaths 必须是数组。");
  }

  if (typeof result.reason !== "string" || !result.reason.trim()) {
    throw new Error("函数文件定位结果字段 reason 必须是非空字符串。");
  }

  return {
    candidatePaths: Array.from(
      new Set(
        result.candidatePaths
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ).slice(0, MAX_FUNCTION_LOCATION_GUESS_PATHS),
    reason: result.reason.trim(),
  };
}

function buildFunctionLocationGuessMessages(args: {
  repositoryContext: RepositoryAnalysisContext;
  analysisResult: AIAnalysisResult;
  functionName: string;
  parentFunctionName: string;
  parentFilePath: string | null;
  hintedFilePath: string | null;
  filePaths: string[];
}): OpenAIMessage[] {
  const {
    repositoryContext,
    analysisResult,
    functionName,
    parentFunctionName,
    parentFilePath,
    hintedFilePath,
    filePaths,
  } = args;

  return [
    {
      role: "system",
      content: FUNCTION_LOCATION_GUESS_SYSTEM_MESSAGES.join(" "),
    },
    {
      role: "user",
      content: [
        ...FUNCTION_LOCATION_GUESS_USER_MESSAGES,
        functionLocationGuessJsonTemplate,
        TEXT.schemaIntro,
        JSON.stringify(functionLocationGuessJsonSchema),
        `${TEXT.repositoryUrl}${repositoryContext.repositoryUrl}`,
        `${TEXT.repositoryDescription}${
          repositoryContext.repositoryDescription?.trim() || TEXT.noDescription
        }`,
        `${TEXT.repositorySummary}${analysisResult.summary || TEXT.noSummary}`,
        `目标函数：${functionName}`,
        `上级函数：${parentFunctionName}`,
        `上级函数所在文件：${parentFilePath ?? TEXT.noDescription}`,
        `已有候选文件提示：${hintedFilePath ?? TEXT.noDescription}`,
        TEXT.repoPathsIntro,
        ...filePaths.map((path) => `- ${path}`),
      ].join("\n"),
    },
  ];
}

function buildFunctionDrillDownMessages(args: {
  repositoryContext: RepositoryAnalysisContext;
  analysisResult: AIAnalysisResult;
  targetFunction: FunctionCallNode;
  parentFunctionName: string;
  callPath: string[];
  location: FunctionDefinitionMatch;
  snippetExcerpt: PreparedFileExcerpt;
  projectIntroduction: ProjectIntroductionExcerpt;
  filePaths: string[];
}): OpenAIMessage[] {
  const {
    repositoryContext,
    analysisResult,
    targetFunction,
    parentFunctionName,
    callPath,
    location,
    snippetExcerpt,
    projectIntroduction,
    filePaths,
  } = args;

  return [
    {
      role: "system",
      content: FUNCTION_DRILL_DOWN_SYSTEM_MESSAGES.join(" "),
    },
    {
      role: "user",
      content: [
        ...FUNCTION_DRILL_DOWN_USER_MESSAGES,
        functionCallDrillDownJsonTemplate,
        TEXT.schemaIntro,
        JSON.stringify(functionCallDrillDownJsonSchema),
        `${TEXT.repositoryUrl}${repositoryContext.repositoryUrl}`,
        `${TEXT.repositoryDescription}${
          repositoryContext.repositoryDescription?.trim() || TEXT.noDescription
        }`,
        `${TEXT.repositorySummary}${analysisResult.summary || TEXT.noSummary}`,
        `${TEXT.primaryLanguages}${
          analysisResult.primaryLanguages.join("、") || TEXT.noLanguages
        }`,
        `${TEXT.techStack}${
          analysisResult.techStack.join("、") || TEXT.noTechStack
        }`,
        `${TEXT.verifiedEntryPoint}${
          analysisResult.verifiedEntryPoint ?? TEXT.noDescription
        }`,
        `调用路径：${callPath.join(" -> ")}`,
        ...buildProjectIntroductionLines(projectIntroduction),
        `当前函数：${targetFunction.name}`,
        `上级函数：${parentFunctionName}`,
        `函数定义文件：${location.filePath}`,
        `函数起始行：${location.line}`,
        `${TEXT.totalLines}${location.totalLines}`,
        `提取到的函数片段行数：${location.extractedLines}`,
        `${TEXT.analyzedLines}${snippetExcerpt.analyzedLines}`,
        `${TEXT.truncated}${snippetExcerpt.truncated ? TEXT.yes : TEXT.no}`,
        "函数代码片段：",
        snippetExcerpt.content,
        TEXT.repoPathsIntro,
        ...filePaths.map((path) => `- ${path}`),
      ].join("\n"),
    },
  ];
}

function extractErrorMessage(rawBody: string): string | null {
  try {
    const payload = JSON.parse(rawBody) as unknown;

    if (!isRecord(payload)) {
      return null;
    }

    const error = payload.error;
    if (isRecord(error) && typeof error.message === "string") {
      return error.message;
    }

    if (typeof payload.message === "string") {
      return payload.message;
    }
  } catch {
    // Ignore JSON parse errors and fall back to plain text.
  }

  const fallback = rawBody.trim();
  return fallback || null;
}

function extractMessageContent(payload: unknown): string | null {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    return null;
  }

  const firstChoice = payload.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    return null;
  }

  const content = firstChoice.message.content;

  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const text = content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (!isRecord(part)) {
        return "";
      }

      if (typeof part.text === "string") {
        return part.text;
      }

      return "";
    })
    .join("")
    .trim();

  return text || null;
}

function shouldRetryWithoutStructuredOutput(
  status: number,
  errorMessage: string,
  rawBody: string,
): boolean {
  if (![400, 404, 415, 422].includes(status)) {
    return false;
  }

  const combinedText = `${errorMessage}\n${rawBody}`.toLowerCase();

  return (
    combinedText.includes("response_format") ||
    combinedText.includes("json_schema") ||
    combinedText.includes("json_object") ||
    combinedText.includes("not supported") ||
    combinedText.includes("unsupported")
  );
}

function unwrapJsonPayload(rawContent: string): string {
  const trimmed = rawContent.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace >= firstBrace) {
    return candidate.slice(firstBrace, lastBrace + 1);
  }

  return candidate;
}

async function requestChatCompletion(
  endpoint: string,
  apiKey: string,
  payload: Record<string, unknown>,
  mode: AttemptMode,
): Promise<CompletionAttemptResult> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const rawBody = await response.text();
  const responsePayload = parseResponsePayload(rawBody);

  if (!response.ok) {
    return {
      ok: false,
      mode,
      requestPayload: payload,
      responsePayload,
      status: response.status,
      errorMessage:
        extractErrorMessage(rawBody) ||
        `${TEXT.requestFailedPrefix}${response.status}${TEXT.fullStop}`,
      rawBody,
    };
  }

  if (!isRecord(responsePayload)) {
    return {
      ok: false,
      mode,
      requestPayload: payload,
      responsePayload,
      status: response.status,
      errorMessage: TEXT.invalidResponseJson,
      rawBody,
    };
  }

  const content = extractMessageContent(responsePayload);
  if (!content) {
    return {
      ok: false,
      mode,
      requestPayload: payload,
      responsePayload,
      status: response.status,
      errorMessage: TEXT.emptyContent,
      rawBody,
    };
  }

  return {
    ok: true,
    mode,
    requestPayload: payload,
    responsePayload,
    status: response.status,
    content,
  };
}

function createAttemptDebug(
  attempt: CompletionAttemptResult,
): AIModelDebugAttempt {
  return {
    mode: attempt.mode,
    ok: attempt.ok,
    status: attempt.status,
    request: attempt.requestPayload,
    response: attempt.responsePayload,
  };
}

function splitLines(content: string): string[] {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function findProjectIntroductionPath(filePaths: string[]): string | null {
  const rootReadme = filePaths.find((path) => /^readme\.(md|mdx|txt)$/i.test(path));

  if (rootReadme) {
    return rootReadme;
  }

  return (
    filePaths.find((path) => /(^|\/)readme\.(md|mdx|txt)$/i.test(path)) ?? null
  );
}

function prepareFileExcerpt(
  content: string,
  options?: PreparedFileExcerptOptions,
): PreparedFileExcerpt {
  const directLineLimit =
    options?.directLineLimit ?? FILE_DIRECT_READ_LINE_LIMIT;
  const segmentLineCount =
    options?.segmentLineCount ?? FILE_SEGMENT_LINE_COUNT;
  const lines = splitLines(content);
  const totalLines = lines.length;

  if (totalLines <= directLineLimit) {
    return {
      content,
      totalLines,
      analyzedLines: totalLines,
      truncated: false,
    };
  }

  const headLines = lines.slice(0, segmentLineCount);
  const tailLines = lines.slice(-segmentLineCount);
  const omittedLineCount = Math.max(
    totalLines - headLines.length - tailLines.length,
    0,
  );

  return {
    content: [
      ...headLines,
      TEXT.truncatedGapPrefix + omittedLineCount + TEXT.truncatedGapSuffix,
      ...tailLines,
    ].join("\n"),
    totalLines,
    analyzedLines: headLines.length + tailLines.length,
    truncated: true,
  };
}

class AIModelInvocationError extends Error {
  debug: AIModelDebugData;

  constructor(message: string, debug: AIModelDebugData) {
    super(message);
    this.name = "AIModelInvocationError";
    this.debug = debug;
  }
}

async function requestJsonCompletion<T>({
  model,
  messages,
  schemaName,
  schema,
  normalize,
}: JsonCompletionOptions<T>): Promise<{ result: T; debug: AIModelDebugData }> {
  const { apiKey, baseUrl } = getOpenAICompatibleConfig();
  const endpoint = resolveChatCompletionsUrl(baseUrl);
  const attempts: AIModelDebugAttempt[] = [];
  const basePayload: Record<string, unknown> = {
    model,
    temperature: 0.1,
    messages,
  };

  let result = await requestChatCompletion(
    endpoint,
    apiKey,
    {
      ...basePayload,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: schemaName,
          strict: true,
          schema,
        },
      },
    },
    "json_schema",
  );
  attempts.push(createAttemptDebug(result));

  if (
    !result.ok &&
    shouldRetryWithoutStructuredOutput(
      result.status,
      result.errorMessage,
      result.rawBody,
    )
  ) {
    result = await requestChatCompletion(
      endpoint,
      apiKey,
      basePayload,
      "plain_json",
    );
    attempts.push(createAttemptDebug(result));
  }

  const debug: AIModelDebugData = {
    endpoint,
    model,
    fallbackUsed: attempts.some((attempt) => attempt.mode === "plain_json"),
    attempts,
  };

  if (!result.ok) {
    throw new AIModelInvocationError(result.errorMessage, debug);
  }

  const jsonText = unwrapJsonPayload(result.content);
  let parsedResult: unknown;

  try {
    parsedResult = JSON.parse(jsonText) as unknown;
  } catch {
    throw new AIModelInvocationError(TEXT.invalidContentJson, debug);
  }

  try {
    return {
      result: normalize(parsedResult),
      debug,
    };
  } catch (error) {
    throw new AIModelInvocationError(
      error instanceof Error ? error.message : TEXT.invalidResult,
      debug,
    );
  }
}

function createCachedFileContentLoader(
  repositoryContext: RepositoryAnalysisContext,
): (path: string) => Promise<string> {
  const cache = new Map<string, Promise<string>>();

  return (path: string) => {
    const cached = cache.get(path);

    if (cached) {
      return cached;
    }

    const request = getFileContent(
      repositoryContext.owner,
      repositoryContext.repo,
      repositoryContext.branch,
      path,
    ).catch((error) => {
      cache.delete(path);
      throw error;
    });

    cache.set(path, request);
    return request;
  };
}

function buildLocationGuessPromptPaths(args: {
  filePaths: string[];
  functionName: string;
  parentFilePath: string | null;
  hintedFilePath: string | null;
}): string[] {
  return createRankedFunctionSearchPaths({
    filePaths: args.filePaths,
    functionName: args.functionName,
    parentFilePath: args.parentFilePath,
    hintedFilePath: args.hintedFilePath,
  }).slice(0, MAX_LOCATION_GUESS_PROMPT_PATHS);
}

function buildDrillDownPromptPaths(args: {
  node: FunctionCallNode;
  parentFilePath: string | null;
  resolvedFilePath: string;
  context: FunctionDrillDownContext;
}): string[] {
  const rankedPaths = createRankedFunctionSearchPaths({
    filePaths: args.context.searchFilePaths,
    functionName: args.node.name,
    parentFilePath: args.parentFilePath,
    hintedFilePath: args.resolvedFilePath,
  });

  return Array.from(
    new Set(
      [
        args.resolvedFilePath,
        args.parentFilePath,
        ...rankedPaths,
        ...args.context.promptFilePaths,
      ].filter((path): path is string => Boolean(path)),
    ),
  ).slice(0, MAX_DRILL_DOWN_PROMPT_PATHS);
}

async function locateFunctionDefinition(args: {
  repositoryContext: RepositoryAnalysisContext;
  analysisResult: AIAnalysisResult;
  functionName: string;
  parentFunctionName: string;
  parentFilePath: string | null;
  hintedFilePath: string | null;
  promptFilePaths: string[];
  searchFilePaths: string[];
  loadFileContent: (path: string) => Promise<string>;
}): Promise<{
  location: FunctionDefinitionMatch | null;
  attempts: FunctionLocationAttempt[];
}> {
  const attempts: FunctionLocationAttempt[] = [];
  const searchablePaths = args.searchFilePaths.filter((path) =>
    isSearchableFunctionFile(path),
  );
  const promptSearchablePaths = buildLocationGuessPromptPaths({
    filePaths: searchablePaths,
    functionName: args.functionName,
    parentFilePath: args.parentFilePath,
    hintedFilePath: args.hintedFilePath,
  });
  const availableSearchablePaths = new Set(searchablePaths);

  if (
    args.parentFilePath &&
    availableSearchablePaths.has(args.parentFilePath)
  ) {
    const sameFileMatch = await searchFunctionDefinitionInFiles({
      filePaths: [args.parentFilePath],
      loadFileContent: args.loadFileContent,
      functionName: args.functionName,
      strategy: "same_file",
    });

    attempts.push({
      strategy: "same_file",
      candidatePaths: [args.parentFilePath],
      matchedFilePath: sameFileMatch?.filePath ?? null,
      matchedLine: sameFileMatch?.line ?? null,
      reason: sameFileMatch
        ? "已在上级函数所在文件中定位到定义。"
        : "未在上级函数同文件中定位到目标函数定义。",
    });

    if (sameFileMatch) {
      return {
        location: sameFileMatch,
        attempts,
      };
    }
  }

  const hintedCandidatePath =
    args.hintedFilePath && availableSearchablePaths.has(args.hintedFilePath)
      ? args.hintedFilePath
      : null;
  let guessedPaths: string[] = hintedCandidatePath ? [hintedCandidatePath] : [];
  let guessReason = hintedCandidatePath
    ? "沿用上一轮分析给出的候选文件提示。"
    : "尚无可用的候选文件提示。";

  try {
    const guessed = await requestJsonCompletion<FunctionLocationGuessResult>({
      model: DEFAULT_FUNCTION_CALL_ANALYSIS_MODEL,
      messages: buildFunctionLocationGuessMessages({
        repositoryContext: args.repositoryContext,
        analysisResult: args.analysisResult,
        functionName: args.functionName,
        parentFunctionName: args.parentFunctionName,
        parentFilePath: args.parentFilePath,
        hintedFilePath: args.hintedFilePath,
        filePaths: promptSearchablePaths,
      }),
      schemaName: "function_location_guess",
      schema: functionLocationGuessJsonSchema as Record<string, unknown>,
      normalize: normalizeFunctionLocationGuessResult,
    });

    guessedPaths = Array.from(
      new Set(
        [
          ...(hintedCandidatePath ? [hintedCandidatePath] : []),
          ...guessed.result.candidatePaths,
        ].filter((path) => availableSearchablePaths.has(path)),
      ),
    );
    guessReason = guessed.result.reason;
  } catch (error) {
    if (error instanceof AIModelInvocationError) {
      guessReason = `AI 未能完成候选文件推断：${error.message}`;
    } else {
      throw error;
    }
  }

  if (guessedPaths.length > 0) {
    const guessedMatch = await searchFunctionDefinitionInFiles({
      filePaths: guessedPaths,
      loadFileContent: args.loadFileContent,
      functionName: args.functionName,
      strategy: "ai_guess",
    });

    attempts.push({
      strategy: "ai_guess",
      candidatePaths: guessedPaths,
      matchedFilePath: guessedMatch?.filePath ?? null,
      matchedLine: guessedMatch?.line ?? null,
      reason: guessedMatch
        ? `根据 AI 推断的候选文件成功定位函数。${guessReason}`
        : `AI 推断的候选文件中未找到目标函数定义。${guessReason}`,
    });

    if (guessedMatch) {
      return {
        location: guessedMatch,
        attempts,
      };
    }
  } else {
    attempts.push({
      strategy: "ai_guess",
      candidatePaths: [],
      matchedFilePath: null,
      matchedLine: null,
      reason: guessReason,
    });
  }

  const projectSearchPaths = createRankedFunctionSearchPaths({
    filePaths: searchablePaths,
    functionName: args.functionName,
    parentFilePath: args.parentFilePath,
    hintedFilePath: args.hintedFilePath,
  });
  const projectSearchMatch = await searchFunctionDefinitionInFiles({
    filePaths: projectSearchPaths,
    loadFileContent: args.loadFileContent,
    functionName: args.functionName,
    strategy: "project_search",
  });

  attempts.push({
    strategy: "project_search",
    candidatePaths: projectSearchPaths,
    matchedFilePath: projectSearchMatch?.filePath ?? null,
    matchedLine: projectSearchMatch?.line ?? null,
    reason: projectSearchMatch
      ? "已通过项目级正则搜索定位到目标函数定义。"
      : "项目级正则搜索未找到目标函数定义。",
  });

  return {
    location: projectSearchMatch,
    attempts,
  };
}

async function drillDownFunctionNode(args: {
  node: FunctionCallNode;
  parentFunctionName: string;
  parentFilePath: string | null;
  callPath: string[];
  depth: number;
  context: FunctionDrillDownContext;
}): Promise<FunctionDrillDownResult> {
  const { node, parentFunctionName, parentFilePath, callPath, depth, context } =
    args;

  if (shouldStopDrillDownNode({ node, depth, context })) {
    return {
      node: markNodeAsStopped(node),
      analyzedDepth: Math.min(depth - 1, context.maxDepth),
    };
  }

  const visitKey = buildDrillDownVisitKey(node);
  if (context.visitedNodeKeys.has(visitKey)) {
    return {
      node: markNodeAsStopped(node),
      analyzedDepth: Math.min(depth - 1, context.maxDepth),
    };
  }
  context.visitedNodeKeys.add(visitKey);

  const located = await locateFunctionDefinition({
    repositoryContext: context.repositoryContext,
    analysisResult: context.analysisResult,
    functionName: node.name,
    parentFunctionName,
    parentFilePath,
    hintedFilePath: node.filePath,
    promptFilePaths: context.promptFilePaths,
    searchFilePaths: context.searchFilePaths,
    loadFileContent: context.loadFileContent,
  });

  if (!located.location) {
    return {
      node: markNodeAsStopped(node),
      analyzedDepth: depth,
    };
  }

  const snippetExcerpt = prepareFileExcerpt(located.location.snippet, {
    directLineLimit: FUNCTION_SNIPPET_DIRECT_READ_LINE_LIMIT,
    segmentLineCount: FUNCTION_SNIPPET_SEGMENT_LINE_COUNT,
  });
  const drillDownPromptPaths = buildDrillDownPromptPaths({
    node,
    parentFilePath,
    resolvedFilePath: located.location.filePath,
    context,
  });

  try {
    const drillDown = await requestJsonCompletion<FunctionCallNode>({
      model: DEFAULT_FUNCTION_CALL_ANALYSIS_MODEL,
      messages: buildFunctionDrillDownMessages({
        repositoryContext: context.repositoryContext,
        analysisResult: context.analysisResult,
        targetFunction: node,
        parentFunctionName,
        callPath,
        location: located.location,
        snippetExcerpt,
        projectIntroduction: context.projectIntroduction,
        filePaths: drillDownPromptPaths,
      }),
      schemaName: "function_call_drill_down",
      schema: functionCallDrillDownJsonSchema as Record<string, unknown>,
      normalize: normalizeFunctionCallNode,
    });

    const normalizedNode: FunctionCallNode = {
      ...drillDown.result,
      name: node.name,
      filePath: located.location.filePath,
      children: drillDown.result.children.slice(0, MAX_KEY_SUB_FUNCTIONS),
    };

    if (normalizedNode.shouldDive === -1 || normalizedNode.children.length === 0) {
      return {
        node: markNodeAsStopped(normalizedNode, located.location.filePath),
        analyzedDepth: depth,
      };
    }

    const resolvedChildren: FunctionCallNode[] = [];
    let analyzedDepth = depth;

    for (const child of normalizedNode.children) {
      const childResult = await drillDownFunctionNode({
        node: child,
        parentFunctionName: normalizedNode.name,
        parentFilePath: located.location.filePath,
        callPath: [...callPath, child.name],
        depth: depth + 1,
        context,
      });
      resolvedChildren.push(childResult.node);
      analyzedDepth = Math.max(analyzedDepth, childResult.analyzedDepth);
    }

    return {
      node: {
        ...normalizedNode,
        children: resolvedChildren,
      },
      analyzedDepth,
    };
  } catch (error) {
    if (error instanceof AIModelInvocationError) {
      return {
        node: markNodeAsStopped(node, located.location.filePath),
        analyzedDepth: depth,
      };
    }

    throw error;
  }
}

async function loadProjectIntroductionExcerpt(args: {
  repositoryContext: RepositoryAnalysisContext;
  filePaths: string[];
}): Promise<ProjectIntroductionExcerpt> {
  const readmePath = findProjectIntroductionPath(args.filePaths);

  if (!readmePath) {
    return {
      path: null,
      excerpt: null,
    };
  }

  try {
    const content = await getFileContent(
      args.repositoryContext.owner,
      args.repositoryContext.repo,
      args.repositoryContext.branch,
      readmePath,
    );

    return {
      path: readmePath,
      excerpt: prepareFileExcerpt(content, {
        directLineLimit: PROJECT_INTRO_DIRECT_READ_LINE_LIMIT,
        segmentLineCount: PROJECT_INTRO_SEGMENT_LINE_COUNT,
      }),
    };
  } catch {
    return {
      path: readmePath,
      excerpt: null,
    };
  }
}

async function verifyEntryPoints(args: {
  repositoryContext: RepositoryAnalysisContext;
  analysisResult: AIAnalysisResult;
  availablePaths: Set<string>;
}): Promise<EntryVerificationOutcome> {
  const { repositoryContext, analysisResult, availablePaths } = args;
  const reviewAttempts: EntryPointReviewAttempt[] = [];

  for (const candidatePath of analysisResult.entryPoints) {
    if (!availablePaths.has(candidatePath)) {
      reviewAttempts.push({
        candidatePath,
        totalLines: 0,
        analyzedLines: 0,
        truncated: false,
        outcome: "skipped",
        failureStage: null,
        reason: TEXT.candidateMissing,
        reviewResult: null,
        debug: null,
      });
      continue;
    }

    let excerpt: PreparedFileExcerpt;

    try {
      const fileContent = await getFileContent(
        repositoryContext.owner,
        repositoryContext.repo,
        repositoryContext.branch,
        candidatePath,
      );
      excerpt = prepareFileExcerpt(fileContent);
    } catch (error) {
      reviewAttempts.push({
        candidatePath,
        totalLines: 0,
        analyzedLines: 0,
        truncated: false,
        outcome: "error",
        failureStage: "read_file",
        reason: `${TEXT.entryFileReadFailedPrefix}${
          error instanceof Error ? error.message : String(error)
        }`,
        reviewResult: null,
        debug: null,
      });
      continue;
    }

    try {
      const review = await requestJsonCompletion<EntryPointReviewResult>({
        model: DEFAULT_ENTRY_POINT_REVIEW_MODEL,
        messages: buildEntryReviewMessages({
          repositoryContext,
          analysisResult,
          candidatePath,
          excerpt,
        }),
        schemaName: "entry_point_review",
        schema: entryPointReviewJsonSchema as Record<string, unknown>,
        normalize: normalizeEntryPointReviewResult,
      });

      const reviewAttempt: EntryPointReviewAttempt = {
        candidatePath,
        totalLines: excerpt.totalLines,
        analyzedLines: excerpt.analyzedLines,
        truncated: excerpt.truncated,
        outcome: review.result.isEntryPoint ? "verified" : "rejected",
        failureStage: null,
        reason: review.result.reason,
        reviewResult: review.result,
        debug: review.debug,
      };
      reviewAttempts.push(reviewAttempt);

      if (review.result.isEntryPoint) {
        return {
          verifiedEntryPoint: candidatePath,
          verifiedEntryPointReason: review.result.reason,
          debug: {
            attempts: reviewAttempts,
            verifiedEntryPoint: candidatePath,
            verifiedEntryPointReason: review.result.reason,
          },
        };
      }
    } catch (error) {
      if (error instanceof AIModelInvocationError) {
        reviewAttempts.push({
          candidatePath,
          totalLines: excerpt.totalLines,
          analyzedLines: excerpt.analyzedLines,
          truncated: excerpt.truncated,
          outcome: "error",
          failureStage: "ai_review",
          reason: error.message,
          reviewResult: null,
          debug: error.debug,
        });
        continue;
      }

      throw error;
    }
  }

  return {
    verifiedEntryPoint: null,
    verifiedEntryPointReason: null,
    debug: {
      attempts: reviewAttempts,
      verifiedEntryPoint: null,
      verifiedEntryPointReason: null,
    },
  };
}

async function analyzeFunctionOverview(args: {
  repositoryContext: RepositoryAnalysisContext;
  analysisResult: AIAnalysisResult;
  filePaths: string[];
}): Promise<FunctionOverviewOutcome> {
  const { repositoryContext, analysisResult, filePaths } = args;
  const promptFilePaths = filePaths.slice(0, MAX_ANALYSIS_PATHS);
  const verifiedEntryPoint = analysisResult.verifiedEntryPoint;
  const projectIntroduction = await loadProjectIntroductionExcerpt({
    repositoryContext,
    filePaths,
  });
  const loadFileContent = createCachedFileContentLoader(repositoryContext);

  if (!verifiedEntryPoint) {
    return {
      result: null,
      debug: {
        targetEntryPoint: null,
        readmePath: projectIntroduction.path,
        status: "skipped",
        message: TEXT.functionOverviewSkippedNoEntry,
        model: null,
      },
    };
  }

  let entryExcerpt: PreparedFileExcerpt;

  try {
    const entryContent = await loadFileContent(verifiedEntryPoint);
    entryExcerpt = prepareFileExcerpt(entryContent, {
      directLineLimit: FUNCTION_ANALYSIS_FILE_DIRECT_READ_LINE_LIMIT,
      segmentLineCount: FUNCTION_ANALYSIS_FILE_SEGMENT_LINE_COUNT,
    });
  } catch (error) {
    return {
      result: null,
      debug: {
        targetEntryPoint: verifiedEntryPoint,
        readmePath: projectIntroduction.path,
        status: "error",
        message: `${TEXT.functionOverviewEntryFileReadFailedPrefix}${
          error instanceof Error ? error.message : String(error)
        }`,
        model: null,
      },
    };
  }

  try {
    const overview = await requestJsonCompletion<FunctionCallOverview>({
      model: DEFAULT_FUNCTION_CALL_ANALYSIS_MODEL,
      messages: buildFunctionOverviewMessages({
        repositoryContext,
        analysisResult,
        verifiedEntryPoint,
        entryExcerpt,
        projectIntroduction,
        filePaths: promptFilePaths,
      }),
      schemaName: "function_call_overview",
      schema: functionCallOverviewJsonSchema as Record<string, unknown>,
      normalize: normalizeFunctionCallOverview,
    });

    if (!overview.result.root) {
      return {
        result: null,
        debug: {
          targetEntryPoint: verifiedEntryPoint,
          readmePath: projectIntroduction.path,
          status: "error",
          message: TEXT.functionOverviewRootMissing,
          model: overview.debug,
        },
      };
    }

    const rootNode = overview.result.root;
    const normalizedRootNode: FunctionCallNode = {
      ...rootNode,
      filePath: verifiedEntryPoint,
      shouldDive: 1,
      children: rootNode.children.slice(0, MAX_KEY_SUB_FUNCTIONS),
    };
    const resolvedChildren: FunctionCallNode[] = [];
    let analyzedDepth = overview.result.analyzedDepth;
    const drillDownContext: FunctionDrillDownContext = {
      repositoryContext,
      analysisResult,
      promptFilePaths,
      searchFilePaths: filePaths,
      projectIntroduction,
      loadFileContent,
      maxDepth: DEFAULT_FUNCTION_CALL_DRILL_DOWN_DEPTH,
      visitedNodeKeys: new Set<string>(),
    };

    for (const child of normalizedRootNode.children) {
      const childResult = await drillDownFunctionNode({
        node: child,
        parentFunctionName: normalizedRootNode.name,
        parentFilePath: verifiedEntryPoint,
        callPath: [normalizedRootNode.name, child.name],
        depth: 1,
        context: drillDownContext,
      });
      resolvedChildren.push(childResult.node);
      analyzedDepth = Math.max(analyzedDepth, childResult.analyzedDepth);
    }

    const normalizedResult: FunctionCallOverview = {
      analyzedDepth,
      root: {
        ...normalizedRootNode,
        children: resolvedChildren,
      },
    };

    return {
      result: normalizedResult,
      debug: {
        targetEntryPoint: verifiedEntryPoint,
        readmePath: projectIntroduction.path,
        status: "completed",
        message: `已完成函数调用链递归分析，共识别 ${
          normalizedResult.root
            ? countFunctionTreeNodes(normalizedResult.root) - 1
            : 0
        } 个非根节点，最大下钻层级 ${normalizedResult.analyzedDepth}，配置上限 ${DEFAULT_FUNCTION_CALL_DRILL_DOWN_DEPTH}。`,
        model: overview.debug,
      },
    };
  } catch (error) {
    if (error instanceof AIModelInvocationError) {
      return {
        result: null,
        debug: {
          targetEntryPoint: verifiedEntryPoint,
          readmePath: projectIntroduction.path,
          status: "error",
          message: error.message,
          model: error.debug,
        },
      };
    }

    throw error;
  }
}

export class AIAnalysisServiceError extends Error {
  debug?: RepositoryAnalysisDebugData;

  constructor(message: string, debug?: RepositoryAnalysisDebugData) {
    super(message);
    this.name = "AIAnalysisServiceError";
    this.debug = debug;
  }
}

export async function analyzeRepository(args: {
  filePaths: string[];
  repositoryContext: RepositoryAnalysisContext;
}): Promise<{ result: AIAnalysisResult; debug: RepositoryAnalysisDebugData }> {
  const { filePaths, repositoryContext } = args;
  const samplePaths = filePaths.slice(0, MAX_ANALYSIS_PATHS);

  let repositoryAnalysis: { result: AIAnalysisResult; debug: AIModelDebugData };

  try {
    repositoryAnalysis = await requestJsonCompletion<AIAnalysisResult>({
      model: DEFAULT_REPOSITORY_ANALYSIS_MODEL,
      messages: buildRepositoryAnalysisMessages(samplePaths),
      schemaName: "repository_analysis",
      schema: aiAnalysisJsonSchema as Record<string, unknown>,
      normalize: normalizeAIAnalysisResult,
    });
  } catch (error) {
    if (error instanceof AIModelInvocationError) {
      throw new AIAnalysisServiceError(error.message, {
        repositoryAnalysis: error.debug,
        entryVerification: null,
        functionOverview: null,
      });
    }

    throw error;
  }

  const entryVerification = await verifyEntryPoints({
    repositoryContext,
    analysisResult: repositoryAnalysis.result,
    availablePaths: new Set(filePaths),
  });

  const baseAnalysisResult: AIAnalysisResult = {
    ...repositoryAnalysis.result,
    verifiedEntryPoint: entryVerification.verifiedEntryPoint,
    verifiedEntryPointReason: entryVerification.verifiedEntryPointReason,
    functionCallOverview: null,
  };

  const functionOverview = await analyzeFunctionOverview({
    repositoryContext,
    analysisResult: baseAnalysisResult,
    filePaths,
  });

  return {
    result: {
      ...baseAnalysisResult,
      functionCallOverview: functionOverview.result,
    },
    debug: {
      repositoryAnalysis: repositoryAnalysis.debug,
      entryVerification: entryVerification.debug,
      functionOverview: functionOverview.debug,
    },
  };
}
