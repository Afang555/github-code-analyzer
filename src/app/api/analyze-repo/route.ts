import { NextResponse } from "next/server";

import { AIAnalysisServiceError, analyzeRepository } from "@/lib/ai/openaiCompatible";
import { createJsonPreview } from "@/lib/jsonPreview";

export const runtime = "nodejs";

const TEXT = {
  invalidFilePaths: "filePaths 数组无效或为空",
  invalidRepositoryContext:
    "仓库上下文无效，缺少 owner/repo/branch/repositoryUrl",
  analyzeFailed: "分析仓库失败",
} as const;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { filePaths, repositoryContext } = body;

    if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
      return NextResponse.json(
        { error: TEXT.invalidFilePaths },
        { status: 400 },
      );
    }

    if (
      !repositoryContext ||
      typeof repositoryContext.owner !== "string" ||
      typeof repositoryContext.repo !== "string" ||
      typeof repositoryContext.branch !== "string" ||
      typeof repositoryContext.repositoryUrl !== "string"
    ) {
      return NextResponse.json(
        { error: TEXT.invalidRepositoryContext },
        { status: 400 },
      );
    }

    const analysis = await analyzeRepository({
      filePaths,
      repositoryContext: {
        owner: repositoryContext.owner,
        repo: repositoryContext.repo,
        branch: repositoryContext.branch,
        repositoryUrl: repositoryContext.repositoryUrl,
        repositoryDescription:
          typeof repositoryContext.repositoryDescription === "string"
            ? repositoryContext.repositoryDescription
            : null,
      },
    });

    return NextResponse.json({
      result: analysis.result,
      debug: createJsonPreview(analysis.debug),
    });
  } catch (error: unknown) {
    console.error("AI Analysis Error:", error);

    const message = error instanceof Error ? error.message : TEXT.analyzeFailed;

    return NextResponse.json(
      {
        error: message,
        debug:
          error instanceof AIAnalysisServiceError && error.debug
            ? createJsonPreview(error.debug)
            : undefined,
      },
      { status: 500 },
    );
  }
}
