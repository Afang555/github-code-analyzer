import { NextResponse } from "next/server";

import { APP_GITHUB_TOKEN_HEADER } from "@/lib/appSettings";
import { resolveRepositoryContext } from "@/lib/repositoryDataSource";
import type { RepositoryDescriptor } from "@/types/repository";

export const runtime = "nodejs";

const TEXT = {
  invalidSourceType: "sourceType 参数无效",
  invalidOwner: "owner 参数无效",
  invalidRepo: "repo 参数无效",
  invalidSourceId: "sourceId 参数无效",
  unknownError: "获取项目信息失败",
} as const;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sourceType = searchParams.get("sourceType")?.trim();
  const githubToken = req.headers.get(APP_GITHUB_TOKEN_HEADER)?.trim() || null;

  let descriptor: RepositoryDescriptor;

  if (sourceType === "github") {
    const owner = searchParams.get("owner")?.trim();
    const repo = searchParams.get("repo")?.trim();

    if (!owner) {
      return NextResponse.json({ error: TEXT.invalidOwner }, { status: 400 });
    }

    if (!repo) {
      return NextResponse.json({ error: TEXT.invalidRepo }, { status: 400 });
    }

    descriptor = {
      sourceType: "github",
      owner,
      repo,
    };
  } else if (sourceType === "local") {
    const sourceId = searchParams.get("sourceId")?.trim();

    if (!sourceId) {
      return NextResponse.json({ error: TEXT.invalidSourceId }, { status: 400 });
    }

    descriptor = {
      sourceType: "local",
      sourceId,
    };
  } else {
    return NextResponse.json({ error: TEXT.invalidSourceType }, { status: 400 });
  }

  try {
    const info = await resolveRepositoryContext(descriptor, {
      githubToken,
    });
    return NextResponse.json(info);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : TEXT.unknownError,
      },
      { status: 500 },
    );
  }
}
