"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Code2, FolderOpen, Loader2, Search } from "lucide-react";
import { SiGithub } from "react-icons/si";

import { AppSettingsDialog } from "@/components/AppSettingsDialog";
import {
  getAnalysisHistoryServerSnapshot,
  getAnalysisHistorySnapshot,
  subscribeAnalysisHistory,
  type AnalysisHistoryRecord,
} from "@/lib/analysisHistory";
import { createLocalRepositorySnapshot } from "@/services/repositoryService";
import { parseGitHubUrl } from "@/utils/github";

type HomeMode = "github" | "local";

type LocalUploadFile = {
  path: string;
  file: File;
};

type LocalDirectoryHandle = {
  name: string;
  entries(): AsyncIterable<[string, LocalFileSystemHandle]>;
};

type LocalFileHandle = {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
};

type LocalSubdirectoryHandle = {
  kind: "directory";
  name: string;
  entries(): AsyncIterable<[string, LocalFileSystemHandle]>;
};

type LocalFileSystemHandle = LocalFileHandle | LocalSubdirectoryHandle;

type DirectoryPickerWindow = Window &
  typeof globalThis & {
    showDirectoryPicker?: () => Promise<LocalDirectoryHandle>;
  };

const LOCAL_IGNORED_DIRECTORIES = new Set([
  ".git",
  ".idea",
  ".next",
  ".turbo",
  ".vscode",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "vendor",
]);

const LOCAL_DIRECTORY_INPUT_PROPS = {
  webkitdirectory: "",
  directory: "",
} as Record<string, string>;

const TEXT = {
  emptyUrl: "请输入 GitHub 仓库地址",
  invalidUrl:
    "GitHub 地址格式不正确，例如：https://github.com/owner/repo",
  emptyLocalProject: "未检测到可上传的本地项目文件，请重新选择目录。",
  title: "代码分析器",
  subtitle:
    "支持 GitHub 仓库和本地项目两种模式，统一查看项目结构、源码内容与 AI 分析结果。",
  githubTab: "GitHub 项目",
  localTab: "本地项目",
  analyze: "开始分析",
  localAnalyze: "选择本地目录",
  localPreparing: "正在准备本地项目…",
  localHint:
    "会自动跳过 .git、node_modules、.next、dist 等常见生成目录，并将目录快照上传到本地服务端分析。",
  localLastSelectionPrefix: "最近一次选择：",
  localFallbackHint:
    "如果浏览器不支持目录选择器，将自动回退为目录文件上传模式。",
  feature1Title: "结构可视化",
  feature1Desc:
    "统一展示项目文件树，支持在 GitHub 和本地项目之间切换分析来源。",
  feature2Title: "语法高亮",
  feature2Desc:
    "源代码内容按语言高亮展示，便于快速定位入口文件和关键实现。",
  feature3Title: "AI 辅助分析",
  feature3Desc:
    "自动识别主要语言、技术栈标签、入口文件与关键函数调用链。",
  historyTitle: "历史分析记录",
  historyEmpty:
    "还没有历史记录。完成一次 GitHub 或本地项目分析后，这里会展示已保存的结果。",
  historyLanguagePrefix: "语言：",
  historyUnknownLanguage: "未识别",
  historySourceGithub: "GitHub",
  historySourceLocal: "本地",
  historyLocationPrefix: "位置：",
  historyUpdatedPrefix: "更新时间：",
} as const;

function normalizeLocalRelativePath(path: string): string | null {
  const normalized = path.trim().replace(/\\/g, "/");

  if (!normalized) {
    return null;
  }

  const segments = normalized.split("/").filter(Boolean);

  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    return null;
  }

  return segments.join("/");
}

function shouldIgnoreLocalPath(path: string): boolean {
  return path
    .split("/")
    .some((segment) => LOCAL_IGNORED_DIRECTORIES.has(segment.toLowerCase()));
}

async function collectFilesFromDirectoryHandle(
  handle: LocalDirectoryHandle,
  prefix = "",
): Promise<LocalUploadFile[]> {
  const files: LocalUploadFile[] = [];

  for await (const [name, entry] of handle.entries()) {
    const nextPath = prefix ? `${prefix}/${name}` : name;

    if (shouldIgnoreLocalPath(nextPath)) {
      continue;
    }

    if (entry.kind === "directory") {
      files.push(...(await collectFilesFromDirectoryHandle(entry, nextPath)));
      continue;
    }

    files.push({
      path: nextPath,
      file: await entry.getFile(),
    });
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function createLocalUploadEntriesFromFileList(
  fileList: FileList | null,
): {
  projectName: string;
  localPath: string;
  files: LocalUploadFile[];
} | null {
  if (!fileList || fileList.length === 0) {
    return null;
  }

  const files = Array.from(fileList)
    .map((file) => {
      const relativePath = normalizeLocalRelativePath(file.webkitRelativePath);

      if (!relativePath || shouldIgnoreLocalPath(relativePath)) {
        return null;
      }

      const firstSlashIndex = relativePath.indexOf("/");
      const projectName =
        firstSlashIndex >= 0
          ? relativePath.slice(0, firstSlashIndex)
          : relativePath;
      const projectRelativePath =
        firstSlashIndex >= 0
          ? relativePath.slice(firstSlashIndex + 1)
          : file.name;

      if (!projectRelativePath) {
        return null;
      }

      return {
        projectName,
        path: projectRelativePath,
        file,
      };
    })
    .filter((item): item is { projectName: string; path: string; file: File } => {
      return item !== null;
    });

  if (files.length === 0) {
    return null;
  }

  const projectName = files[0]?.projectName ?? "local-project";

  return {
    projectName,
    localPath: projectName,
    files: files.map((item) => ({
      path: item.path,
      file: item.file,
    })),
  };
}

export default function Home() {
  const [mode, setMode] = useState<HomeMode>("github");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [localError, setLocalError] = useState("");
  const [isPreparingLocal, setIsPreparingLocal] = useState(false);
  const [lastLocalSelection, setLastLocalSelection] = useState("");
  const localFileInputRef = useRef<HTMLInputElement | null>(null);
  const historyRecords = useSyncExternalStore<AnalysisHistoryRecord[]>(
    subscribeAnalysisHistory,
    getAnalysisHistorySnapshot,
    getAnalysisHistoryServerSnapshot,
  );
  const router = useRouter();

  const formatHistoryTime = (timestamp: string) => {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return timestamp;
    }

    return date.toLocaleString("zh-CN", {
      hour12: false,
    });
  };

  const handleOpenHistory = (record: AnalysisHistoryRecord) => {
    const params = new URLSearchParams({
      history: record.id,
    });

    if (record.sourceType === "github") {
      params.set("repo", `${record.owner}/${record.repo}`);
    } else {
      params.set("source", "local");
      params.set("id", record.sourceId);
    }

    router.push(`/analyze?${params.toString()}`);
  };

  const getHistorySourceLabel = (record: AnalysisHistoryRecord) => {
    return record.sourceType === "github"
      ? TEXT.historySourceGithub
      : TEXT.historySourceLocal;
  };

  const getHistoryLocationLabel = (record: AnalysisHistoryRecord) => {
    return record.sourceType === "github"
      ? `${record.owner}/${record.repo}`
      : record.localPath;
  };

  const uploadLocalSelection = async (selection: {
    projectName: string;
    localPath: string;
    files: LocalUploadFile[];
  }) => {
    setIsPreparingLocal(true);
    setLocalError("");
    setLastLocalSelection(selection.localPath);

    try {
      const result = await createLocalRepositorySnapshot(selection);
      router.push(`/analyze?source=local&id=${result.sourceId}`);
    } catch (uploadError) {
      setLocalError(
        uploadError instanceof Error
          ? uploadError.message
          : TEXT.emptyLocalProject,
      );
    } finally {
      setIsPreparingLocal(false);
    }
  };

  const handlePickLocalDirectory = async () => {
    const pickerWindow = window as DirectoryPickerWindow;
    setLocalError("");

    if (typeof pickerWindow.showDirectoryPicker === "function") {
      try {
        const handle = await pickerWindow.showDirectoryPicker();
        const files = await collectFilesFromDirectoryHandle(handle);

        if (files.length === 0) {
          setLocalError(TEXT.emptyLocalProject);
          return;
        }

        await uploadLocalSelection({
          projectName: handle.name,
          localPath: handle.name,
          files,
        });
      } catch (pickError) {
        if (pickError instanceof DOMException && pickError.name === "AbortError") {
          return;
        }

        setLocalError(
          pickError instanceof Error ? pickError.message : TEXT.emptyLocalProject,
        );
      }

      return;
    }

    localFileInputRef.current?.click();
  };

  const handleLocalFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const selection = createLocalUploadEntriesFromFileList(event.currentTarget.files);
    event.currentTarget.value = "";

    if (!selection) {
      setLocalError(TEXT.emptyLocalProject);
      return;
    }

    await uploadLocalSelection(selection);
  };

  const handleAnalyze = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const normalizedUrl = url.trim();

    if (!normalizedUrl) {
      setError(TEXT.emptyUrl);
      return;
    }

    const parsed = parseGitHubUrl(normalizedUrl);
    if (!parsed) {
      setError(TEXT.invalidUrl);
      return;
    }

    router.push(`/analyze?repo=${parsed.owner}/${parsed.repo}`);
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-gray-50 p-4 dark:bg-gray-950">
      <div className="absolute top-1/2 left-1/2 -z-10 h-[800px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/5 blur-3xl dark:bg-blue-500/10" />
      <div className="absolute top-4 right-4 z-10">
        <AppSettingsDialog />
      </div>

      <main className="w-full max-w-2xl space-y-12 text-center">
        <div className="space-y-6">
          <div className="flex justify-center">
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              {mode === "github" ? (
                <SiGithub className="h-16 w-16 text-gray-900 dark:text-white" />
              ) : (
                <FolderOpen className="h-16 w-16 text-gray-900 dark:text-white" />
              )}
            </div>
          </div>

          <div className="space-y-4">
            <h1 className="text-4xl font-bold tracking-tight text-gray-900 md:text-5xl dark:text-white">
              {TEXT.title}
            </h1>
            <p className="mx-auto max-w-xl text-lg text-gray-600 dark:text-gray-400">
              {TEXT.subtitle}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-lg dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-6 inline-flex rounded-full border border-gray-200 bg-gray-100 p-1 dark:border-gray-800 dark:bg-gray-950">
            <button
              type="button"
              onClick={() => setMode("github")}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                mode === "github"
                  ? "bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-white"
                  : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              }`}
            >
              {TEXT.githubTab}
            </button>
            <button
              type="button"
              onClick={() => setMode("local")}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                mode === "local"
                  ? "bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-white"
                  : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              }`}
            >
              {TEXT.localTab}
            </button>
          </div>

          {mode === "github" ? (
            <>
              <form onSubmit={handleAnalyze} className="space-y-4">
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                    <Search className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      setError("");
                    }}
                    className="block w-full rounded-xl border border-gray-300 bg-gray-50 py-4 pr-4 pl-11 text-lg text-gray-900 transition-shadow focus:border-blue-500 focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-950 dark:text-white"
                    placeholder="https://github.com/facebook/react"
                    autoFocus
                  />
                </div>

                {error && <p className="px-2 text-left text-sm text-red-500">{error}</p>}

                <button
                  type="submit"
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-transparent bg-blue-600 px-8 py-4 text-lg font-medium text-white transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none"
                >
                  <Code2 className="h-5 w-5" />
                  {TEXT.analyze}
                </button>
              </form>
            </>
          ) : (
            <div className="space-y-4 text-left">
              <input
                ref={localFileInputRef}
                type="file"
                multiple
                onChange={handleLocalFileChange}
                className="hidden"
                {...LOCAL_DIRECTORY_INPUT_PROPS}
              />

              <button
                type="button"
                onClick={handlePickLocalDirectory}
                disabled={isPreparingLocal}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-transparent bg-blue-600 px-8 py-4 text-lg font-medium text-white transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPreparingLocal ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    {TEXT.localPreparing}
                  </>
                ) : (
                  <>
                    <FolderOpen className="h-5 w-5" />
                    {TEXT.localAnalyze}
                  </>
                )}
              </button>

              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm leading-relaxed text-gray-600 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300">
                {TEXT.localHint}
              </div>

              <p className="text-xs text-gray-500 dark:text-gray-400">
                {TEXT.localFallbackHint}
              </p>

              {lastLocalSelection && (
                <p className="truncate font-mono text-xs text-gray-500 dark:text-gray-400">
                  {TEXT.localLastSelectionPrefix}
                  {lastLocalSelection}
                </p>
              )}

              {localError && (
                <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400">
                  {localError}
                </p>
              )}
            </div>
          )}

          <div className="mt-6 border-t border-gray-200 pt-6 text-left dark:border-gray-800">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                {TEXT.historyTitle}
              </h2>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {historyRecords.length}
              </span>
            </div>

            {historyRecords.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-xs leading-relaxed text-gray-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-400">
                {TEXT.historyEmpty}
              </div>
            ) : (
              <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
                {historyRecords.map((record) => (
                  <button
                    key={record.id}
                    type="button"
                    onClick={() => handleOpenHistory(record)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/70 dark:border-gray-700 dark:bg-gray-950 dark:hover:border-blue-700 dark:hover:bg-blue-950/30"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {record.projectName}
                      </p>
                      <span className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
                        {getHistorySourceLabel(record)}
                      </span>
                    </div>

                    <p
                      className="mt-1 truncate font-mono text-xs text-gray-600 dark:text-gray-300"
                      title={record.repositoryUrl}
                    >
                      {record.repositoryUrl}
                    </p>

                    <p className="mt-1 truncate text-[11px] text-gray-500 dark:text-gray-400">
                      {TEXT.historyLocationPrefix}
                      {getHistoryLocationLabel(record)}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700 dark:border-blue-800/60 dark:bg-blue-900/30 dark:text-blue-300">
                        {TEXT.historyLanguagePrefix}
                        {record.primaryLanguages[0] ?? TEXT.historyUnknownLanguage}
                      </span>

                      {record.techStack.slice(0, 2).map((item) => (
                        <span
                          key={`${record.id}-${item}`}
                          className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                        >
                          {item}
                        </span>
                      ))}
                    </div>

                    <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
                      {TEXT.historyUpdatedPrefix}
                      {formatHistoryTime(record.updatedAt)}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 border-t border-gray-200 pt-8 text-left md:grid-cols-3 dark:border-gray-800">
          <div>
            <h3 className="mb-2 font-semibold text-gray-900 dark:text-white">
              {TEXT.feature1Title}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {TEXT.feature1Desc}
            </p>
          </div>
          <div>
            <h3 className="mb-2 font-semibold text-gray-900 dark:text-white">
              {TEXT.feature2Title}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {TEXT.feature2Desc}
            </p>
          </div>
          <div>
            <h3 className="mb-2 font-semibold text-gray-900 dark:text-white">
              {TEXT.feature3Title}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {TEXT.feature3Desc}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
