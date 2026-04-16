import {
  normalizeAIAnalysisResult,
  normalizeFunctionCallOverview,
  normalizeFunctionModules,
  type AIAnalysisResult,
  type FunctionCallNode,
  type FunctionCallOverview,
  type FunctionModule,
} from "@/types/aiAnalysis";
import type { RepositorySourceType } from "@/types/repository";

const ANALYSIS_HISTORY_STORAGE_KEY = "github-code-analyzer:analysis-history:v1";
const ANALYSIS_HISTORY_UPDATED_EVENT =
  "github-code-analyzer:analysis-history-updated";
const MAX_HISTORY_RECORDS = 20;

export type AnalysisWorkLogLevel = "info" | "success" | "warning" | "error";

export type AnalysisWorkLogJsonSection = {
  label: string;
  payload: unknown;
};

export type AnalysisWorkLogEntry = {
  id: string;
  level: AnalysisWorkLogLevel;
  title: string;
  message: string;
  time: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  jsonSections?: AnalysisWorkLogJsonSection[];
};

export type GitHubAnalysisHistoryRepoInfo = {
  sourceType: "github";
  projectName: string;
  owner: string;
  repo: string;
  branch: string;
  repositoryUrl: string;
  description: string | null;
};

export type LocalAnalysisHistoryRepoInfo = {
  sourceType: "local";
  projectName: string;
  sourceId: string;
  localPath: string;
  repositoryUrl: string;
  description: string | null;
};

export type AnalysisHistoryRepoInfo =
  | GitHubAnalysisHistoryRepoInfo
  | LocalAnalysisHistoryRepoInfo;

type AnalysisHistoryRecordBase = {
  id: string;
  sourceType: RepositorySourceType;
  projectName: string;
  repositoryUrl: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  fileList: string[];
  analysisResult: AIAnalysisResult | null;
  primaryLanguages: string[];
  techStack: string[];
  markdown: string;
  workLogs: AnalysisWorkLogEntry[];
};

export type GitHubAnalysisHistoryRecord = AnalysisHistoryRecordBase & {
  sourceType: "github";
  owner: string;
  repo: string;
  branch: string;
};

export type LocalAnalysisHistoryRecord = AnalysisHistoryRecordBase & {
  sourceType: "local";
  sourceId: string;
  localPath: string;
};

export type AnalysisHistoryRecord =
  | GitHubAnalysisHistoryRecord
  | LocalAnalysisHistoryRecord;

type GitHubAnalysisHistoryMarkdownRecord = Omit<
  GitHubAnalysisHistoryRecord,
  "markdown"
>;
type LocalAnalysisHistoryMarkdownRecord = Omit<
  LocalAnalysisHistoryRecord,
  "markdown"
>;
type AnalysisHistoryMarkdownRecord =
  | GitHubAnalysisHistoryMarkdownRecord
  | LocalAnalysisHistoryMarkdownRecord;

const EMPTY_ANALYSIS_HISTORY_SNAPSHOT: AnalysisHistoryRecord[] = [];
let cachedHistoryRawPayload: string | null = null;
let cachedHistorySnapshot: AnalysisHistoryRecord[] =
  EMPTY_ANALYSIS_HISTORY_SNAPSHOT;

type CreateAnalysisHistoryRecordOptions = {
  repoInfo: AnalysisHistoryRepoInfo;
  fileList: string[];
  analysisResult: AIAnalysisResult | null;
  workLogs: AnalysisWorkLogEntry[];
  analyzedAt?: Date;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function coerceString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = coerceString(value).trim();
  return normalized || null;
}

function inferRecordSourceType(
  value: Record<string, unknown>,
): RepositorySourceType | null {
  if (value.sourceType === "github" || value.sourceType === "local") {
    return value.sourceType;
  }

  if (
    normalizeOptionalString(value.owner) &&
    normalizeOptionalString(value.repo) &&
    normalizeOptionalString(value.branch)
  ) {
    return "github";
  }

  if (
    normalizeOptionalString(value.sourceId) &&
    (normalizeOptionalString(value.localPath) ||
      normalizeOptionalString(value.repositoryUrl))
  ) {
    return "local";
  }

  return null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);

  return Array.from(new Set(normalized));
}

function normalizeAnalysisResult(value: unknown): AIAnalysisResult | null {
  try {
    return normalizeAIAnalysisResult(value);
  } catch {
    return null;
  }
}

function normalizeFunctionCallOverviewForMarkdown(
  value: unknown,
): FunctionCallOverview | null {
  try {
    return normalizeFunctionCallOverview(value);
  } catch {
    return null;
  }
}

function normalizeLogSection(value: unknown): AnalysisWorkLogJsonSection | null {
  if (!isRecord(value)) {
    return null;
  }

  const label = coerceString(value.label).trim();
  if (!label) {
    return null;
  }

  return {
    label,
    payload: value.payload,
  };
}

function normalizeWorkLogEntry(value: unknown): AnalysisWorkLogEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = coerceString(value.id).trim();
  const title = coerceString(value.title).trim();
  const message = coerceString(value.message);
  const time = coerceString(value.time).trim();

  if (!id || !title || !time) {
    return null;
  }

  const level: AnalysisWorkLogLevel =
    value.level === "success" ||
    value.level === "warning" ||
    value.level === "error"
      ? value.level
      : "info";

  const jsonSections = Array.isArray(value.jsonSections)
    ? value.jsonSections
        .map((section) => normalizeLogSection(section))
        .filter((section): section is AnalysisWorkLogJsonSection => section !== null)
    : undefined;

  return {
    id,
    level,
    title,
    message,
    time,
    requestPayload: value.requestPayload,
    responsePayload: value.responsePayload,
    jsonSections: jsonSections && jsonSections.length > 0 ? jsonSections : undefined,
  };
}

function normalizeWorkLogs(value: unknown): AnalysisWorkLogEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeWorkLogEntry(item))
    .filter((item): item is AnalysisWorkLogEntry => item !== null);
}

function normalizeFileList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);

  return Array.from(new Set(normalized)).sort((a, b) => a.localeCompare(b));
}

function normalizeRecord(value: unknown): AnalysisHistoryRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const sourceType = inferRecordSourceType(value);
  if (!sourceType) {
    return null;
  }

  const description = normalizeOptionalString(value.description);
  const createdAt = coerceString(value.createdAt).trim() || new Date().toISOString();
  const updatedAt = coerceString(value.updatedAt).trim() || createdAt;
  const fileList = normalizeFileList(value.fileList);
  const workLogs = normalizeWorkLogs(value.workLogs);
  const analysisResult = normalizeAnalysisResult(value.analysisResult);
  const functionCallOverview =
    analysisResult?.functionCallOverview ??
    normalizeFunctionCallOverviewForMarkdown(value.functionCallOverview);

  const normalizedResult =
    analysisResult ??
    (functionCallOverview || Array.isArray(value.entryPoints)
      ? {
          primaryLanguages: normalizeStringArray(value.primaryLanguages),
          techStack: normalizeStringArray(value.techStack),
          entryPoints: normalizeStringArray(value.entryPoints),
          summary:
            coerceString(value.summary).trim() || "No AI summary is available.",
          verifiedEntryPoint:
            coerceString(value.verifiedEntryPoint).trim() || null,
          verifiedEntryPointReason:
            coerceString(value.verifiedEntryPointReason).trim() || null,
          functionCallOverview,
          functionModules: normalizeFunctionModules(value.functionModules),
        }
      : null);

  const primaryLanguages =
    normalizedResult?.primaryLanguages ?? normalizeStringArray(value.primaryLanguages);
  const techStack = normalizedResult?.techStack ?? normalizeStringArray(value.techStack);

  let record: AnalysisHistoryRecord;

  if (sourceType === "github") {
    const owner = normalizeOptionalString(value.owner);
    const repo = normalizeOptionalString(value.repo);
    const branch = normalizeOptionalString(value.branch);
    const repositoryUrl = normalizeOptionalString(value.repositoryUrl);

    if (!owner || !repo || !branch || !repositoryUrl) {
      return null;
    }

    const projectName = normalizeOptionalString(value.projectName) ?? repo;

    record = {
      id:
        normalizeOptionalString(value.id) ??
        buildAnalysisHistoryRecordId({
          sourceType: "github",
          projectName,
          owner,
          repo,
          branch,
          repositoryUrl,
          description,
        }),
      sourceType: "github",
      projectName,
      owner,
      repo,
      branch,
      repositoryUrl,
      description,
      createdAt,
      updatedAt,
      fileList,
      analysisResult: normalizedResult,
      primaryLanguages,
      techStack,
      markdown: "",
      workLogs,
    };
  } else {
    const sourceId = normalizeOptionalString(value.sourceId);
    const localPath =
      normalizeOptionalString(value.localPath) ??
      normalizeOptionalString(value.repositoryUrl);
    const projectName =
      normalizeOptionalString(value.projectName) ??
      localPath ??
      "local-project";
    const repositoryUrl =
      normalizeOptionalString(value.repositoryUrl) ?? localPath ?? projectName;

    if (!sourceId || !localPath) {
      return null;
    }

    record = {
      id:
        normalizeOptionalString(value.id) ??
        buildAnalysisHistoryRecordId({
          sourceType: "local",
          projectName,
          sourceId,
          localPath,
          repositoryUrl,
          description,
        }),
      sourceType: "local",
      projectName,
      sourceId,
      localPath,
      repositoryUrl,
      description,
      createdAt,
      updatedAt,
      fileList,
      analysisResult: normalizedResult,
      primaryLanguages,
      techStack,
      markdown: "",
      workLogs,
    };
  }

  record.markdown =
    typeof value.markdown === "string" && value.markdown.trim()
      ? value.markdown
      : buildAnalysisProjectMarkdown(record);

  return record;
}

function notifyHistoryUpdated() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(ANALYSIS_HISTORY_UPDATED_EVENT));
}

function setHistorySnapshotCache(
  rawPayload: string | null,
  records: AnalysisHistoryRecord[],
) {
  cachedHistoryRawPayload = rawPayload;
  cachedHistorySnapshot =
    records.length > 0 ? records : EMPTY_ANALYSIS_HISTORY_SNAPSHOT;
}

function normalizeHistoryRecordsPayload(payload: string): AnalysisHistoryRecord[] {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!Array.isArray(parsed)) {
      return EMPTY_ANALYSIS_HISTORY_SNAPSHOT;
    }

    const records = parsed
      .map((item) => normalizeRecord(item))
      .filter((item): item is AnalysisHistoryRecord => item !== null);

    return records.length > 0 ? records : EMPTY_ANALYSIS_HISTORY_SNAPSHOT;
  } catch {
    return EMPTY_ANALYSIS_HISTORY_SNAPSHOT;
  }
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readHistorySnapshotFromStorage(): AnalysisHistoryRecord[] {
  const storage = getStorage();
  if (!storage) {
    setHistorySnapshotCache(null, EMPTY_ANALYSIS_HISTORY_SNAPSHOT);
    return EMPTY_ANALYSIS_HISTORY_SNAPSHOT;
  }

  const payload = storage.getItem(ANALYSIS_HISTORY_STORAGE_KEY);

  if (payload === cachedHistoryRawPayload) {
    return cachedHistorySnapshot;
  }

  if (!payload) {
    setHistorySnapshotCache(null, EMPTY_ANALYSIS_HISTORY_SNAPSHOT);
    return EMPTY_ANALYSIS_HISTORY_SNAPSHOT;
  }

  const records = normalizeHistoryRecordsPayload(payload);
  setHistorySnapshotCache(payload, records);

  return cachedHistorySnapshot;
}

function writeRecords(records: AnalysisHistoryRecord[]): AnalysisHistoryRecord[] {
  const storage = getStorage();
  if (!storage) {
    return records;
  }

  let payload = records.slice(0, MAX_HISTORY_RECORDS);

  while (payload.length > 0) {
    try {
      const serialized = JSON.stringify(payload);
      storage.setItem(ANALYSIS_HISTORY_STORAGE_KEY, serialized);
      setHistorySnapshotCache(serialized, payload);
      notifyHistoryUpdated();
      return cachedHistorySnapshot;
    } catch {
      payload = payload.slice(0, -1);
    }
  }

  try {
    storage.removeItem(ANALYSIS_HISTORY_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }

  setHistorySnapshotCache(null, EMPTY_ANALYSIS_HISTORY_SNAPSHOT);
  notifyHistoryUpdated();

  return EMPTY_ANALYSIS_HISTORY_SNAPSHOT;
}

function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN", {
    hour12: false,
  });
}

function toJsonString(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function renderFunctionCallNode(
  node: FunctionCallNode,
  depth: number,
  lines: string[],
  seen: WeakSet<object>,
) {
  if (seen.has(node)) {
    const indent = "  ".repeat(depth);
    lines.push(
      `${indent}- \`${node.name}\` | module: \`${node.moduleId ?? "unassigned"}\` | file: \`${node.filePath ?? "unknown"}\` | shouldDive: ${node.shouldDive}`,
    );
    lines.push(`${indent}  summary: [Circular node omitted]`);
    return;
  }

  seen.add(node);
  const indent = "  ".repeat(depth);
  lines.push(
    `${indent}- \`${node.name}\` | module: \`${node.moduleId ?? "unassigned"}\` | file: \`${node.filePath ?? "unknown"}\` | shouldDive: ${node.shouldDive}`,
  );
  lines.push(`${indent}  summary: ${node.summary}`);

  for (const child of node.children) {
    renderFunctionCallNode(child, depth + 1, lines, seen);
  }
}

function renderFunctionCallOverview(overview: FunctionCallOverview | null): string[] {
  if (!overview?.root) {
    return ["No function call chain is available."];
  }

  const lines: string[] = [
    `Analyzed depth: ${overview.analyzedDepth}`,
    "",
    "Call chain:",
  ];

  renderFunctionCallNode(overview.root, 0, lines, new WeakSet<object>());
  return lines;
}

function renderFunctionModules(modules: FunctionModule[]): string[] {
  if (modules.length === 0) {
    return ["No function modules are available."];
  }

  return modules.map(
    (module) =>
      `- [${module.id}] ${module.name}: ${module.summary}`,
  );
}

function renderStringList(items: string[], emptyText: string): string[] {
  if (items.length === 0) {
    return [emptyText];
  }

  return items.map((item) => `- ${item}`);
}

function normalizeHistoryIdentitySegment(value: string): string {
  return value.trim().replace(/\\/g, "/").toLowerCase();
}

export function buildAnalysisHistoryRecordId(
  repoInfo: AnalysisHistoryRepoInfo,
): string {
  if (repoInfo.sourceType === "github") {
    return `${repoInfo.owner}/${repoInfo.repo}@${repoInfo.branch}`;
  }

  return `local:${normalizeHistoryIdentitySegment(
    repoInfo.localPath || repoInfo.projectName,
  )}`;
}

export function buildAnalysisProjectMarkdown(
  record: AnalysisHistoryMarkdownRecord,
): string {
  const result = record.analysisResult;
  const basicInfoLines =
    record.sourceType === "github"
      ? [
          `- Source Type: GitHub`,
          `- Owner: ${record.owner}`,
          `- Repository: ${record.repo}`,
          `- Branch: ${record.branch}`,
        ]
      : [
          `- Source Type: Local`,
          `- Local Path: ${record.localPath}`,
          `- Snapshot ID: ${record.sourceId}`,
        ];
  const lines: string[] = [
    "# Project Analysis Workspace File",
    "",
    `Generated At: ${formatDateTime(record.updatedAt)}`,
    `Repository URL: ${record.repositoryUrl}`,
    "",
    "## Basic Information",
    "",
    `- Project Name: ${record.projectName}`,
    ...basicInfoLines,
    `- Description: ${record.description ?? "N/A"}`,
    "",
    "## Programming Languages",
    "",
    ...renderStringList(record.primaryLanguages, "No language detected."),
    "",
    "## Tech Stack",
    "",
    ...renderStringList(record.techStack, "No stack label detected."),
    "",
    "## Analysis Summary",
    "",
    result?.summary ?? "No summary is available.",
    "",
    "## Entry Points",
    "",
    ...renderStringList(result?.entryPoints ?? [], "No entry points are available."),
    "",
    "## Verified Entry Point",
    "",
    `- Path: ${result?.verifiedEntryPoint ?? "N/A"}`,
    `- Reason: ${result?.verifiedEntryPointReason ?? "N/A"}`,
    "",
    "## Function Modules",
    "",
    ...renderFunctionModules(result?.functionModules ?? []),
    "",
    "## Complete Call Chain",
    "",
    ...renderFunctionCallOverview(result?.functionCallOverview ?? null),
    "",
    "## File List",
    "",
    ...renderStringList(
      record.fileList.map((path) => `\`${path}\``),
      "No files are available.",
    ),
    "",
    "## Agent Work Logs",
    "",
  ];

  if (record.workLogs.length === 0) {
    lines.push("No work logs are available.");
    lines.push("");
    return lines.join("\n");
  }

  const chronologicalLogs = [...record.workLogs].reverse();

  for (const [index, log] of chronologicalLogs.entries()) {
    lines.push(`### ${index + 1}. [${log.time}] ${log.title} (${log.level})`);
    lines.push("");
    lines.push(log.message || "N/A");
    lines.push("");

    if (log.requestPayload !== undefined) {
      lines.push("Request Payload:");
      lines.push("```json");
      lines.push(toJsonString(log.requestPayload));
      lines.push("```");
      lines.push("");
    }

    if (log.responsePayload !== undefined) {
      lines.push("Response Payload:");
      lines.push("```json");
      lines.push(toJsonString(log.responsePayload));
      lines.push("```");
      lines.push("");
    }

    if (log.jsonSections && log.jsonSections.length > 0) {
      for (const section of log.jsonSections) {
        lines.push(`${section.label}:`);
        lines.push("```json");
        lines.push(toJsonString(section.payload));
        lines.push("```");
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

export function createAnalysisHistoryRecord(
  options: CreateAnalysisHistoryRecordOptions,
): AnalysisHistoryRecord {
  const normalizedFileList = normalizeFileList(options.fileList);
  const timestamp = (options.analyzedAt ?? new Date()).toISOString();
  const id = buildAnalysisHistoryRecordId(options.repoInfo);
  const primaryLanguages = options.analysisResult?.primaryLanguages ?? [];
  const techStack = options.analysisResult?.techStack ?? [];

  const baseRecord = {
    id,
    sourceType: options.repoInfo.sourceType,
    projectName: options.repoInfo.projectName,
    repositoryUrl: options.repoInfo.repositoryUrl,
    description: options.repoInfo.description,
    createdAt: timestamp,
    updatedAt: timestamp,
    fileList: normalizedFileList,
    analysisResult: options.analysisResult,
    primaryLanguages,
    techStack,
    markdown: "",
    workLogs: options.workLogs,
  } as const;

  const record: AnalysisHistoryRecord =
    options.repoInfo.sourceType === "github"
      ? {
          ...baseRecord,
          sourceType: "github",
          owner: options.repoInfo.owner,
          repo: options.repoInfo.repo,
          branch: options.repoInfo.branch,
        }
      : {
          ...baseRecord,
          sourceType: "local",
          sourceId: options.repoInfo.sourceId,
          localPath: options.repoInfo.localPath,
        };

  record.markdown = buildAnalysisProjectMarkdown(record);
  return record;
}

export function getAnalysisHistoryRecords(): AnalysisHistoryRecord[] {
  return readHistorySnapshotFromStorage();
}

export function subscribeAnalysisHistory(
  onStoreChange: () => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key && event.key !== ANALYSIS_HISTORY_STORAGE_KEY) {
      return;
    }

    onStoreChange();
  };

  const handleLocalUpdate = () => {
    onStoreChange();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(ANALYSIS_HISTORY_UPDATED_EVENT, handleLocalUpdate);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(ANALYSIS_HISTORY_UPDATED_EVENT, handleLocalUpdate);
  };
}

export function getAnalysisHistorySnapshot(): AnalysisHistoryRecord[] {
  return readHistorySnapshotFromStorage();
}

export function getAnalysisHistoryServerSnapshot(): AnalysisHistoryRecord[] {
  return EMPTY_ANALYSIS_HISTORY_SNAPSHOT;
}

export function getAnalysisHistoryRecordById(
  historyId: string,
): AnalysisHistoryRecord | null {
  if (!historyId.trim()) {
    return null;
  }

  return (
    getAnalysisHistoryRecords().find((item) => item.id === historyId.trim()) ?? null
  );
}

export function upsertAnalysisHistoryRecord(
  record: AnalysisHistoryRecord,
): AnalysisHistoryRecord[] {
  const current = getAnalysisHistoryRecords();
  const existing = current.find((item) => item.id === record.id);
  const updatedAt = new Date().toISOString();
  const preparedRecord: AnalysisHistoryRecord = {
    ...record,
    createdAt: existing?.createdAt ?? record.createdAt,
    updatedAt,
    markdown: "",
  };
  preparedRecord.markdown = buildAnalysisProjectMarkdown(preparedRecord);

  const merged = [
    preparedRecord,
    ...current.filter((item) => item.id !== record.id),
  ].slice(0, MAX_HISTORY_RECORDS);

  return writeRecords(merged);
}
