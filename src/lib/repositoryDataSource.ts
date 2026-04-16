import "server-only";

import { getLocalRepositorySnapshot } from "@/lib/localRepositorySnapshots";
import {
  getFileContent as getGitHubFileContent,
  getRepositoryInfo as getGitHubRepositoryInfo,
  getRepositoryTree as getGitHubRepositoryTree,
} from "@/lib/githubApi";
import type {
  FileNode,
  RepositoryAccessContext,
  RepositoryContext,
  RepositoryDescriptor,
  RepositoryTextSearchMatch,
} from "@/types/repository";

const TEXT = {
  localSnapshotMissing: "本地项目快照不存在或已失效，请重新选择本地目录。",
  fileNotFoundPrefix: "未找到文件：",
} as const;

type RepositorySearchArgs = {
  query: string;
  filePaths: string[];
  caseSensitive?: boolean;
  limit?: number;
};

export type RepositoryDataSourceOptions = {
  githubToken?: string | null;
};

export interface RepositoryDataSource {
  getRepositoryInfo(): Promise<RepositoryContext>;
  getFileTree(): Promise<FileNode[]>;
  readFile(path: string): Promise<string>;
  searchFileContent(
    args: RepositorySearchArgs,
  ): Promise<RepositoryTextSearchMatch[]>;
}

async function searchFileContentWithReader(
  readFile: (path: string) => Promise<string>,
  args: RepositorySearchArgs,
): Promise<RepositoryTextSearchMatch[]> {
  const limit = args.limit ?? 20;
  const normalizedQuery = args.caseSensitive
    ? args.query
    : args.query.toLowerCase();
  const matches: RepositoryTextSearchMatch[] = [];

  if (!normalizedQuery) {
    return matches;
  }

  for (const filePath of args.filePaths) {
    if (matches.length >= limit) {
      break;
    }

    let content: string;

    try {
      content = await readFile(filePath);
    } catch {
      continue;
    }

    const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

    for (const [index, line] of lines.entries()) {
      const target = args.caseSensitive ? line : line.toLowerCase();

      if (!target.includes(normalizedQuery)) {
        continue;
      }

      matches.push({
        path: filePath,
        line: index + 1,
        preview: line.trim().slice(0, 240),
      });
      break;
    }
  }

  return matches;
}

export async function resolveRepositoryContext(
  descriptor: RepositoryDescriptor,
  options?: RepositoryDataSourceOptions,
): Promise<RepositoryContext> {
  if (descriptor.sourceType === "github") {
    const info = await getGitHubRepositoryInfo(
      descriptor.owner,
      descriptor.repo,
      options,
    );

    return {
      sourceType: "github",
      projectName: descriptor.repo,
      owner: descriptor.owner,
      repo: descriptor.repo,
      branch: info.default_branch,
      repositoryUrl:
        typeof info.html_url === "string" && info.html_url.trim()
          ? info.html_url
          : `https://github.com/${descriptor.owner}/${descriptor.repo}`,
      repositoryDescription:
        typeof info.description === "string" && info.description.trim()
          ? info.description
          : null,
    };
  }

  const snapshot = getLocalRepositorySnapshot(descriptor.sourceId);

  if (!snapshot) {
    throw new Error(TEXT.localSnapshotMissing);
  }

  return snapshot.context;
}

export function createRepositoryDataSource(
  context: RepositoryAccessContext,
  options?: RepositoryDataSourceOptions,
): RepositoryDataSource {
  if (context.sourceType === "github") {
    const owner = context.owner;
    const repo = context.repo;
    const branch = context.branch;

    return {
      async getRepositoryInfo() {
        return resolveRepositoryContext({
          sourceType: "github",
          owner,
          repo,
        }, options);
      },
      async getFileTree() {
        return getGitHubRepositoryTree(owner, repo, branch, options);
      },
      async readFile(path: string) {
        return getGitHubFileContent(owner, repo, branch, path, options);
      },
      async searchFileContent(args) {
        return searchFileContentWithReader(
          (path) => getGitHubFileContent(owner, repo, branch, path, options),
          args,
        );
      },
    };
  }

  const sourceId = context.sourceId;

  const getSnapshot = () => {
    const snapshot = getLocalRepositorySnapshot(sourceId);

    if (!snapshot) {
      throw new Error(TEXT.localSnapshotMissing);
    }

    return snapshot;
  };

  return {
    async getRepositoryInfo() {
      return getSnapshot().context;
    },
    async getFileTree() {
      return getSnapshot().fileTree;
    },
    async readFile(path: string) {
      const snapshot = getSnapshot();
      const content = snapshot.fileContents.get(path);

      if (content === undefined) {
        throw new Error(`${TEXT.fileNotFoundPrefix}${path}`);
      }

      return content;
    },
    async searchFileContent(args) {
      return searchFileContentWithReader(
        async (path) => {
          const content = getSnapshot().fileContents.get(path);

          if (content === undefined) {
            throw new Error(`${TEXT.fileNotFoundPrefix}${path}`);
          }

          return content;
        },
        args,
      );
    },
  };
}
