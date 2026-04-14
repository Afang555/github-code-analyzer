export type { FileNode, GitHubRepositoryInfo } from "@/types/github";

import type { FileNode, GitHubRepositoryInfo } from "@/types/github";

const TEXT = {
  invalidJson: "服务返回了无效的 JSON。",
  requestFailedPrefix: "请求失败：",
} as const;

function buildApiUrl(pathname: string, params: Record<string, string>): string {
  const searchParams = new URLSearchParams(params);
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

export async function getRepositoryInfo(
  owner: string,
  repo: string,
): Promise<GitHubRepositoryInfo> {
  const response = await fetch(
    buildApiUrl("/api/github/repo-info", {
      owner,
      repo,
    }),
    {
      cache: "no-store",
    },
  );

  return parseJsonResponse<GitHubRepositoryInfo>(response);
}

export async function getRepositoryTree(
  owner: string,
  repo: string,
  branch: string,
): Promise<FileNode[]> {
  const response = await fetch(
    buildApiUrl("/api/github/repo-tree", {
      owner,
      repo,
      branch,
    }),
    {
      cache: "no-store",
    },
  );
  const payload = await parseJsonResponse<{ tree: FileNode[] }>(response);

  return payload.tree;
}

export async function getFileContent(
  owner: string,
  repo: string,
  branch: string,
  path: string,
): Promise<string> {
  const response = await fetch(
    buildApiUrl("/api/github/file-content", {
      owner,
      repo,
      branch,
      path,
    }),
    {
      cache: "no-store",
    },
  );
  const payload = await parseJsonResponse<{ content: string }>(response);

  return payload.content;
}
