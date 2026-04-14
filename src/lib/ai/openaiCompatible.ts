import "server-only";

import { getFileContent } from "@/lib/githubApi";
import {
  aiAnalysisJsonSchema,
  aiAnalysisJsonTemplate,
  entryPointReviewJsonSchema,
  entryPointReviewJsonTemplate,
  functionCallOverviewJsonSchema,
  functionCallOverviewJsonTemplate,
  normalizeAIAnalysisResult,
  normalizeEntryPointReviewResult,
  normalizeFunctionCallOverview,
  type AIAnalysisResult,
  type AIModelDebugAttempt,
  type AIModelDebugData,
  type EntryPointReviewAttempt,
  type EntryPointReviewResult,
  type EntryPointVerificationDebugData,
  type FunctionCallAnalysisDebugData,
  type FunctionCallOverview,
  type RepositoryAnalysisContext,
  type RepositoryAnalysisDebugData,
} from "@/types/aiAnalysis";

const DEFAULT_REPOSITORY_ANALYSIS_MODEL =
  process.env.OPENAI_COMPAT_MODEL?.trim() || "gpt-5.4";
const DEFAULT_ENTRY_POINT_REVIEW_MODEL =
  process.env.OPENAI_COMPAT_ENTRY_MODEL?.trim() ||
  DEFAULT_REPOSITORY_ANALYSIS_MODEL;
const DEFAULT_FUNCTION_CALL_ANALYSIS_MODEL =
  process.env.OPENAI_COMPAT_FUNCTION_MODEL?.trim() ||
  DEFAULT_REPOSITORY_ANALYSIS_MODEL;
const MAX_ANALYSIS_PATHS = 1000;
const FILE_DIRECT_READ_LINE_LIMIT = 4000;
const FILE_SEGMENT_LINE_COUNT = 2000;
const FUNCTION_ANALYSIS_FILE_DIRECT_READ_LINE_LIMIT = 2000;
const FUNCTION_ANALYSIS_FILE_SEGMENT_LINE_COUNT = 1000;
const PROJECT_INTRO_DIRECT_READ_LINE_LIMIT = 300;
const PROJECT_INTRO_SEGMENT_LINE_COUNT = 150;
const MAX_KEY_SUB_FUNCTIONS = 20;

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
  const verifiedEntryPoint = analysisResult.verifiedEntryPoint;
  const projectIntroduction = await loadProjectIntroductionExcerpt({
    repositoryContext,
    filePaths,
  });

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
    const entryContent = await getFileContent(
      repositoryContext.owner,
      repositoryContext.repo,
      repositoryContext.branch,
      verifiedEntryPoint,
    );
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
        filePaths,
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
    const normalizedResult: FunctionCallOverview = {
      ...overview.result,
      root: {
        ...rootNode,
        filePath: verifiedEntryPoint,
        shouldDive: 1,
        children: rootNode.children.slice(0, MAX_KEY_SUB_FUNCTIONS),
      },
    };

    return {
      result: normalizedResult,
      debug: {
        targetEntryPoint: verifiedEntryPoint,
        readmePath: projectIntroduction.path,
        status: "completed",
        message: `${TEXT.functionOverviewSuccessPrefix}${
          normalizedResult.root ? normalizedResult.root.children.length : 0
        }${TEXT.functionOverviewSuccessSuffix}`,
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
    filePaths: samplePaths,
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
