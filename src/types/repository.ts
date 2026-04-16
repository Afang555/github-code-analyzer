export type { FileNode } from "@/types/github";

export type RepositorySourceType = "github" | "local";

type RepositoryContextBase = {
  sourceType: RepositorySourceType;
  projectName: string;
  branch: string | null;
  repositoryUrl: string;
  repositoryDescription?: string | null;
};

export type GitHubRepositoryContext = RepositoryContextBase & {
  sourceType: "github";
  owner: string;
  repo: string;
  branch: string;
};

export type LocalRepositoryContext = RepositoryContextBase & {
  sourceType: "local";
  sourceId: string;
  localPath: string;
  branch: null;
};

export type RepositoryContext =
  | GitHubRepositoryContext
  | LocalRepositoryContext;

export type RepositoryDescriptor =
  | {
      sourceType: "github";
      owner: string;
      repo: string;
    }
  | {
      sourceType: "local";
      sourceId: string;
    };

export type RepositoryAccessContext =
  | GitHubRepositoryContext
  | LocalRepositoryContext
  | {
      sourceType: "github";
      owner: string;
      repo: string;
      branch: string;
    }
  | {
      sourceType: "local";
      sourceId: string;
    };

export type RepositoryTextSearchMatch = {
  path: string;
  line: number;
  preview: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeOptionalString(value: unknown): string | null {
  return isNonEmptyString(value) ? value.trim() : null;
}

export function isGitHubRepositoryContext(
  value: RepositoryContext,
): value is GitHubRepositoryContext {
  return value.sourceType === "github";
}

export function isLocalRepositoryContext(
  value: RepositoryContext,
): value is LocalRepositoryContext {
  return value.sourceType === "local";
}

export function buildRepositoryLocationLabel(context: RepositoryContext): string {
  if (context.sourceType === "github") {
    return `${context.owner}/${context.repo}`;
  }

  return context.localPath;
}

export function appendRepositoryDescriptorSearchParams(
  searchParams: URLSearchParams,
  descriptor: RepositoryDescriptor,
): URLSearchParams {
  searchParams.set("sourceType", descriptor.sourceType);

  if (descriptor.sourceType === "github") {
    searchParams.set("owner", descriptor.owner);
    searchParams.set("repo", descriptor.repo);
    return searchParams;
  }

  searchParams.set("sourceId", descriptor.sourceId);
  return searchParams;
}

export function appendRepositoryContextSearchParams(
  searchParams: URLSearchParams,
  context: RepositoryAccessContext,
): URLSearchParams {
  searchParams.set("sourceType", context.sourceType);

  if (context.sourceType === "github") {
    searchParams.set("owner", context.owner);
    searchParams.set("repo", context.repo);
    searchParams.set("branch", context.branch);
    return searchParams;
  }

  searchParams.set("sourceId", context.sourceId);
  return searchParams;
}

export function normalizeRepositoryContext(value: unknown): RepositoryContext {
  if (!value || typeof value !== "object") {
    throw new Error("repositoryContext must be a JSON object");
  }

  const record = value as Record<string, unknown>;
  const projectName = normalizeOptionalString(record.projectName);
  const repositoryUrl = normalizeOptionalString(record.repositoryUrl);
  const repositoryDescription = normalizeOptionalString(
    record.repositoryDescription,
  );

  if (!projectName || !repositoryUrl || !isNonEmptyString(record.sourceType)) {
    throw new Error(
      "repositoryContext is invalid, missing sourceType/projectName/repositoryUrl",
    );
  }

  if (record.sourceType === "github") {
    const owner = normalizeOptionalString(record.owner);
    const repo = normalizeOptionalString(record.repo);
    const branch = normalizeOptionalString(record.branch);

    if (!owner || !repo || !branch) {
      throw new Error(
        "GitHub repositoryContext is invalid, missing owner/repo/branch",
      );
    }

    return {
      sourceType: "github",
      projectName,
      owner,
      repo,
      branch,
      repositoryUrl,
      repositoryDescription,
    };
  }

  if (record.sourceType === "local") {
    const sourceId = normalizeOptionalString(record.sourceId);
    const localPath = normalizeOptionalString(record.localPath);

    if (!sourceId || !localPath) {
      throw new Error(
        "Local repositoryContext is invalid, missing sourceId/localPath",
      );
    }

    return {
      sourceType: "local",
      sourceId,
      projectName,
      branch: null,
      localPath,
      repositoryUrl,
      repositoryDescription,
    };
  }

  throw new Error("repositoryContext sourceType is invalid");
}

export function isRepositoryContext(value: unknown): value is RepositoryContext {
  try {
    normalizeRepositoryContext(value);
    return true;
  } catch {
    return false;
  }
}
