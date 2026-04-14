import "server-only";

import type { FileNode, GitHubNode, GitHubRepositoryInfo } from "@/types/github";

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const GITHUB_USER_AGENT = "github-code-analyzer";
const REPO_INFO_CACHE_TTL_MS = 5 * 60 * 1000;
const REPO_TREE_CACHE_TTL_MS = 5 * 60 * 1000;

const TEXT = {
  repoNotFound: "未找到该仓库，请检查地址是否正确。",
  rateLimit: "GitHub API 访问频率已达上限。",
  rateLimitNoTokenHint:
    "当前未配置 GITHUB_TOKEN 或 GITHUB_API_TOKEN，请在 .env.local 中配置 GitHub Personal Access Token 后重试。",
  rateLimitTokenHint:
    "当前已配置 GitHub Token，但依然命中 GitHub API 限流，请稍后再试或更换配额更高的 Token。",
  rateLimitResetPrefix: "预计重置时间：",
  rateLimitQuotaPrefix: "当前配额：",
  unauthorized: "GitHub API 认证失败，请检查 Token 配置。",
  repoInfoFailedPrefix: "获取仓库信息失败：",
  repoTreeFailedPrefix: "获取仓库文件树失败：",
  repoTreeConflict: "仓库文件树暂时不可用，请稍后重试。",
  fileContentFailedPrefix: "获取文件内容失败：",
  fileNotFound: "未找到该文件或分支。",
  networkFailedPrefix: "网络请求失败：",
  contentsApi: "Contents API",
  rawContentsApi: "Raw Contents API",
  rawGitHub: "raw.githubusercontent",
  unexpectedFilePayload: "返回结果不是可读取的文件内容。",
  unsupportedEncodingPrefix: "不支持的内容编码：",
} as const;

type CacheEntry<T> = {
  expiresAt: number;
  value: Promise<T>;
};

type GitHubErrorOptions = {
  status: number;
  statusText: string;
  fallbackPrefix: string;
  notFoundMessage: string;
  conflictMessage?: string;
  apiMessage?: string | null;
  responseHeaders?: Headers;
};

type GitHubRateLimitInfo = {
  limit: number | null;
  remaining: number | null;
  resetAt: string | null;
  tokenConfigured: boolean;
};

const repoInfoCache = new Map<string, CacheEntry<GitHubRepositoryInfo>>();
const repoTreeCache = new Map<string, CacheEntry<FileNode[]>>();

function encodeGitHubPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getGitHubToken(): string | null {
  const token =
    process.env.GITHUB_TOKEN?.trim() || process.env.GITHUB_API_TOKEN?.trim();

  return token || null;
}

function hasGitHubToken(): boolean {
  return Boolean(getGitHubToken());
}

function createGitHubHeaders(accept: string): HeadersInit {
  const headers: Record<string, string> = {
    Accept: accept,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "User-Agent": GITHUB_USER_AGENT,
  };
  const token = getGitHubToken();

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function parseOptionalInteger(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatRateLimitReset(resetUnixSeconds: number | null): string | null {
  if (!resetUnixSeconds) {
    return null;
  }

  return new Date(resetUnixSeconds * 1000).toLocaleString("zh-CN", {
    hour12: false,
  });
}

function extractRateLimitInfo(headers?: Headers): GitHubRateLimitInfo | null {
  if (!headers) {
    return null;
  }

  const limit = parseOptionalInteger(headers.get("x-ratelimit-limit"));
  const remaining = parseOptionalInteger(headers.get("x-ratelimit-remaining"));
  const resetAt = formatRateLimitReset(
    parseOptionalInteger(headers.get("x-ratelimit-reset")),
  );

  if (limit === null && remaining === null && resetAt === null) {
    return null;
  }

  return {
    limit,
    remaining,
    resetAt,
    tokenConfigured: hasGitHubToken(),
  };
}

function buildRateLimitMessage(rateLimit: GitHubRateLimitInfo | null): string {
  const segments: string[] = [
    TEXT.rateLimit,
    rateLimit?.tokenConfigured ? TEXT.rateLimitTokenHint : TEXT.rateLimitNoTokenHint,
  ];

  if (rateLimit && rateLimit.remaining !== null && rateLimit.limit !== null) {
    segments.push(
      `${TEXT.rateLimitQuotaPrefix}${rateLimit.remaining}/${rateLimit.limit}。`,
    );
  }

  if (rateLimit?.resetAt) {
    segments.push(`${TEXT.rateLimitResetPrefix}${rateLimit.resetAt}。`);
  }

  return segments.join(" ");
}

async function extractGitHubApiMessage(response: Response): Promise<string | null> {
  const contentType = response.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as unknown;

      if (isRecord(payload) && typeof payload.message === "string") {
        return payload.message.trim() || null;
      }

      return null;
    }

    const text = (await response.text()).trim();
    return text || null;
  } catch {
    return null;
  }
}

function createGitHubHttpErrorMessage({
  status,
  statusText,
  fallbackPrefix,
  notFoundMessage,
  conflictMessage,
  apiMessage,
  responseHeaders,
}: GitHubErrorOptions): string {
  if (status === 404) {
    return notFoundMessage;
  }

  if (status === 401) {
    return TEXT.unauthorized;
  }

  if (status === 403 || status === 429) {
    return buildRateLimitMessage(extractRateLimitInfo(responseHeaders));
  }

  if (status === 409 && conflictMessage) {
    return conflictMessage;
  }

  if (apiMessage) {
    return `${fallbackPrefix}${apiMessage}`;
  }

  return `${fallbackPrefix}${status} ${statusText}`;
}

async function fetchWithNetworkContext(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, {
      cache: "no-store",
      ...init,
    });
  } catch (error) {
    throw new Error(
      `${TEXT.networkFailedPrefix}${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function fetchGitHubJson<T>(
  url: string,
  options: {
    accept?: string;
    fallbackPrefix: string;
    notFoundMessage: string;
    conflictMessage?: string;
  },
): Promise<T> {
  const response = await fetchWithNetworkContext(url, {
    headers: createGitHubHeaders(options.accept ?? "application/vnd.github+json"),
  });

  if (!response.ok) {
    const apiMessage = await extractGitHubApiMessage(response);

    throw new Error(
      createGitHubHttpErrorMessage({
        status: response.status,
        statusText: response.statusText,
        fallbackPrefix: options.fallbackPrefix,
        notFoundMessage: options.notFoundMessage,
        conflictMessage: options.conflictMessage,
        apiMessage,
        responseHeaders: response.headers,
      }),
    );
  }

  return response.json() as Promise<T>;
}

async function fetchGitHubText(
  url: string,
  options: {
    accept?: string;
    fallbackPrefix: string;
    notFoundMessage: string;
  },
): Promise<string> {
  const response = await fetchWithNetworkContext(url, {
    headers: createGitHubHeaders(options.accept ?? "application/vnd.github.raw"),
  });

  if (!response.ok) {
    const apiMessage = await extractGitHubApiMessage(response);

    throw new Error(
      createGitHubHttpErrorMessage({
        status: response.status,
        statusText: response.statusText,
        fallbackPrefix: options.fallbackPrefix,
        notFoundMessage: options.notFoundMessage,
        apiMessage,
        responseHeaders: response.headers,
      }),
    );
  }

  return response.text();
}

function decodeGitHubContent(content: string, encoding?: string): string {
  if (!encoding || encoding === "utf-8") {
    return content;
  }

  if (encoding === "base64") {
    return Buffer.from(content.replace(/\s/g, ""), "base64").toString("utf8");
  }

  throw new Error(`${TEXT.unsupportedEncodingPrefix}${encoding}`);
}

async function fetchContentViaContentsApi(
  owner: string,
  repo: string,
  branch: string,
  path: string,
): Promise<string> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${encodeGitHubPath(path)}?ref=${encodeURIComponent(branch)}`;
  const payload = await fetchGitHubJson<Record<string, unknown>>(url, {
    fallbackPrefix: TEXT.fileContentFailedPrefix,
    notFoundMessage: TEXT.fileNotFound,
  });

  if (payload.type !== "file") {
    throw new Error(TEXT.unexpectedFilePayload);
  }

  if (typeof payload.content === "string" && payload.content.trim()) {
    return decodeGitHubContent(
      payload.content,
      typeof payload.encoding === "string" ? payload.encoding : undefined,
    );
  }

  throw new Error(TEXT.unexpectedFilePayload);
}

async function fetchContentViaRawContentsApi(
  owner: string,
  repo: string,
  branch: string,
  path: string,
): Promise<string> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${encodeGitHubPath(path)}?ref=${encodeURIComponent(branch)}`;

  return fetchGitHubText(url, {
    fallbackPrefix: TEXT.fileContentFailedPrefix,
    notFoundMessage: TEXT.fileNotFound,
  });
}

async function fetchContentViaRawGitHub(
  owner: string,
  repo: string,
  branch: string,
  path: string,
): Promise<string> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  const response = await fetchWithNetworkContext(url, {
    headers: {
      "User-Agent": GITHUB_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(
      createGitHubHttpErrorMessage({
        status: response.status,
        statusText: response.statusText,
        fallbackPrefix: TEXT.fileContentFailedPrefix,
        notFoundMessage: TEXT.fileNotFound,
        responseHeaders: response.headers,
      }),
    );
  }

  return response.text();
}

function buildFileTree(nodes: GitHubNode[]): FileNode[] {
  const root: FileNode[] = [];
  const map: Record<string, FileNode> = {};

  for (const node of nodes) {
    const parts = node.path.split("/");
    const name = parts[parts.length - 1];
    const fileNode: FileNode = {
      name,
      path: node.path,
      type: node.type === "tree" ? "folder" : "file",
      url: node.url,
    };

    if (fileNode.type === "folder") {
      fileNode.children = [];
    }

    map[node.path] = fileNode;
  }

  for (const node of nodes) {
    const fileNode = map[node.path];
    const parts = node.path.split("/");

    if (parts.length === 1) {
      root.push(fileNode);
      continue;
    }

    const parentPath = parts.slice(0, -1).join("/");
    const parentNode = map[parentPath];

    if (parentNode?.children) {
      parentNode.children.push(fileNode);
    }
  }

  const sortNodes = (items: FileNode[]) => {
    items.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1;
      }

      return a.name.localeCompare(b.name);
    });

    for (const node of items) {
      if (node.children) {
        sortNodes(node.children);
      }
    }
  };

  sortNodes(root);
  return root;
}

function getCacheKey(parts: string[]): string {
  return parts.join("::");
}

function getCachedValue<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const cached = cache.get(key);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const pending = loader().catch((error) => {
    if (cache.get(key)?.value === pending) {
      cache.delete(key);
    }

    throw error;
  });

  cache.set(key, {
    expiresAt: now + ttlMs,
    value: pending,
  });

  return pending;
}

export async function getRepositoryInfo(
  owner: string,
  repo: string,
): Promise<GitHubRepositoryInfo> {
  return getCachedValue(
    repoInfoCache,
    getCacheKey([owner, repo]),
    REPO_INFO_CACHE_TTL_MS,
    () =>
      fetchGitHubJson<GitHubRepositoryInfo>(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}`,
        {
          fallbackPrefix: TEXT.repoInfoFailedPrefix,
          notFoundMessage: TEXT.repoNotFound,
        },
      ),
  );
}

export async function getRepositoryTree(
  owner: string,
  repo: string,
  branch: string,
): Promise<FileNode[]> {
  return getCachedValue(
    repoTreeCache,
    getCacheKey([owner, repo, branch]),
    REPO_TREE_CACHE_TTL_MS,
    async () => {
      const payload = await fetchGitHubJson<{
        truncated?: boolean;
        tree: GitHubNode[];
      }>(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
        {
          fallbackPrefix: TEXT.repoTreeFailedPrefix,
          notFoundMessage: TEXT.repoNotFound,
          conflictMessage: TEXT.repoTreeConflict,
        },
      );

      if (payload.truncated) {
        console.warn(
          "The repository tree is too large and was truncated by the GitHub API.",
        );
      }

      return buildFileTree(payload.tree);
    },
  );
}

export async function getFileContent(
  owner: string,
  repo: string,
  branch: string,
  path: string,
): Promise<string> {
  const attempts: Array<{ source: string; load: () => Promise<string> }> = [
    {
      source: TEXT.contentsApi,
      load: () => fetchContentViaContentsApi(owner, repo, branch, path),
    },
    {
      source: TEXT.rawContentsApi,
      load: () => fetchContentViaRawContentsApi(owner, repo, branch, path),
    },
    {
      source: TEXT.rawGitHub,
      load: () => fetchContentViaRawGitHub(owner, repo, branch, path),
    },
  ];
  const errors: string[] = [];

  for (const attempt of attempts) {
    try {
      return await attempt.load();
    } catch (error) {
      errors.push(
        `${attempt.source}：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  throw new Error(`${TEXT.fileContentFailedPrefix}${errors.join("；")}`);
}
