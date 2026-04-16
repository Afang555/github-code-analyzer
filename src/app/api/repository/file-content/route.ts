import { NextResponse } from "next/server";

import { APP_GITHUB_TOKEN_HEADER } from "@/lib/appSettings";
import { createRepositoryDataSource } from "@/lib/repositoryDataSource";
import type { RepositoryAccessContext } from "@/types/repository";

export const runtime = "nodejs";

const TEXT = {
  invalidSourceType: "sourceType 参数无效",
  invalidOwner: "owner 参数无效",
  invalidRepo: "repo 参数无效",
  invalidBranch: "branch 参数无效",
  invalidSourceId: "sourceId 参数无效",
  invalidPath: "path 参数无效",
  unknownError: "获取文件内容失败",
} as const;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sourceType = searchParams.get("sourceType")?.trim();
  const path = searchParams.get("path")?.trim();
  const githubToken = req.headers.get(APP_GITHUB_TOKEN_HEADER)?.trim() || null;

  if (!path) {
    return NextResponse.json({ error: TEXT.invalidPath }, { status: 400 });
  }

  let context: RepositoryAccessContext;

  if (sourceType === "github") {
    const owner = searchParams.get("owner")?.trim();
    const repo = searchParams.get("repo")?.trim();
    const branch = searchParams.get("branch")?.trim();

    if (!owner) {
      return NextResponse.json({ error: TEXT.invalidOwner }, { status: 400 });
    }

    if (!repo) {
      return NextResponse.json({ error: TEXT.invalidRepo }, { status: 400 });
    }

    if (!branch) {
      return NextResponse.json({ error: TEXT.invalidBranch }, { status: 400 });
    }

    context = {
      sourceType: "github",
      owner,
      repo,
      branch,
    };
  } else if (sourceType === "local") {
    const sourceId = searchParams.get("sourceId")?.trim();

    if (!sourceId) {
      return NextResponse.json({ error: TEXT.invalidSourceId }, { status: 400 });
    }

    context = {
      sourceType: "local",
      sourceId,
    };
  } else {
    return NextResponse.json({ error: TEXT.invalidSourceType }, { status: 400 });
  }

  try {
    const content = await createRepositoryDataSource(context, {
      githubToken,
    }).readFile(path);
    return NextResponse.json({ content });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : TEXT.unknownError,
      },
      { status: 500 },
    );
  }
}
