export interface RepositoryAnalysisContext {
  owner: string;
  repo: string;
  branch: string;
  repositoryUrl: string;
  repositoryDescription?: string | null;
}

export type FunctionShouldDive = -1 | 0 | 1;

export interface FunctionModule {
  id: string;
  name: string;
  summary: string;
}

export interface FunctionCallBridgeMetadata {
  bridgeId: string;
  framework: string | null;
  nodeType: string;
  routePath: string | null;
  routeMethods: string[];
}

export interface FunctionCallNode {
  name: string;
  filePath: string | null;
  summary: string;
  moduleId: string | null;
  bridgeMetadata: FunctionCallBridgeMetadata | null;
  shouldDive: FunctionShouldDive;
  children: FunctionCallNode[];
}

export interface FunctionCallOverview {
  analyzedDepth: number;
  root: FunctionCallNode | null;
}

export interface AIAnalysisResult {
  primaryLanguages: string[];
  techStack: string[];
  entryPoints: string[];
  summary: string;
  verifiedEntryPoint: string | null;
  verifiedEntryPointReason: string | null;
  functionCallOverview: FunctionCallOverview | null;
  functionModules: FunctionModule[];
}

export interface AIModelDebugAttempt {
  mode: "json_schema" | "plain_json";
  ok: boolean;
  status: number;
  request: Record<string, unknown>;
  response: unknown;
}

export interface AIModelDebugData {
  endpoint: string;
  model: string;
  fallbackUsed: boolean;
  attempts: AIModelDebugAttempt[];
}

export interface EntryPointReviewResult {
  isEntryPoint: boolean;
  reason: string;
}

export type EntryPointReviewOutcome =
  | "verified"
  | "rejected"
  | "skipped"
  | "error";

export type EntryPointReviewFailureStage = "read_file" | "ai_review" | null;

export interface EntryPointReviewAttempt {
  candidatePath: string;
  totalLines: number;
  analyzedLines: number;
  truncated: boolean;
  outcome: EntryPointReviewOutcome;
  failureStage: EntryPointReviewFailureStage;
  reason: string;
  reviewResult: EntryPointReviewResult | null;
  debug: AIModelDebugData | null;
}

export interface EntryPointVerificationDebugData {
  attempts: EntryPointReviewAttempt[];
  verifiedEntryPoint: string | null;
  verifiedEntryPointReason: string | null;
}

export type FunctionDrillDownDebugAttemptStatus = "completed" | "error";

export interface FunctionDrillDownDebugAttempt {
  nodeKey: string;
  functionName: string;
  parentFunctionName: string;
  depth: number;
  callPath: string[];
  locationFilePath: string | null;
  status: FunctionDrillDownDebugAttemptStatus;
  message: string;
  model: AIModelDebugData | null;
}

export type FunctionDrillDownCacheEventType =
  | "hit"
  | "miss"
  | "store"
  | "cycle_guard";

export interface FunctionDrillDownCacheEvent {
  nodeKey: string;
  functionName: string;
  depth: number;
  callPath: string[];
  event: FunctionDrillDownCacheEventType;
  message: string;
}

export interface FunctionCallAnalysisDebugData {
  targetEntryPoint: string | null;
  readmePath: string | null;
  status: "completed" | "skipped" | "error";
  message: string;
  model: AIModelDebugData | null;
  drillDownAttempts: FunctionDrillDownDebugAttempt[];
  cacheEvents: FunctionDrillDownCacheEvent[];
}

export interface FunctionModuleAnalysisDebugData {
  status: "completed" | "skipped" | "error";
  message: string;
  totalNodes: number;
  assignedNodes: number;
  moduleCount: number;
  model: AIModelDebugData | null;
}

export interface RepositoryAnalysisDebugData {
  repositoryAnalysis: AIModelDebugData;
  entryVerification: EntryPointVerificationDebugData | null;
  functionOverview: FunctionCallAnalysisDebugData | null;
  moduleAnalysis: FunctionModuleAnalysisDebugData | null;
}

export interface AnalyzeRepoSuccessResponse {
  result: AIAnalysisResult;
  debug: RepositoryAnalysisDebugData;
}

export interface AnalyzeRepoErrorResponse {
  error: string;
  debug?: RepositoryAnalysisDebugData;
}

export interface AnalyzeRepoDrillDownDebugData {
  functionOverview: FunctionCallAnalysisDebugData | null;
}

export interface AnalyzeRepoDrillDownSuccessResponse {
  result: AIAnalysisResult;
  debug: AnalyzeRepoDrillDownDebugData;
}

export interface AnalyzeRepoDrillDownErrorResponse {
  error: string;
  debug?: AnalyzeRepoDrillDownDebugData;
}

const TEXT = {
  primaryLanguagesDesc: "根据仓库路径推断出的主要编程语言列表。",
  techStackDesc:
    "根据文件名推断出的框架、库、构建工具、包管理器或基础设施标签。",
  entryPointsDesc:
    "可能的项目入口文件，例如 main.go、src/main.rs、src/index.ts、app/page.tsx、server.js、manage.py 或 cmd/*/main.go。",
  summaryDesc: "用 1 到 2 句话简要总结该仓库最可能实现的功能。",
  templateSummary: "这是一个根据仓库文件路径推断出的简短中文项目总结。",
  entryPointVerdictDesc: "该候选文件是否可判定为项目真实入口文件。",
  entryPointReasonDesc:
    "判断理由，必须使用简体中文，并基于提供的仓库信息和文件内容给出保守结论。",
  entryPointTemplateReason:
    "该文件定义了应用根路由页面，是用户访问项目时最直接的入口，因此可视为项目入口文件。",
  functionOverviewDepthDesc:
    "当前已分析的函数调用层级。当前版本固定为 1，表示只分析入口函数直接调用的关键子函数。",
  functionNodeNameDesc:
    "函数名；如果是匿名默认导出或模块级启动逻辑，可使用保守的入口标识名，例如 default export 或 module bootstrap。",
  functionNodeFilePathDesc:
    "函数最可能定义的文件路径；若无法根据文件列表和上下文判断，可返回 null。",
  functionNodeSummaryDesc:
    "函数功能简介，必须使用简体中文，结论要保守。",
  functionNodeShouldDiveDesc:
    "-1 表示不需要继续下钻分析，0 表示暂时无法判断，1 表示值得继续下钻分析。",
  functionCallTemplateRootSummary:
    "应用入口函数，负责初始化程序并调度核心子流程。",
  functionCallTemplateChildSummary: "负责读取配置并准备运行时依赖。",
  arrayPrefix: 'AI 分析结果字段“',
  arraySuffix: "”必须是数组。",
  objectRequired: "AI 分析结果必须是 JSON 对象。",
  summaryRequired: 'AI 分析结果字段“summary”必须是非空字符串。',
  entryPointReviewObjectRequired: "入口文件研判结果必须是 JSON 对象。",
  entryPointReviewVerdictRequired:
    '入口文件研判结果字段“isEntryPoint”必须是布尔值。',
  entryPointReviewReasonRequired:
    '入口文件研判结果字段“reason”必须是非空字符串。',
  functionOverviewObjectRequired: "函数调用全景结果必须是 JSON 对象。",
  functionOverviewDepthRequired:
    '函数调用全景结果字段“analyzedDepth”必须是大于等于 1 的整数。',
  functionOverviewRootRequired:
    '函数调用全景结果字段“root”必须是对象或 null。',
  functionNodeObjectRequired: "函数节点必须是 JSON 对象。",
  functionNodeNameRequired: '函数节点字段“name”必须是非空字符串。',
  functionNodeSummaryRequired: '函数节点字段“summary”必须是非空字符串。',
  functionNodeShouldDiveRequired:
    '函数节点字段“shouldDive”必须是 -1、0 或 1。',
  functionNodeChildrenRequired: '函数节点字段“children”必须是数组。',
} as const;

export const aiAnalysisJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    primaryLanguages: {
      type: "array",
      items: {
        type: "string",
      },
      description: TEXT.primaryLanguagesDesc,
    },
    techStack: {
      type: "array",
      items: {
        type: "string",
      },
      description: TEXT.techStackDesc,
    },
    entryPoints: {
      type: "array",
      items: {
        type: "string",
      },
      description: TEXT.entryPointsDesc,
    },
    summary: {
      type: "string",
      description: TEXT.summaryDesc,
    },
  },
  required: ["primaryLanguages", "techStack", "entryPoints", "summary"],
} as const;

export const aiAnalysisJsonTemplate = `{
  "primaryLanguages": ["TypeScript"],
  "techStack": ["Next.js", "Tailwind CSS"],
  "entryPoints": ["src/app/page.tsx", "src/app/layout.tsx"],
  "summary": "${TEXT.templateSummary}"
}`;

export const entryPointReviewJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    isEntryPoint: {
      type: "boolean",
      description: TEXT.entryPointVerdictDesc,
    },
    reason: {
      type: "string",
      description: TEXT.entryPointReasonDesc,
    },
  },
  required: ["isEntryPoint", "reason"],
} as const;

export const entryPointReviewJsonTemplate = `{
  "isEntryPoint": true,
  "reason": "${TEXT.entryPointTemplateReason}"
}`;

const functionCallLeafNodeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: {
      type: "string",
      description: TEXT.functionNodeNameDesc,
    },
    filePath: {
      type: ["string", "null"],
      description: TEXT.functionNodeFilePathDesc,
    },
    summary: {
      type: "string",
      description: TEXT.functionNodeSummaryDesc,
    },
    shouldDive: {
      type: "integer",
      enum: [-1, 0, 1],
      description: TEXT.functionNodeShouldDiveDesc,
    },
    children: {
      type: "array",
      maxItems: 0,
      items: {
        type: "string",
      },
    },
  },
  required: ["name", "filePath", "summary", "shouldDive", "children"],
} as const;

const functionCallRootNodeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: {
      type: "string",
      description: TEXT.functionNodeNameDesc,
    },
    filePath: {
      type: ["string", "null"],
      description: TEXT.functionNodeFilePathDesc,
    },
    summary: {
      type: "string",
      description: TEXT.functionNodeSummaryDesc,
    },
    shouldDive: {
      type: "integer",
      enum: [-1, 0, 1],
      description: TEXT.functionNodeShouldDiveDesc,
    },
    children: {
      type: "array",
      items: functionCallLeafNodeSchema,
    },
  },
  required: ["name", "filePath", "summary", "shouldDive", "children"],
} as const;

export const functionCallOverviewJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    analyzedDepth: {
      type: "integer",
      enum: [1],
      description: TEXT.functionOverviewDepthDesc,
    },
    root: functionCallRootNodeSchema,
  },
  required: ["analyzedDepth", "root"],
} as const;

export const functionCallOverviewJsonTemplate = `{
  "analyzedDepth": 1,
  "root": {
    "name": "main",
    "filePath": "src/main.ts",
    "summary": "${TEXT.functionCallTemplateRootSummary}",
    "shouldDive": 1,
    "children": [
      {
        "name": "loadConfig",
        "filePath": "src/config/loadConfig.ts",
        "summary": "${TEXT.functionCallTemplateChildSummary}",
        "shouldDive": 1,
        "children": []
      }
    ]
  }
}`;

export const functionCallDrillDownJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: {
      type: "string",
      description: "当前被下钻分析的函数名。",
    },
    filePath: {
      type: ["string", "null"],
      description: "当前函数定义所在文件路径；无法确认时返回 null。",
    },
    summary: {
      type: "string",
      description: "当前函数职责的简体中文摘要。",
    },
    shouldDive: {
      type: "integer",
      enum: [-1, 0, 1],
      description:
        "当前函数是否值得继续下钻：-1 表示不用继续，0 表示暂时不确定，1 表示值得继续。",
    },
    children: {
      type: "array",
      items: functionCallLeafNodeSchema,
    },
  },
  required: ["name", "filePath", "summary", "shouldDive", "children"],
} as const;

export const functionCallDrillDownJsonTemplate = `{
  "name": "loadConfig",
  "filePath": "src/config/loadConfig.ts",
  "summary": "负责读取配置并组装运行所需参数。",
  "shouldDive": 1,
  "children": [
    {
      "name": "resolveConfigPath",
      "filePath": "src/config/path.ts",
      "summary": "负责定位配置文件路径。",
      "shouldDive": -1,
      "children": []
    }
  ]
}`;

function normalizeStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${TEXT.arrayPrefix}${fieldName}${TEXT.arraySuffix}`);
  }

  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);

  return Array.from(new Set(normalized));
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  return value.trim();
}

function normalizeBridgeRouteMethods(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);

  return Array.from(new Set(normalized));
}

function normalizeFunctionCallBridgeMetadata(
  value: unknown,
): FunctionCallBridgeMetadata | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const bridgeId = normalizeOptionalString(record.bridgeId);
  const nodeType = normalizeOptionalString(record.nodeType);

  if (!bridgeId || !nodeType) {
    return null;
  }

  return {
    bridgeId,
    framework: normalizeOptionalString(record.framework),
    nodeType,
    routePath: normalizeOptionalString(record.routePath),
    routeMethods: normalizeBridgeRouteMethods(record.routeMethods),
  };
}

export function normalizeFunctionModules(value: unknown): FunctionModule[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const modules: FunctionModule[] = [];
  const seenIds = new Set<string>();

  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;
    const name = normalizeOptionalString(record.name);
    const summary = normalizeOptionalString(record.summary);

    if (!name || !summary) {
      continue;
    }

    const normalizedId =
      normalizeOptionalString(record.id) ?? `module-${index + 1}`;

    if (seenIds.has(normalizedId)) {
      continue;
    }

    seenIds.add(normalizedId);
    modules.push({
      id: normalizedId,
      name,
      summary,
    });
  }

  return modules.slice(0, 10);
}

export function normalizeFunctionCallNode(value: unknown): FunctionCallNode {
  if (!value || typeof value !== "object") {
    throw new Error(TEXT.functionNodeObjectRequired);
  }

  const node = value as Record<string, unknown>;
  const name = node.name;
  const summary = node.summary;

  if (typeof name !== "string" || !name.trim()) {
    throw new Error(TEXT.functionNodeNameRequired);
  }

  if (typeof summary !== "string" || !summary.trim()) {
    throw new Error(TEXT.functionNodeSummaryRequired);
  }

  if (node.shouldDive !== -1 && node.shouldDive !== 0 && node.shouldDive !== 1) {
    throw new Error(TEXT.functionNodeShouldDiveRequired);
  }

  if (!Array.isArray(node.children)) {
    throw new Error(TEXT.functionNodeChildrenRequired);
  }

  return {
    name: name.trim(),
    filePath: normalizeOptionalString(node.filePath),
    summary: summary.trim(),
    moduleId: normalizeOptionalString(node.moduleId),
    bridgeMetadata: normalizeFunctionCallBridgeMetadata(node.bridgeMetadata),
    shouldDive: node.shouldDive,
    children: node.children.map((child) => normalizeFunctionCallNode(child)),
  };
}

export function normalizeFunctionCallOverview(
  value: unknown,
): FunctionCallOverview {
  if (!value || typeof value !== "object") {
    throw new Error(TEXT.functionOverviewObjectRequired);
  }

  const overview = value as Record<string, unknown>;
  const analyzedDepth = overview.analyzedDepth;

  if (
    typeof analyzedDepth !== "number" ||
    !Number.isInteger(analyzedDepth) ||
    analyzedDepth < 1
  ) {
    throw new Error(TEXT.functionOverviewDepthRequired);
  }

  if (
    overview.root !== null &&
    (typeof overview.root !== "object" || overview.root === undefined)
  ) {
    throw new Error(TEXT.functionOverviewRootRequired);
  }

  return {
    analyzedDepth,
    root: overview.root === null ? null : normalizeFunctionCallNode(overview.root),
  };
}

export function normalizeAIAnalysisResult(value: unknown): AIAnalysisResult {
  if (!value || typeof value !== "object") {
    throw new Error(TEXT.objectRequired);
  }

  const result = value as Record<string, unknown>;
  const summary = result.summary;

  if (typeof summary !== "string" || !summary.trim()) {
    throw new Error(TEXT.summaryRequired);
  }

  return {
    primaryLanguages: normalizeStringArray(
      result.primaryLanguages,
      "primaryLanguages",
    ),
    techStack: normalizeStringArray(result.techStack, "techStack"),
    entryPoints: normalizeStringArray(result.entryPoints, "entryPoints"),
    summary: summary.trim(),
    verifiedEntryPoint: normalizeOptionalString(result.verifiedEntryPoint),
    verifiedEntryPointReason: normalizeOptionalString(
      result.verifiedEntryPointReason,
    ),
    functionCallOverview:
      result.functionCallOverview === undefined ||
      result.functionCallOverview === null
        ? null
        : normalizeFunctionCallOverview(result.functionCallOverview),
    functionModules: normalizeFunctionModules(result.functionModules),
  };
}

export function normalizeEntryPointReviewResult(
  value: unknown,
): EntryPointReviewResult {
  if (!value || typeof value !== "object") {
    throw new Error(TEXT.entryPointReviewObjectRequired);
  }

  const result = value as Record<string, unknown>;
  const reason = result.reason;

  if (typeof result.isEntryPoint !== "boolean") {
    throw new Error(TEXT.entryPointReviewVerdictRequired);
  }

  if (typeof reason !== "string" || !reason.trim()) {
    throw new Error(TEXT.entryPointReviewReasonRequired);
  }

  return {
    isEntryPoint: result.isEntryPoint,
    reason: reason.trim(),
  };
}

export function isAIAnalysisResult(value: unknown): value is AIAnalysisResult {
  try {
    normalizeAIAnalysisResult(value);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAIModelDebugAttempt(value: unknown): value is AIModelDebugAttempt {
  return (
    isRecord(value) &&
    (value.mode === "json_schema" || value.mode === "plain_json") &&
    typeof value.ok === "boolean" &&
    typeof value.status === "number" &&
    isRecord(value.request)
  );
}

function isAIModelDebugData(value: unknown): value is AIModelDebugData {
  return (
    isRecord(value) &&
    typeof value.endpoint === "string" &&
    typeof value.model === "string" &&
    typeof value.fallbackUsed === "boolean" &&
    Array.isArray(value.attempts) &&
    value.attempts.every(isAIModelDebugAttempt)
  );
}

function isEntryPointReviewAttempt(
  value: unknown,
): value is EntryPointReviewAttempt {
  return (
    isRecord(value) &&
    typeof value.candidatePath === "string" &&
    typeof value.totalLines === "number" &&
    typeof value.analyzedLines === "number" &&
    typeof value.truncated === "boolean" &&
    (value.outcome === "verified" ||
      value.outcome === "rejected" ||
      value.outcome === "skipped" ||
      value.outcome === "error") &&
    (value.failureStage === null ||
      value.failureStage === "read_file" ||
      value.failureStage === "ai_review") &&
    typeof value.reason === "string" &&
    (value.reviewResult === null || isRecord(value.reviewResult)) &&
    (value.debug === null || isAIModelDebugData(value.debug))
  );
}

function isEntryPointVerificationDebugData(
  value: unknown,
): value is EntryPointVerificationDebugData {
  return (
    isRecord(value) &&
    Array.isArray(value.attempts) &&
    value.attempts.every(isEntryPointReviewAttempt) &&
    (value.verifiedEntryPoint === null ||
      typeof value.verifiedEntryPoint === "string") &&
    (value.verifiedEntryPointReason === null ||
      typeof value.verifiedEntryPointReason === "string")
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isFunctionDrillDownDebugAttempt(
  value: unknown,
): value is FunctionDrillDownDebugAttempt {
  return (
    isRecord(value) &&
    typeof value.nodeKey === "string" &&
    typeof value.functionName === "string" &&
    typeof value.parentFunctionName === "string" &&
    typeof value.depth === "number" &&
    isStringArray(value.callPath) &&
    (value.locationFilePath === null || typeof value.locationFilePath === "string") &&
    (value.status === "completed" || value.status === "error") &&
    typeof value.message === "string" &&
    (value.model === null || isAIModelDebugData(value.model))
  );
}

function isFunctionDrillDownCacheEvent(
  value: unknown,
): value is FunctionDrillDownCacheEvent {
  return (
    isRecord(value) &&
    typeof value.nodeKey === "string" &&
    typeof value.functionName === "string" &&
    typeof value.depth === "number" &&
    isStringArray(value.callPath) &&
    (value.event === "hit" ||
      value.event === "miss" ||
      value.event === "store" ||
      value.event === "cycle_guard") &&
    typeof value.message === "string"
  );
}

function isFunctionCallAnalysisDebugData(
  value: unknown,
): value is FunctionCallAnalysisDebugData {
  return (
    isRecord(value) &&
    (value.targetEntryPoint === null ||
      typeof value.targetEntryPoint === "string") &&
    (value.readmePath === null || typeof value.readmePath === "string") &&
    (value.status === "completed" ||
      value.status === "skipped" ||
      value.status === "error") &&
    typeof value.message === "string" &&
    (value.model === null || isAIModelDebugData(value.model)) &&
    (Array.isArray(value.drillDownAttempts)
      ? value.drillDownAttempts.every(isFunctionDrillDownDebugAttempt)
      : value.drillDownAttempts === undefined) &&
    (Array.isArray(value.cacheEvents)
      ? value.cacheEvents.every(isFunctionDrillDownCacheEvent)
      : value.cacheEvents === undefined)
  );
}

function isFunctionModuleAnalysisDebugData(
  value: unknown,
): value is FunctionModuleAnalysisDebugData {
  return (
    isRecord(value) &&
    (value.status === "completed" ||
      value.status === "skipped" ||
      value.status === "error") &&
    typeof value.message === "string" &&
    typeof value.totalNodes === "number" &&
    typeof value.assignedNodes === "number" &&
    typeof value.moduleCount === "number" &&
    (value.model === null || isAIModelDebugData(value.model))
  );
}

export function isRepositoryAnalysisDebugData(
  value: unknown,
): value is RepositoryAnalysisDebugData {
  return (
    isRecord(value) &&
    isAIModelDebugData(value.repositoryAnalysis) &&
    (value.entryVerification === null ||
      isEntryPointVerificationDebugData(value.entryVerification)) &&
    (value.functionOverview === null ||
      isFunctionCallAnalysisDebugData(value.functionOverview)) &&
    (value.moduleAnalysis === null ||
      isFunctionModuleAnalysisDebugData(value.moduleAnalysis))
  );
}

export function isAnalyzeRepoSuccessResponse(
  value: unknown,
): value is AnalyzeRepoSuccessResponse {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isAIAnalysisResult(value.result) && isRepositoryAnalysisDebugData(value.debug)
  );
}

export function isAnalyzeRepoErrorResponse(
  value: unknown,
): value is AnalyzeRepoErrorResponse {
  return (
    isRecord(value) &&
    typeof value.error === "string" &&
    (value.debug === undefined || isRepositoryAnalysisDebugData(value.debug))
  );
}

function isAnalyzeRepoDrillDownDebugData(
  value: unknown,
): value is AnalyzeRepoDrillDownDebugData {
  return (
    isRecord(value) &&
    (value.functionOverview === null ||
      isFunctionCallAnalysisDebugData(value.functionOverview))
  );
}

export function isAnalyzeRepoDrillDownSuccessResponse(
  value: unknown,
): value is AnalyzeRepoDrillDownSuccessResponse {
  return (
    isRecord(value) &&
    isAIAnalysisResult(value.result) &&
    isAnalyzeRepoDrillDownDebugData(value.debug)
  );
}

export function isAnalyzeRepoDrillDownErrorResponse(
  value: unknown,
): value is AnalyzeRepoDrillDownErrorResponse {
  return (
    isRecord(value) &&
    typeof value.error === "string" &&
    (value.debug === undefined ||
      isAnalyzeRepoDrillDownDebugData(value.debug))
  );
}
