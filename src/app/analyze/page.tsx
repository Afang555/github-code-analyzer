"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  FolderOpen,
  Loader2,
  Maximize2,
  Sparkles,
  X,
} from "lucide-react";
import { SiGithub } from "react-icons/si";

import { CodeViewer } from "@/components/CodeViewer";
import { FileTree } from "@/components/FileTree";
import { FunctionOverviewPanel } from "@/components/FunctionOverviewPanel";
import { AppSettingsDialog } from "@/components/AppSettingsDialog";
import {
  getAppSettingsServerSnapshot,
  getAppSettingsSnapshot,
  subscribeAppSettings,
} from "@/lib/appSettingsStore";
import {
  createAnalysisHistoryRecord,
  getAnalysisHistoryRecordById,
  upsertAnalysisHistoryRecord,
} from "@/lib/analysisHistory";
import {
  createFileTreeFromFileList,
  flattenFileTreePaths,
} from "@/lib/fileTree";
import {
  buildFunctionModuleColorMap,
  getFunctionModuleColor,
} from "@/lib/functionModules";
import { getFunctionCallNodeRouteLabel } from "@/lib/functionCallBridgeUtils";
import { stringifyJsonPreview } from "@/lib/jsonPreview";
import { collectAnalysisCandidatePaths } from "@/lib/repositoryAnalysis";
import { cn } from "@/lib/utils";
import {
  getRepositoryInfo,
  getRepositoryTree,
  type RepositoryContext,
  type RepositoryDescriptor,
  type FileNode,
} from "@/services/repositoryService";
import {
  isAnalyzeRepoDrillDownErrorResponse,
  isAnalyzeRepoDrillDownSuccessResponse,
  isAnalyzeRepoErrorResponse,
  isAnalyzeRepoSuccessResponse,
  type AIAnalysisResult,
  type AIModelDebugData,
  type EntryPointReviewAttempt,
  type EntryPointVerificationDebugData,
  type FunctionCallNode,
  type FunctionCallAnalysisDebugData,
  type FunctionCallOverview,
  type FunctionModule,
  type FunctionModuleAnalysisDebugData,
} from "@/types/aiAnalysis";
import {
  buildRepositoryLocationLabel,
} from "@/types/repository";
import { parseGitHubUrl } from "@/utils/github";
import { ANALYZE_TEXT as TEXT } from "./uiText";

type WorkLogLevel = "info" | "success" | "warning" | "error";
type WorkspacePanelKey = "files" | "source" | "overview";
type ResizeTarget = "sidebar" | "files" | "overview";
type WorkflowStatus = "idle" | "running" | "finished";

type WorkLogJsonSection = {
  label: string;
  payload: unknown;
};

type WorkLogEntry = {
  id: string;
  level: WorkLogLevel;
  title: string;
  message: string;
  time: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  jsonSections?: WorkLogJsonSection[];
};

type WorkspacePanelVisibility = Record<WorkspacePanelKey, boolean>;

type ResizeState = {
  target: ResizeTarget;
  startX: number;
  startWidth: number;
  invertDelta?: boolean;
};

const LOG_LEVEL_STYLES: Record<
  WorkLogLevel,
  {
    border: string;
    dot: string;
    text: string;
  }
> = {
  info: {
    border: "border-blue-200 dark:border-blue-900/40",
    dot: "bg-blue-500",
    text: "text-blue-600 dark:text-blue-400",
  },
  success: {
    border: "border-emerald-200 dark:border-emerald-900/40",
    dot: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  warning: {
    border: "border-amber-200 dark:border-amber-900/40",
    dot: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
  },
  error: {
    border: "border-red-200 dark:border-red-900/40",
    dot: "bg-red-500",
    text: "text-red-600 dark:text-red-400",
  },
};

const WORKFLOW_STATUS_STYLES: Record<
  WorkflowStatus,
  {
    dot: string;
    badge: string;
  }
> = {
  idle: {
    dot: "bg-slate-400",
    badge:
      "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
  running: {
    dot: "bg-blue-500",
    badge:
      "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800/70 dark:bg-blue-900/30 dark:text-blue-300",
  },
  finished: {
    dot: "bg-emerald-500",
    badge:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-900/30 dark:text-emerald-300",
  },
};

const PANEL_LIMITS: Record<ResizeTarget, { min: number; max: number }> = {
  sidebar: { min: 280, max: 520 },
  files: { min: 240, max: 420 },
  overview: { min: 300, max: 620 },
};

const DEFAULT_PANEL_VISIBILITY: WorkspacePanelVisibility = {
  files: true,
  source: true,
  overview: true,
};

function clampPanelWidth(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getOverviewResizeMax(containerWidth: number): number {
  return Math.max(PANEL_LIMITS.overview.min, Math.floor(containerWidth * 0.5));
}

function countFilesInTree(nodes: FileNode[]): number {
  let count = 0;

  const visit = (items: FileNode[]) => {
    for (const node of items) {
      if (node.type === "file") {
        count += 1;
        continue;
      }

      if (node.children) {
        visit(node.children);
      }
    }
  };

  visit(nodes);
  return count;
}

function formatLogTime(date = new Date()): string {
  return date.toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function buildModelRequestPayload(debug?: AIModelDebugData): unknown {
  if (!debug) {
    return undefined;
  }

  return {
    endpoint: debug.endpoint,
    model: debug.model,
    fallbackUsed: debug.fallbackUsed,
    attempts: debug.attempts.map((attempt) => ({
      mode: attempt.mode,
      ok: attempt.ok,
      status: attempt.status,
      request: attempt.request,
    })),
  };
}

function buildModelResponsePayload(
  debug?: AIModelDebugData,
  normalizedResult?: unknown,
): unknown {
  if (!debug) {
    return undefined;
  }

  return {
    attempts: debug.attempts.map((attempt) => ({
      mode: attempt.mode,
      ok: attempt.ok,
      status: attempt.status,
      response: attempt.response,
    })),
    normalizedResult,
  };
}

function summarizeAnalysisResult(result: AIAnalysisResult): string {
  const languages =
    result.primaryLanguages.length > 0
      ? result.primaryLanguages.join("\u3001")
      : TEXT.noLanguages;
  const stack =
    result.techStack.length > 0
      ? result.techStack.slice(0, 4).join("\u3001")
      : TEXT.noStack;

  return `${TEXT.mainLanguagePrefix}${languages}${TEXT.techStackPrefix}${stack}${TEXT.fullStop}`;
}

function summarizeFunctionOverview(overview: FunctionCallOverview | null): string {
  if (!overview?.root) {
    return TEXT.functionOverviewUnavailable;
  }

  const queue = [...overview.root.children];
  let nodeCount = 0;

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current) {
      continue;
    }

    nodeCount += 1;
    queue.push(...current.children);
  }

  return `${TEXT.entryFunction}：${overview.root.name}${TEXT.fullStop}递归层级：${overview.analyzedDepth}${TEXT.fullStop}关键节点：${nodeCount} 个${TEXT.fullStop}`;
}

function collectFunctionDescendants(root: FunctionCallNode, limit = 6): FunctionCallNode[] {
  const queue = [...root.children];
  const nodes: FunctionCallNode[] = [];
  const seen = new Set<string>();

  while (queue.length > 0 && nodes.length < limit) {
    const current = queue.shift();

    if (!current) {
      continue;
    }

    const routeLabel = getFunctionCallNodeRouteLabel(current) ?? "";
    const identity = `${current.name}::${current.filePath ?? "__unknown__"}::${routeLabel}`;

    if (seen.has(identity)) {
      queue.push(...current.children);
      continue;
    }

    seen.add(identity);
    nodes.push(current);
    queue.push(...current.children);
  }

  return nodes;
}

function collectFunctionModuleNodeCounts(
  overview: FunctionCallOverview | null,
): Map<string, number> {
  const counts = new Map<string, number>();

  if (!overview?.root) {
    return counts;
  }

  const queue: FunctionCallNode[] = [overview.root];

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current) {
      continue;
    }

    if (current.moduleId) {
      counts.set(current.moduleId, (counts.get(current.moduleId) ?? 0) + 1);
    }

    queue.push(...current.children);
  }

  return counts;
}

function getFunctionNodeByPath(
  root: FunctionCallNode | null,
  nodePath: number[],
): FunctionCallNode | null {
  if (!root) {
    return null;
  }

  let current: FunctionCallNode = root;

  for (const childIndex of nodePath) {
    if (!Number.isInteger(childIndex) || childIndex < 0) {
      return null;
    }

    const next = current.children[childIndex];
    if (!next) {
      return null;
    }

    current = next;
  }

  return current;
}

function getEntryReviewLogLevel(
  attempt: EntryPointReviewAttempt,
): WorkLogLevel {
  switch (attempt.outcome) {
    case "verified":
      return "success";
    case "rejected":
      return "info";
    case "skipped":
      return "warning";
    case "error":
      return attempt.failureStage === "read_file" ? "warning" : "error";
    default:
      return "info";
  }
}

function getEntryReviewLogTitle(attempt: EntryPointReviewAttempt): string {
  switch (attempt.outcome) {
    case "verified":
      return TEXT.entryReviewConfirmed;
    case "rejected":
      return TEXT.entryReviewRejected;
    case "skipped":
      return TEXT.entryReviewSkipped;
    case "error":
      return attempt.failureStage === "read_file"
        ? TEXT.entryFileLoadFailed
        : TEXT.entryReviewFailed;
    default:
      return TEXT.entryReviewFailed;
  }
}

function formatEntryReviewMessage(attempt: EntryPointReviewAttempt): string {
  const linesDescription =
    attempt.totalLines > 0
      ? `总行数 ${attempt.totalLines}，本次分析 ${attempt.analyzedLines}${
          attempt.truncated ? "，内容按前后 2000 行截断。" : "。"
        }`
      : attempt.failureStage === "read_file"
        ? "未成功读取到文件内容。"
        : "未生成可用于研判的文件内容。";

  return `${attempt.candidatePath}\n${linesDescription}\n原因：${attempt.reason}`;
}

function JsonDetails({
  label,
  payload,
}: {
  label: string;
  payload: unknown;
}) {
  return (
    <details className="mt-2 overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
      <summary className="cursor-pointer px-2 py-1.5 text-[11px] text-gray-600 dark:text-gray-400">
        {label}
      </summary>
      <pre className="overflow-x-auto border-t border-gray-200 bg-gray-50 p-2 text-[11px] leading-relaxed text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
        {stringifyJsonPreview(payload)}
      </pre>
    </details>
  );
}

function WorkLogList({ logs }: { logs: WorkLogEntry[] }) {
  if (logs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/80 p-4 text-xs leading-relaxed text-gray-500 dark:border-gray-800 dark:bg-gray-900/50 dark:text-gray-400">
        {TEXT.emptyLogs}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {logs.map((log) => {
        const styles = LOG_LEVEL_STYLES[log.level];

        return (
          <div
            key={log.id}
            className={`rounded-lg border bg-gray-50/70 p-3 dark:bg-gray-900/60 ${styles.border}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 flex-shrink-0 rounded-full ${styles.dot}`}
                  ></span>
                  <p className={`truncate text-xs font-semibold ${styles.text}`}>
                    {log.title}
                  </p>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                  {log.message}
                </p>
              </div>
              <span className="flex-shrink-0 text-[10px] text-gray-400">
                {log.time}
              </span>
            </div>

            {log.requestPayload !== undefined && (
              <JsonDetails label={TEXT.aiRequestJson} payload={log.requestPayload} />
            )}

            {log.responsePayload !== undefined && (
              <JsonDetails label={TEXT.aiResponseJson} payload={log.responsePayload} />
            )}

            {log.jsonSections?.map((section) => (
              <JsonDetails
                key={`${log.id}-${section.label}`}
                label={section.label}
                payload={section.payload}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function WorkLogPanel({
  logs,
  workflowStatus,
  onOpenFullscreen,
}: {
  logs: WorkLogEntry[];
  workflowStatus: WorkflowStatus;
  onOpenFullscreen: () => void;
}) {
  const workflowStyles = WORKFLOW_STATUS_STYLES[workflowStatus];
  const workflowStatusLabel =
    workflowStatus === "running"
      ? TEXT.workflowRunning
      : workflowStatus === "finished"
        ? TEXT.workflowFinished
        : TEXT.workflowIdle;

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-950">
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${workflowStyles.dot}`}></span>
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {TEXT.workLog}
          </h2>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-medium",
              workflowStyles.badge,
            )}
          >
            {workflowStatusLabel}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-500 dark:text-gray-400">
            {logs.length}
            {TEXT.itemUnit}
          </span>
          <button
            type="button"
            onClick={onOpenFullscreen}
            className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            title={TEXT.fullScreenWorkLog}
            aria-label={TEXT.fullScreenWorkLog}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="max-h-[280px] overflow-y-auto p-3">
        <WorkLogList logs={logs} />
      </div>
    </section>
  );
}

function WorkLogFullscreenDialog({
  logs,
  open,
  onClose,
}: {
  logs: WorkLogEntry[];
  open: boolean;
  onClose: () => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 p-4 backdrop-blur-sm sm:p-6">
      <div className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {TEXT.workLog}
            </h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {TEXT.fullScreenSummaryPrefix}
              {logs.length}
              {TEXT.fullScreenSummarySuffix}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            aria-label={TEXT.closeWorkLogDialog}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          <WorkLogList logs={logs} />
        </div>
      </div>
    </div>
  );
}

function ResizeHandle({
  isActive,
  onPointerDown,
  label,
}: {
  isActive: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={onPointerDown}
      className="group flex h-full w-3 flex-shrink-0 cursor-col-resize touch-none items-stretch justify-center bg-transparent outline-none"
    >
      <span
        className={cn(
          "my-3 w-px rounded-full bg-gray-200 transition-colors dark:bg-gray-800",
          isActive
            ? "bg-blue-500 dark:bg-blue-400"
            : "group-hover:bg-blue-400/80 dark:group-hover:bg-blue-500/70",
        )}
      />
    </button>
  );
}

function PanelToggleButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800/60 dark:bg-blue-900/30 dark:text-blue-300"
          : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800",
      )}
    >
      {label}
    </button>
  );
}

function AnalyzePageContent() {
  const searchParams = useSearchParams();
  const autoAnalyzedSourceRef = useRef<string | null>(null);
  const autoLoadedHistoryRef = useRef<string | null>(null);
  const shouldPersistHistoryRef = useRef(false);
  const logCounterRef = useRef(0);
  const resizeStateRef = useRef<ResizeState | null>(null);
  const workspacePanelsRef = useRef<HTMLDivElement | null>(null);
  const appSettings = useSyncExternalStore(
    subscribeAppSettings,
    getAppSettingsSnapshot,
    getAppSettingsServerSnapshot,
  );

  const [urlInput, setUrlInput] = useState("");
  const [repoInfo, setRepoInfo] = useState<RepositoryContext | null>(null);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysisResult | null>(null);
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);
  const [isAnalyzingAI, setIsAnalyzingAI] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [workLogs, setWorkLogs] = useState<WorkLogEntry[]>([]);
  const [isLogFullscreenOpen, setIsLogFullscreenOpen] = useState(false);
  const [drillingNodeId, setDrillingNodeId] = useState<string | null>(null);
  const [panelVisibility, setPanelVisibility] = useState<WorkspacePanelVisibility>(
    DEFAULT_PANEL_VISIBILITY,
  );
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [fileTreeWidth, setFileTreeWidth] = useState(300);
  const [overviewWidth, setOverviewWidth] = useState(420);
  const [activeResizeTarget, setActiveResizeTarget] =
    useState<ResizeTarget | null>(null);

  const createLogEntry = (
    entry: Omit<WorkLogEntry, "id" | "time">,
  ): WorkLogEntry => ({
    ...entry,
    id: `log-${Date.now()}-${logCounterRef.current++}`,
    time: formatLogTime(),
  });

  const appendLog = (entry: Omit<WorkLogEntry, "id" | "time">) => {
    setWorkLogs((prev) => [createLogEntry(entry), ...prev]);
  };

  const startLogSession = (urlToAnalyze: string) => {
    setWorkLogs([
      createLogEntry({
        level: "info",
        title: TEXT.startAnalyze,
        message: `${TEXT.prepareAnalyzePrefix}${urlToAnalyze}`,
      }),
    ]);
  };

  const appendEntryVerificationLogs = (
    debug: EntryPointVerificationDebugData | null,
    candidateCount: number,
  ) => {
    if (!debug) {
      return;
    }

    const reviewedCount = debug.attempts.filter(
      (attempt) =>
        attempt.outcome === "verified" || attempt.outcome === "rejected",
    ).length;
    const readFileFailureCount = debug.attempts.filter(
      (attempt) => attempt.failureStage === "read_file",
    ).length;
    const aiReviewFailureCount = debug.attempts.filter(
      (attempt) => attempt.failureStage === "ai_review",
    ).length;
    const skippedCount = debug.attempts.filter(
      (attempt) => attempt.outcome === "skipped",
    ).length;

    if (candidateCount > 0) {
      appendLog({
        level: "info",
        title: TEXT.entryReviewStarted,
        message: `${TEXT.entryReviewStartedPrefix}${candidateCount}${TEXT.entryReviewStartedSuffix}`,
      });
    }

    for (const attempt of debug.attempts) {
      appendLog({
        level: getEntryReviewLogLevel(attempt),
        title: getEntryReviewLogTitle(attempt),
        message: formatEntryReviewMessage(attempt),
        requestPayload: buildModelRequestPayload(attempt.debug ?? undefined),
        responsePayload: buildModelResponsePayload(
          attempt.debug ?? undefined,
          attempt.reviewResult ?? undefined,
        ),
      });
    }

    if (debug.verifiedEntryPoint) {
      appendLog({
        level: "success",
        title: TEXT.entryReviewComplete,
        message: `${debug.verifiedEntryPoint}\n原因：${
          debug.verifiedEntryPointReason ?? TEXT.confirmedEntryPointFallback
        }`,
      });
      return;
    }

    appendLog({
      level:
        reviewedCount > 0 || readFileFailureCount > 0 || aiReviewFailureCount > 0
          ? "warning"
          : "info",
      title:
        reviewedCount > 0
          ? TEXT.entryReviewNoneConfirmed
          : readFileFailureCount > 0 || aiReviewFailureCount > 0
            ? TEXT.entryReviewIncomplete
            : TEXT.entryReviewNoneConfirmed,
      message:
        reviewedCount > 0
          ? `已完成 ${reviewedCount} 个候选入口文件复核，但未确认真实入口。${
              readFileFailureCount > 0
                ? ` 另有 ${readFileFailureCount} 个候选文件读取失败。`
                : ""
            }${
              aiReviewFailureCount > 0
                ? ` 另有 ${aiReviewFailureCount} 个候选文件 AI 研判失败。`
                : ""
            }${
              skippedCount > 0 ? ` 另有 ${skippedCount} 个候选路径被跳过。` : ""
            }`
          : readFileFailureCount > 0 || aiReviewFailureCount > 0
            ? `候选入口文件未完成有效复核。${
                readFileFailureCount > 0
                  ? ` 文件读取失败 ${readFileFailureCount} 个。`
                  : ""
              }${
                aiReviewFailureCount > 0
                  ? ` AI 研判失败 ${aiReviewFailureCount} 个。`
                  : ""
              }${
                skippedCount > 0 ? ` 已跳过无效路径 ${skippedCount} 个。` : ""
              }`
            : TEXT.confirmedEntryPointFallback,
    });
  };

  const appendFunctionOverviewLogs = (
    overview: FunctionCallOverview | null,
    debug: FunctionCallAnalysisDebugData | null,
  ) => {
    if (!debug) {
      return;
    }

    const drillDownAttempts = debug.drillDownAttempts ?? [];
    const cacheEvents = debug.cacheEvents ?? [];

    for (const cacheEvent of cacheEvents) {
      const title =
        cacheEvent.event === "hit"
          ? TEXT.functionCacheHit
          : cacheEvent.event === "miss"
            ? TEXT.functionCacheMiss
            : cacheEvent.event === "store"
              ? TEXT.functionCacheStore
              : TEXT.functionCacheCycleGuard;
      const level: WorkLogLevel =
        cacheEvent.event === "hit"
          ? "success"
          : cacheEvent.event === "cycle_guard"
            ? "warning"
            : "info";

      appendLog({
        level,
        title,
        message: `函数：${cacheEvent.functionName}\n深度：${cacheEvent.depth}\n调用路径：${cacheEvent.callPath.join(" -> ")}\n缓存键：${cacheEvent.nodeKey}\n${cacheEvent.message}`,
      });
    }

    for (const attempt of drillDownAttempts) {
      appendLog({
        level: attempt.status === "completed" ? "success" : "error",
        title: TEXT.functionDrillDownTrace,
        message: `函数：${attempt.functionName}\n父函数：${attempt.parentFunctionName}\n深度：${attempt.depth}\n调用路径：${attempt.callPath.join(" -> ")}\n定位文件：${attempt.locationFilePath ?? TEXT.unknownFunctionFile}\n状态：${
          attempt.status === "completed" ? "完成" : "失败"
        }\n${attempt.message}`,
        requestPayload: buildModelRequestPayload(attempt.model ?? undefined),
        responsePayload: buildModelResponsePayload(attempt.model ?? undefined, {
          nodeKey: attempt.nodeKey,
          status: attempt.status,
          locationFilePath: attempt.locationFilePath,
          message: attempt.message,
        }),
      });
    }

    const requestPayload = buildModelRequestPayload(debug.model ?? undefined);
    const responsePayload = buildModelResponsePayload(
      debug.model ?? undefined,
      overview ?? undefined,
    );

    if (debug.status === "completed") {
      appendLog({
        level: "success",
        title: TEXT.functionOverviewCompleted,
        message: `${debug.message}\n${summarizeFunctionOverview(overview)}`,
        requestPayload,
        responsePayload,
      });
      return;
    }

    if (debug.status === "skipped") {
      appendLog({
        level: "info",
        title: TEXT.functionOverviewSkipped,
        message: debug.message,
        requestPayload,
        responsePayload,
      });
      return;
    }

    appendLog({
      level: debug.model ? "error" : "warning",
      title: TEXT.functionOverviewFailed,
      message: debug.message,
      requestPayload,
      responsePayload,
    });
  };

  const appendFunctionModuleLogs = (
    modules: FunctionModule[],
    debug: FunctionModuleAnalysisDebugData | null,
  ) => {
    if (!debug) {
      return;
    }

    const requestPayload = buildModelRequestPayload(debug.model ?? undefined);
    const responsePayload = buildModelResponsePayload(
      debug.model ?? undefined,
      {
        modules,
        totalNodes: debug.totalNodes,
        assignedNodes: debug.assignedNodes,
        moduleCount: debug.moduleCount,
      },
    );

    if (debug.status === "completed") {
      appendLog({
        level: "success",
        title: TEXT.functionModuleCompleted,
        message: debug.message,
        requestPayload,
        responsePayload,
      });
      return;
    }

    if (debug.status === "skipped") {
      appendLog({
        level: "info",
        title: TEXT.functionModuleSkipped,
        message: debug.message,
        requestPayload,
        responsePayload,
      });
      return;
    }

    appendLog({
      level: debug.model ? "error" : "warning",
      title: TEXT.functionModuleFailed,
      message: debug.message,
      requestPayload,
      responsePayload,
    });
  };

  const restoreFromHistory = useEffectEvent((historyId: string): boolean => {
    const history = getAnalysisHistoryRecordById(historyId);
    if (!history) {
      return false;
    }

    const restoredFileTree = createFileTreeFromFileList(history.fileList);
    const preferredFilePath =
      history.analysisResult?.verifiedEntryPoint ??
      history.analysisResult?.entryPoints[0] ??
      history.fileList[0] ??
      "";

    shouldPersistHistoryRef.current = false;
    setIsLoading(false);
    setIsAnalyzingAI(false);
    setError(null);
    setAiError(null);
    setUrlInput(
      history.sourceType === "github" ? history.repositoryUrl : history.localPath,
    );
    setRepoInfo(
      history.sourceType === "github"
        ? {
            sourceType: "github",
            projectName: history.projectName,
            owner: history.owner,
            repo: history.repo,
            branch: history.branch,
            repositoryUrl: history.repositoryUrl,
            repositoryDescription: history.description,
          }
        : {
            sourceType: "local",
            projectName: history.projectName,
            sourceId: history.sourceId,
            branch: null,
            localPath: history.localPath,
            repositoryUrl: history.repositoryUrl,
            repositoryDescription: history.description,
          },
    );
    setFileTree(restoredFileTree);
    setSelectedFilePath(preferredFilePath);
    setAiAnalysis(history.analysisResult);
    setActiveModuleId(null);
    setDrillingNodeId(null);
    setWorkLogs(history.workLogs);

    autoAnalyzedSourceRef.current =
      history.sourceType === "github"
        ? `github:${history.owner}/${history.repo}`
        : `local:${history.sourceId}`;
    return true;
  });

  const resetAnalysisState = () => {
    setIsLoading(true);
    setError(null);
    setAiError(null);
    setDrillingNodeId(null);
    setFileTree([]);
    setSelectedFilePath("");
    setRepoInfo(null);
    setAiAnalysis(null);
    setActiveModuleId(null);
  };

  const loadRepositoryAndAnalyze = async (
    descriptor: RepositoryDescriptor,
  ) => {
    resetAnalysisState();

    const context = await getRepositoryInfo(descriptor, appSettings);
    setRepoInfo(context);
    setUrlInput(
      context.sourceType === "github" ? context.repositoryUrl : context.localPath,
    );

    if (context.sourceType === "github") {
      appendLog({
        level: "success",
        title: TEXT.githubValidationPassed,
        message: `${TEXT.defaultBranchPrefix}${context.branch}${TEXT.fullStop}`,
      });
    } else {
      appendLog({
        level: "success",
        title: "本地目录已载入",
        message: `${context.localPath}\n已创建本地项目快照，开始读取目录结构。`,
      });
    }

    const tree = await getRepositoryTree(context, appSettings);
    setFileTree(tree);

    const totalFileCount = countFilesInTree(tree);
    appendLog({
      level: "info",
      title: TEXT.fileListLoaded,
      message: `${TEXT.loadedPrefix}${totalFileCount}${TEXT.loadedSuffix}`,
    });

    const nextUrl =
      context.sourceType === "github"
        ? `/analyze?repo=${context.owner}/${context.repo}`
        : `/analyze?source=local&id=${context.sourceId}`;
    window.history.pushState(
      { ...window.history.state, as: nextUrl, url: nextUrl },
      "",
      nextUrl,
    );

    const filePaths = collectAnalysisCandidatePaths(tree);
    const filteredOutCount = Math.max(totalFileCount - filePaths.length, 0);

    appendLog({
      level: "info",
      title: TEXT.fileFilterDone,
      message: `${TEXT.retainedPrefix}${filePaths.length}${TEXT.retainedMiddle}${filteredOutCount}${TEXT.retainedSuffix}`,
      jsonSections: [
        {
          label: TEXT.filteredFileList,
          payload: {
            count: filePaths.length,
            files: filePaths,
          },
        },
      ],
    });

    if (filePaths.length === 0) {
      setAiError(TEXT.noFilesForAi);
      appendLog({
        level: "warning",
        title: TEXT.aiSkipped,
        message: TEXT.noSuitableFiles,
      });
      return;
    }

    setIsAnalyzingAI(true);
    setAiError(null);

    appendLog({
      level: "info",
      title: TEXT.aiAnalysisStarted,
      message: `${TEXT.aiSubmittedPrefix}${filePaths.length}${TEXT.aiSubmittedSuffix}`,
    });

    try {
      const res = await fetch("/api/analyze-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePaths,
          repositoryContext: context,
          settings: appSettings,
        }),
      });

      const data = (await res.json().catch(() => null)) as unknown;

      if (!res.ok) {
        const errorMessage =
          isAnalyzeRepoErrorResponse(data) && typeof data.error === "string"
            ? data.error
            : TEXT.aiConfigCheck;

        setAiError(errorMessage);
        appendLog({
          level: "error",
          title: TEXT.aiFailed,
          message: errorMessage,
          requestPayload: isAnalyzeRepoErrorResponse(data)
            ? buildModelRequestPayload(data.debug?.repositoryAnalysis)
            : undefined,
          responsePayload: isAnalyzeRepoErrorResponse(data)
            ? buildModelResponsePayload(data.debug?.repositoryAnalysis)
            : undefined,
        });
        return;
      }

      if (!isAnalyzeRepoSuccessResponse(data)) {
        setAiError(TEXT.invalidAiResponse);
        appendLog({
          level: "error",
          title: TEXT.aiFailed,
          message: TEXT.invalidAiResponse,
        });
        return;
      }

      setAiAnalysis(data.result);
      setSelectedFilePath(
        data.result.verifiedEntryPoint ?? data.result.entryPoints[0] ?? "",
      );
      appendLog({
        level: "success",
        title: TEXT.aiCompleted,
        message: summarizeAnalysisResult(data.result),
        requestPayload: buildModelRequestPayload(data.debug.repositoryAnalysis),
        responsePayload: buildModelResponsePayload(
          data.debug.repositoryAnalysis,
          data.result,
        ),
      });
      appendEntryVerificationLogs(
        data.debug.entryVerification,
        data.result.entryPoints.length,
      );
      appendFunctionOverviewLogs(
        data.result.functionCallOverview,
        data.debug.functionOverview,
      );
      appendFunctionModuleLogs(
        data.result.functionModules,
        data.debug.moduleAnalysis,
      );
    } catch (aiRequestError) {
      console.error("AI Analysis failed:", aiRequestError);
      setAiError(TEXT.aiRetryLater);
      appendLog({
        level: "error",
        title: TEXT.aiFailed,
        message: TEXT.aiRuntimeError,
      });
    } finally {
      setIsAnalyzingAI(false);
    }
  };

  const analyzeGitHubRepository = async (urlToAnalyze: string) => {
    const normalizedUrl = urlToAnalyze.trim();
    shouldPersistHistoryRef.current = true;
    autoLoadedHistoryRef.current = null;
    startLogSession(normalizedUrl);

    const parsed = parseGitHubUrl(normalizedUrl);
    if (!parsed) {
      setError(TEXT.invalidGitHubUrl);
      appendLog({
        level: "error",
        title: TEXT.githubValidationFailed,
        message: TEXT.invalidRepoMessage,
      });
      return;
    }

    appendLog({
      level: "info",
      title: TEXT.parseSuccess,
      message: `${TEXT.parsedRepoPrefix}${parsed.owner}/${parsed.repo}`,
    });

    try {
      await loadRepositoryAndAnalyze(
        {
          sourceType: "github",
          owner: parsed.owner,
          repo: parsed.repo,
        },
      );
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : TEXT.unknownError;

      setError(message);
      appendLog({
        level: "error",
        title: TEXT.repoLoadFailed,
        message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const analyzeLocalRepository = async (sourceId: string) => {
    shouldPersistHistoryRef.current = true;
    autoLoadedHistoryRef.current = null;
    startLogSession("本地项目");

    try {
      await loadRepositoryAndAnalyze(
        {
          sourceType: "local",
          sourceId,
        },
      );
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : TEXT.unknownError;

      setError(message);
      appendLog({
        level: "error",
        title: TEXT.repoLoadFailed,
        message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAutoAnalyzeGithub = useEffectEvent((normalizedUrl: string) => {
    setUrlInput(normalizedUrl);
    void analyzeGitHubRepository(normalizedUrl);
  });

  const handleAutoAnalyzeLocal = useEffectEvent((sourceId: string) => {
    void analyzeLocalRepository(sourceId);
  });

  useEffect(() => {
    const historyParam = searchParams.get("history")?.trim();

    if (historyParam && autoLoadedHistoryRef.current !== historyParam) {
      const restored = restoreFromHistory(historyParam);

      if (restored) {
        autoLoadedHistoryRef.current = historyParam;
        return;
      }
    }

    const sourceParam = searchParams.get("source")?.trim();
    if (sourceParam === "local") {
      const sourceId = searchParams.get("id")?.trim();

      if (!sourceId) {
        return;
      }

      const sourceKey = `local:${sourceId}`;
      if (autoAnalyzedSourceRef.current === sourceKey) {
        return;
      }

      autoAnalyzedSourceRef.current = sourceKey;
      handleAutoAnalyzeLocal(sourceId);
      return;
    }

    const repoParam = searchParams.get("repo");

    if (!repoParam) {
      return;
    }

    const sourceKey = `github:${repoParam}`;
    if (autoAnalyzedSourceRef.current === sourceKey) {
      return;
    }

    autoAnalyzedSourceRef.current = sourceKey;

    const normalizedUrl = repoParam.startsWith("http")
      ? repoParam
      : `https://github.com/${repoParam}`;

    handleAutoAnalyzeGithub(normalizedUrl);
  }, [searchParams]);

  const persistHistorySnapshot = useCallback(
    (
      analysisResultToPersist: AIAnalysisResult | null,
      logsToPersist: WorkLogEntry[],
    ): boolean => {
      if (!repoInfo || isLoading || isAnalyzingAI) {
        return false;
      }

      const fileList = flattenFileTreePaths(fileTree);
      if (fileList.length === 0) {
        return false;
      }

      const historyRecord = createAnalysisHistoryRecord({
        repoInfo:
          repoInfo.sourceType === "github"
            ? {
                sourceType: "github",
                projectName: repoInfo.projectName,
                owner: repoInfo.owner,
                repo: repoInfo.repo,
                branch: repoInfo.branch,
                repositoryUrl: repoInfo.repositoryUrl,
                description: repoInfo.repositoryDescription ?? null,
              }
            : {
                sourceType: "local",
                projectName: repoInfo.projectName,
                sourceId: repoInfo.sourceId,
                localPath: repoInfo.localPath,
                repositoryUrl: repoInfo.repositoryUrl,
                description: repoInfo.repositoryDescription ?? null,
              },
        fileList,
        analysisResult: analysisResultToPersist,
        workLogs: logsToPersist,
      });

      upsertAnalysisHistoryRecord(historyRecord);
      return true;
    },
    [fileTree, isAnalyzingAI, isLoading, repoInfo],
  );

  const persistCurrentAnalysisHistory = useCallback(() => {
    if (!shouldPersistHistoryRef.current) {
      return;
    }

    if (!persistHistorySnapshot(aiAnalysis, workLogs)) {
      return;
    }

    shouldPersistHistoryRef.current = false;
  }, [aiAnalysis, persistHistorySnapshot, workLogs]);

  useEffect(() => {
    persistCurrentAnalysisHistory();
  }, [persistCurrentAnalysisHistory]);

  useEffect(() => {
    if (!activeModuleId) {
      return;
    }

    if (aiAnalysis?.functionModules.some((module) => module.id === activeModuleId)) {
      return;
    }

    setActiveModuleId(null);
  }, [activeModuleId, aiAnalysis]);

  const handleAnalyzeClick = () => {
    const normalizedUrl = urlInput.trim();

    if (normalizedUrl) {
      setUrlInput(normalizedUrl);
      void analyzeGitHubRepository(normalizedUrl);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleAnalyzeClick();
    }
  };

  const handleManualDrillDown = async (nodePath: number[], nodeId: string) => {
    if (drillingNodeId || isLoading || isAnalyzingAI) {
      return;
    }

    if (!repoInfo || !aiAnalysis) {
      return;
    }

    const targetNode = getFunctionNodeByPath(
      aiAnalysis.functionCallOverview?.root ?? null,
      nodePath,
    );

    if (!targetNode) {
      appendLog({
        level: "error",
        title: "手动下钻失败",
        message: "未找到目标节点，请刷新后重试。",
      });
      return;
    }

    const filePaths = flattenFileTreePaths(fileTree);
    if (filePaths.length === 0) {
      appendLog({
        level: "warning",
        title: "手动下钻已跳过",
        message: "当前没有可用于分析的文件列表。",
      });
      return;
    }

    setDrillingNodeId(nodeId);
    appendLog({
      level: "info",
      title: "手动下钻",
      message: `函数：${targetNode.name}\n文件：${targetNode.filePath ?? TEXT.unknownFunctionFile}\n策略：仅下钻一层`,
    });

    try {
      const res = await fetch("/api/analyze-repo/drill-down", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePaths,
          repositoryContext: repoInfo,
          analysisResult: aiAnalysis,
          nodePath,
          settings: appSettings,
        }),
      });

      const data = (await res.json().catch(() => null)) as unknown;

      if (!res.ok) {
        const message =
          isAnalyzeRepoDrillDownErrorResponse(data) &&
          typeof data.error === "string"
            ? data.error
            : TEXT.aiConfigCheck;

        appendLog({
          level: "error",
          title: "手动下钻失败",
          message,
        });

        if (isAnalyzeRepoDrillDownErrorResponse(data)) {
          appendFunctionOverviewLogs(
            aiAnalysis.functionCallOverview,
            data.debug?.functionOverview ?? null,
          );
        }

        return;
      }

      if (!isAnalyzeRepoDrillDownSuccessResponse(data)) {
        appendLog({
          level: "error",
          title: "手动下钻失败",
          message: TEXT.invalidAiResponse,
        });
        return;
      }

      setAiAnalysis(data.result);
      appendFunctionOverviewLogs(
        data.result.functionCallOverview,
        data.debug.functionOverview,
      );

      if (data.debug.functionOverview?.status === "completed") {
        shouldPersistHistoryRef.current = true;
        persistHistorySnapshot(data.result, workLogs);
      }
    } catch (error) {
      console.error("Manual drill-down failed:", error);
      appendLog({
        level: "error",
        title: "手动下钻失败",
        message: TEXT.aiRuntimeError,
      });
    } finally {
      setDrillingNodeId(null);
    }
  };

  const stopResizing = useEffectEvent(() => {
    if (!resizeStateRef.current) {
      return;
    }

    resizeStateRef.current = null;
    setActiveResizeTarget(null);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });

  const handleResizeMove = useEffectEvent((event: PointerEvent) => {
    const resizeState = resizeStateRef.current;

    if (!resizeState) {
      return;
    }

    const baseLimits = PANEL_LIMITS[resizeState.target];
    const limits =
      resizeState.target === "overview"
        ? {
            ...baseLimits,
            max: getOverviewResizeMax(
              workspacePanelsRef.current?.clientWidth ?? window.innerWidth,
            ),
          }
        : baseLimits;
    const deltaX =
      (event.clientX - resizeState.startX) * (resizeState.invertDelta ? -1 : 1);
    const nextWidth = clampPanelWidth(
      resizeState.startWidth + deltaX,
      limits.min,
      limits.max,
    );

    switch (resizeState.target) {
      case "sidebar":
        setSidebarWidth(nextWidth);
        break;
      case "files":
        setFileTreeWidth(nextWidth);
        break;
      case "overview":
        setOverviewWidth(nextWidth);
        break;
      default:
        break;
    }
  });

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => handleResizeMove(event);
    const onPointerUp = () => stopResizing();

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  const startResizing = (
    target: ResizeTarget,
    event: React.PointerEvent<HTMLButtonElement>,
    options?: { invertDelta?: boolean },
  ) => {
    event.preventDefault();

    const currentWidth =
      target === "sidebar"
        ? sidebarWidth
        : target === "files"
          ? fileTreeWidth
          : overviewWidth;

    resizeStateRef.current = {
      target,
      startX: event.clientX,
      startWidth: currentWidth,
      invertDelta: options?.invertDelta,
    };
    setActiveResizeTarget(target);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const togglePanelVisibility = (panel: WorkspacePanelKey) => {
    setPanelVisibility((current) => ({
      ...current,
      [panel]: !current[panel],
    }));
  };

  const workflowStatus: WorkflowStatus =
    isLoading || isAnalyzingAI
      ? "running"
      : workLogs.length > 0
        ? "finished"
        : "idle";
  const moduleColorMap = useMemo(
    () => buildFunctionModuleColorMap(aiAnalysis?.functionModules ?? []),
    [aiAnalysis?.functionModules],
  );
  const moduleNodeCounts = useMemo(
    () => collectFunctionModuleNodeCounts(aiAnalysis?.functionCallOverview ?? null),
    [aiAnalysis?.functionCallOverview],
  );

  const isFilesVisible = panelVisibility.files;
  const isSourceVisible = panelVisibility.source;
  const isOverviewVisible = panelVisibility.overview;
  const hasVisibleWorkspacePanel =
    isFilesVisible || isSourceVisible || isOverviewVisible;
  const shouldShowFilesResizeHandle = isFilesVisible && isSourceVisible;
  const shouldFixFilesWidth = shouldShowFilesResizeHandle;
  const shouldShowOverviewResizeHandle =
    isOverviewVisible && (isFilesVisible || isSourceVisible);
  const shouldFixOverviewWidth = shouldShowOverviewResizeHandle;

  return (
    <>
      <div className="h-dvh overflow-hidden bg-white dark:bg-gray-950">
        <div className="flex h-full min-w-0 text-gray-900 dark:text-gray-100">
          <div
            className="flex h-full flex-shrink-0 flex-col bg-gray-50/50 dark:bg-gray-900/50"
            style={{ width: `${sidebarWidth}px` }}
          >
          <div className="flex items-center gap-2 border-b border-gray-200 p-4 dark:border-gray-800">
            <Link
              href="/"
              className="rounded-md p-2 transition-colors hover:bg-gray-200 dark:hover:bg-gray-800"
              aria-label={TEXT.backHome}
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="flex items-center gap-2 font-semibold">
              {repoInfo?.sourceType === "local" ? (
                <FolderOpen className="h-5 w-5" />
              ) : (
                <SiGithub className="h-5 w-5" />
              )}
              <span>{TEXT.brand}</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex flex-col gap-4">
              <WorkLogPanel
                logs={workLogs}
                workflowStatus={workflowStatus}
                onOpenFullscreen={() => setIsLogFullscreenOpen(true)}
              />

              {repoInfo?.sourceType === "local" ? (
                <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    项目来源
                  </p>
                  <p className="mt-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {repoInfo.projectName}
                  </p>
                  <p
                    className="mt-1 truncate font-mono text-xs text-gray-500 dark:text-gray-400"
                    title={repoInfo.localPath}
                  >
                    {repoInfo.localPath}
                  </p>
                  <p className="mt-2 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
                    本地目录请返回首页重新选择；当前页面支持浏览文件、查看源码和继续下钻分析。
                  </p>
                </div>
              ) : (
                <>
                  <div>
                    <label
                      htmlFor="repo-url"
                      className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400"
                    >
                      {TEXT.repoUrl}
                    </label>
                    <input
                      id="repo-url"
                      type="text"
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="https://github.com/owner/repo"
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950"
                    />
                  </div>

                  <button
                    onClick={handleAnalyzeClick}
                    disabled={isLoading || !urlInput.trim()}
                    className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-blue-600 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>{TEXT.analyzing}</span>
                      </>
                    ) : (
                      TEXT.startAnalyze
                    )}
                  </button>
                </>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-600 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {(isAnalyzingAI || aiAnalysis || aiError) && (
                <div className="border-t border-gray-200 pt-4 dark:border-gray-800">
                  <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wider text-gray-700 dark:text-gray-300">
                    <Sparkles className="h-3.5 w-3.5 text-blue-500" />
                    <span>{TEXT.aiAnalysis}</span>
                    {isAnalyzingAI && (
                      <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                    )}
                  </h3>

                  {isAnalyzingAI ? (
                    <div className="space-y-3">
                      <div className="h-4 w-full animate-pulse rounded bg-gray-200 dark:bg-gray-800"></div>
                      <div className="h-4 w-5/6 animate-pulse rounded bg-gray-200 dark:bg-gray-800"></div>
                      <div className="mt-4 h-8 w-full animate-pulse rounded bg-gray-200 dark:bg-gray-800"></div>
                    </div>
                  ) : aiError ? (
                    <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-600 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{aiError}</span>
                    </div>
                  ) : aiAnalysis ? (
                    <div className="space-y-4 text-sm">
                      <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                        {aiAnalysis.summary}
                      </p>

                      {aiAnalysis.primaryLanguages.length > 0 && (
                        <div>
                          <h4 className="mb-1.5 text-xs text-gray-500 dark:text-gray-500">
                            {TEXT.primaryLanguages}
                          </h4>
                          <div className="flex flex-wrap gap-1.5">
                            {aiAnalysis.primaryLanguages.map((lang) => (
                              <span
                                key={lang}
                                className="rounded border border-blue-100 bg-blue-50 px-2 py-0.5 text-xs text-blue-600 dark:border-blue-800/50 dark:bg-blue-900/30 dark:text-blue-400"
                              >
                                {lang}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {aiAnalysis.techStack.length > 0 && (
                        <div>
                          <h4 className="mb-1.5 text-xs text-gray-500 dark:text-gray-500">
                            {TEXT.techStack}
                          </h4>
                          <div className="flex flex-wrap gap-1.5">
                            {aiAnalysis.techStack.map((tech) => (
                              <span
                                key={tech}
                                className="rounded border border-gray-200 bg-gray-100 px-2 py-0.5 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                              >
                                {tech}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {aiAnalysis.functionModules.length > 0 && (
                        <div>
                          <h4 className="mb-1.5 text-xs text-gray-500 dark:text-gray-500">
                            {TEXT.functionModules}
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => setActiveModuleId(null)}
                              className={cn(
                                "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                                activeModuleId === null
                                  ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800",
                              )}
                            >
                              {TEXT.allModules}
                            </button>
                            {aiAnalysis.functionModules.map((module) => {
                              const color = getFunctionModuleColor(
                                module.id,
                                moduleColorMap,
                              );
                              const isActive = activeModuleId === module.id;
                              const nodeCount = moduleNodeCounts.get(module.id) ?? 0;

                              return (
                                <button
                                  key={module.id}
                                  type="button"
                                  onClick={() =>
                                    setActiveModuleId((current) =>
                                      current === module.id ? null : module.id,
                                    )
                                  }
                                  className={cn(
                                    "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-shadow",
                                    isActive && "ring-2 ring-offset-1 ring-slate-300",
                                  )}
                                  style={{
                                    borderColor: color.border,
                                    backgroundColor: color.soft,
                                    color: color.text,
                                  }}
                                  title={module.summary}
                                >
                                  {module.name}
                                  <span className="ml-1 opacity-80">({nodeCount})</span>
                                </button>
                              );
                            })}
                          </div>
                          <p className="mt-2 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
                            {TEXT.moduleFilterHint}
                          </p>
                        </div>
                      )}

                      <div>
                        <h4 className="mb-1.5 text-xs text-gray-500 dark:text-gray-500">
                          {TEXT.confirmedEntryPoint}
                        </h4>

                        {aiAnalysis.verifiedEntryPoint ? (
                          <div className="space-y-2">
                            <p
                              className="truncate font-mono text-xs text-emerald-600 dark:text-emerald-400"
                              title={aiAnalysis.verifiedEntryPoint}
                            >
                              {aiAnalysis.verifiedEntryPoint}
                            </p>
                            {aiAnalysis.verifiedEntryPointReason && (
                              <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                                {aiAnalysis.verifiedEntryPointReason}
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                            {TEXT.confirmedEntryPointFallback}
                          </p>
                        )}
                      </div>

                      {aiAnalysis.functionCallOverview?.root ? (
                        <>
                          <div>
                            <h4 className="mb-1.5 text-xs text-gray-500 dark:text-gray-500">
                              {TEXT.entryFunction}
                            </h4>
                            <div className="space-y-2">
                              <p className="font-mono text-xs text-blue-600 dark:text-blue-400">
                                {aiAnalysis.functionCallOverview.root.name}
                              </p>
                              <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                                {aiAnalysis.functionCallOverview.root.summary}
                              </p>
                            </div>
                          </div>

                          <div>
                            <h4 className="mb-1.5 text-xs text-gray-500 dark:text-gray-500">
                              {TEXT.keySubFunctions}
                            </h4>
                            <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                              {summarizeFunctionOverview(
                                aiAnalysis.functionCallOverview,
                              )}
                            </p>
                            {collectFunctionDescendants(
                              aiAnalysis.functionCallOverview.root,
                            ).length > 0 && (
                              <ul className="mt-2 space-y-1.5">
                                {collectFunctionDescendants(
                                  aiAnalysis.functionCallOverview.root,
                                ).map((child, index) => {
                                  const routeLabel = getFunctionCallNodeRouteLabel(child);

                                  return (
                                    <li
                                      key={`${child.name}-${child.filePath ?? "unknown"}-${routeLabel ?? "no-route"}-${index}`}
                                      className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-300"
                                    >
                                      <p className="font-mono text-[11px] text-gray-800 dark:text-gray-100">
                                        {child.name}
                                      </p>
                                      <p className="mt-1 truncate text-[11px] text-gray-500 dark:text-gray-400">
                                        {child.filePath ?? TEXT.unknownFunctionFile}
                                      </p>
                                      {routeLabel && (
                                        <p
                                          className="mt-1 truncate font-mono text-[11px] text-sky-600 dark:text-sky-300"
                                          title={routeLabel}
                                        >
                                          URL: {routeLabel}
                                        </p>
                                      )}
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </div>
                        </>
                      ) : (
                        <div>
                          <h4 className="mb-1.5 text-xs text-gray-500 dark:text-gray-500">
                            {TEXT.keySubFunctions}
                          </h4>
                          <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                            {TEXT.functionOverviewUnavailable}
                          </p>
                        </div>
                      )}

                      {aiAnalysis.entryPoints.length > 0 && (
                        <div>
                          <h4 className="mb-1.5 text-xs text-gray-500 dark:text-gray-500">
                            {TEXT.entryPoints}
                          </h4>
                          <ul className="space-y-1">
                            {aiAnalysis.entryPoints.map((entryPoint) => (
                              <li
                                key={entryPoint}
                                className="truncate font-mono text-xs text-gray-600 dark:text-gray-400"
                                title={entryPoint}
                              >
                                {entryPoint}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          {repoInfo && (
            <div className="mt-auto border-t border-gray-200 px-4 py-2 dark:border-gray-800">
              <div className="mb-1 text-xs text-gray-500 dark:text-gray-400">
                {repoInfo.sourceType === "github" ? TEXT.currentRepo : "当前项目"}
              </div>
              <div
                className="truncate text-sm font-medium"
                title={buildRepositoryLocationLabel(repoInfo)}
              >
                {buildRepositoryLocationLabel(repoInfo)}
              </div>
              <div className="mt-1 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                <span className="h-2 w-2 rounded-full bg-green-500"></span>
                {repoInfo.sourceType === "github" ? (
                  <>
                    {TEXT.branchPrefix}
                    {repoInfo.branch}
                  </>
                ) : (
                  <>
                    路径：
                    <span className="truncate" title={repoInfo.localPath}>
                      {repoInfo.localPath}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}
          </div>

          <ResizeHandle
            isActive={activeResizeTarget === "sidebar"}
            onPointerDown={(event) => startResizing("sidebar", event)}
            label={TEXT.panelDisplay}
          />

          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-end border-b border-gray-200 bg-white/90 px-4 py-2 backdrop-blur dark:border-gray-800 dark:bg-gray-950/90">
              <div className="flex w-full flex-wrap items-center justify-between gap-2">
                <AppSettingsDialog />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mr-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                    {TEXT.panelDisplay}
                  </span>
                  <PanelToggleButton
                    active={isFilesVisible}
                    label={TEXT.panelFiles}
                    onClick={() => togglePanelVisibility("files")}
                  />
                  <PanelToggleButton
                    active={isSourceVisible}
                    label={TEXT.panelSource}
                    onClick={() => togglePanelVisibility("source")}
                  />
                  <PanelToggleButton
                    active={isOverviewVisible}
                    label={TEXT.panelOverview}
                    onClick={() => togglePanelVisibility("overview")}
                  />
                </div>
              </div>
            </div>

            <div
              ref={workspacePanelsRef}
              className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
            >
              {isFilesVisible && (
                <div
                  className={cn(
                    "flex h-full min-w-0 flex-col bg-white dark:bg-gray-950",
                    shouldFixFilesWidth ? "flex-shrink-0" : "flex-1",
                  )}
                  style={
                    shouldFixFilesWidth ? { width: `${fileTreeWidth}px` } : undefined
                  }
                >
                  <div className="border-b border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
                    <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      {TEXT.projectFiles}
                    </h2>
                  </div>
                  <div className="relative flex-1 overflow-hidden">
                    {isLoading ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-400">
                        <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                        <span className="text-sm">{TEXT.loadingTree}</span>
                      </div>
                    ) : fileTree.length > 0 ? (
                      <FileTree
                        nodes={fileTree}
                        onSelectFile={setSelectedFilePath}
                        selectedPath={selectedFilePath}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center p-4 text-center text-sm text-gray-400">
                        {repoInfo?.sourceType === "local"
                          ? "未读取到本地项目文件。"
                          : TEXT.enterValidUrl}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {shouldShowFilesResizeHandle && (
                <ResizeHandle
                  isActive={activeResizeTarget === "files"}
                  onPointerDown={(event) => startResizing("files", event)}
                  label={TEXT.panelFiles}
                />
              )}

              {isSourceVisible && (
                <div className="min-w-0 flex-1 overflow-hidden bg-[#1e1e1e]">
                  {repoInfo ? (
                    <CodeViewer
                      appSettings={appSettings}
                      repositoryContext={repoInfo}
                      path={selectedFilePath}
                    />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center bg-gray-50 text-gray-500 dark:bg-[#1e1e1e]">
                      <FolderOpen className="mb-4 h-16 w-16 text-gray-300 dark:text-gray-700" />
                      <p className="text-lg font-medium text-gray-600 dark:text-gray-400">
                        {TEXT.noRepoSelected}
                      </p>
                      <p className="mt-2 text-sm text-gray-400">{TEXT.useLeftPanel}</p>
                    </div>
                  )}
                </div>
              )}

              {shouldShowOverviewResizeHandle && (
                <ResizeHandle
                  isActive={activeResizeTarget === "overview"}
                  onPointerDown={(event) =>
                    startResizing("overview", event, { invertDelta: true })
                  }
                  label={TEXT.panelOverview}
                />
              )}

              {isOverviewVisible && (
                <div
                  className={cn(
                    "flex h-full min-w-0 overflow-hidden",
                    shouldFixOverviewWidth ? "flex-shrink-0" : "flex-1",
                  )}
                  style={
                    shouldFixOverviewWidth ? { width: `${overviewWidth}px` } : undefined
                  }
                >
                  <FunctionOverviewPanel
                    overview={aiAnalysis?.functionCallOverview ?? null}
                    modules={aiAnalysis?.functionModules ?? []}
                    activeModuleId={activeModuleId}
                    selectedFilePath={selectedFilePath}
                    onSelectFile={setSelectedFilePath}
                    onDrillDownNode={handleManualDrillDown}
                    drillingNodeId={drillingNodeId}
                    isLoading={isAnalyzingAI}
                    emptyMessage={
                      aiAnalysis
                        ? TEXT.functionOverviewUnavailable
                        : TEXT.functionOverviewPending
                    }
                  />
                </div>
              )}

              {!hasVisibleWorkspacePanel && (
                <div className="flex min-w-0 flex-1 items-center justify-center bg-gray-50 px-6 text-center text-sm text-gray-500 dark:bg-gray-950 dark:text-gray-400">
                  {TEXT.allPanelsHidden}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <WorkLogFullscreenDialog
        logs={workLogs}
        open={isLogFullscreenOpen}
        onClose={() => setIsLogFullscreenOpen(false)}
      />
    </>
  );
}

export default function AnalyzePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-white dark:bg-gray-950">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      }
    >
      <AnalyzePageContent />
    </Suspense>
  );
}
