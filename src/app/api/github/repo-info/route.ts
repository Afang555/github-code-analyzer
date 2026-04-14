import { NextResponse } from "next/server";

import { getRepositoryInfo } from "@/lib/githubApi";

export const runtime = "nodejs";

const TEXT = {
  invalidOwner: "owner 参数无效",
  invalidRepo: "repo 参数无效",
  unknownError: "获取仓库信息失败",
} as const;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const owner = searchParams.get("owner")?.trim();
  const repo = searchParams.get("repo")?.trim();

  if (!owner) {
    return NextResponse.json({ error: TEXT.invalidOwner }, { status: 400 });
  }

  if (!repo) {
    return NextResponse.json({ error: TEXT.invalidRepo }, { status: 400 });
  }

  try {
    const info = await getRepositoryInfo(owner, repo);
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
