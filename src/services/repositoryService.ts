export type { FileNode } from "@/types/repository";
export type {
  RepositoryContext,
  RepositoryDescriptor,
} from "@/types/repository";

import {
  APP_GITHUB_TOKEN_HEADER,
  getGitHubTokenOverride,
  type AppSettingsInput,
} from "@/lib/appSettings";
import type {
  FileNode,
  RepositoryAccessContext,
  RepositoryContext,
  RepositoryDescriptor,
} from "@/types/repository";
import {
  appendRepositoryContextSearchParams,
  appendRepositoryDescriptorSearchParams,
} from "@/types/repository";

const TEXT = {
  invalidJson: "服务返回了无效的 JSON。",
  requestFailedPrefix: "请求失败：",
  localSnapshotCreateFailed: "创建本地项目快照失败。",
} as const;

function buildApiUrl(
  pathname: string,
  append: (searchParams: URLSearchParams) => URLSearchParams,
): string {
  const searchParams = append(new URLSearchParams());
  return `${pathname}?${searchParams.toString()}`;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `${TEXT.requestFailedPrefix}${response.status} ${response.statusText}`;

    throw new Error(message);
  }

  if (!payload) {
    throw new Error(TEXT.invalidJson);
  }

  return payload as T;
}

function buildRepositoryRequestHeaders(
  settings?: AppSettingsInput,
): HeadersInit | undefined {
  const githubToken = getGitHubTokenOverride(settings);

  if (!githubToken) {
    return undefined;
  }

  return {
    [APP_GITHUB_TOKEN_HEADER]: githubToken,
  };
}

export async function getRepositoryInfo(
  descriptor: RepositoryDescriptor,
  settings?: AppSettingsInput,
): Promise<RepositoryContext> {
  const response = await fetch(
    buildApiUrl("/api/repository/info", (searchParams) =>
      appendRepositoryDescriptorSearchParams(searchParams, descriptor),
    ),
    {
      cache: "no-store",
      headers: buildRepositoryRequestHeaders(settings),
    },
  );

  return parseJsonResponse<RepositoryContext>(response);
}

export async function getRepositoryTree(
  context: RepositoryAccessContext,
  settings?: AppSettingsInput,
): Promise<FileNode[]> {
  const response = await fetch(
    buildApiUrl("/api/repository/tree", (searchParams) =>
      appendRepositoryContextSearchParams(searchParams, context),
    ),
    {
      cache: "no-store",
      headers: buildRepositoryRequestHeaders(settings),
    },
  );
  const payload = await parseJsonResponse<{ tree: FileNode[] }>(response);

  return payload.tree;
}

export async function getFileContent(
  context: RepositoryAccessContext,
  path: string,
  settings?: AppSettingsInput,
): Promise<string> {
  const response = await fetch(
    buildApiUrl("/api/repository/file-content", (searchParams) => {
      appendRepositoryContextSearchParams(searchParams, context);
      searchParams.set("path", path);
      return searchParams;
    }),
    {
      cache: "no-store",
      headers: buildRepositoryRequestHeaders(settings),
    },
  );
  const payload = await parseJsonResponse<{ content: string }>(response);

  return payload.content;
}

export async function createLocalRepositorySnapshot(args: {
  projectName: string;
  localPath: string;
  files: Array<{
    path: string;
    file: File;
  }>;
}): Promise<{
  sourceId: string;
  projectName: string;
  localPath: string;
  fileCount: number;
}> {
  const formData = new FormData();
  formData.set("projectName", args.projectName);
  formData.set("localPath", args.localPath);
  formData.set(
    "manifest",
    JSON.stringify(args.files.map((item) => item.path.replace(/\\/g, "/"))),
  );

  for (const item of args.files) {
    formData.append("files", item.file);
  }

  const response = await fetch("/api/local/snapshot", {
    method: "POST",
    body: formData,
  });
  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : TEXT.localSnapshotCreateFailed;

    throw new Error(message);
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    typeof (payload as { sourceId?: unknown }).sourceId !== "string"
  ) {
    throw new Error(TEXT.invalidJson);
  }

  return payload as {
    sourceId: string;
    projectName: string;
    localPath: string;
    fileCount: number;
  };
}
