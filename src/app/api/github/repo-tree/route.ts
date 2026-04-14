import { NextResponse } from "next/server";

import { getRepositoryTree } from "@/lib/githubApi";

export const runtime = "nodejs";

const TEXT = {
  invalidOwner: "owner 参数无效",
  invalidRepo: "repo 参数无效",
  invalidBranch: "branch 参数无效",
  unknownError: "获取仓库文件树失败",
} as const;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
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

  try {
    const tree = await getRepositoryTree(owner, repo, branch);
    return NextResponse.json({ tree });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : TEXT.unknownError,
      },
      { status: 500 },
    );
  }
}
