import { NextResponse } from "next/server";

import {
  AIAnalysisServiceError,
  drillDownFunctionOverviewNode,
} from "@/lib/ai/openaiCompatible";
import { createJsonPreview } from "@/lib/jsonPreview";
import {
  normalizeAIAnalysisResult,
  type AIAnalysisResult,
} from "@/types/aiAnalysis";

export const runtime = "nodejs";

const TEXT = {
  invalidFilePaths: "filePaths 数组无效或为空。",
  invalidRepositoryContext:
    "仓库上下文无效，缺少 owner/repo/branch/repositoryUrl。",
  invalidNodePath: "nodePath 无效，必须是由非负整数组成的数组。",
  invalidAnalysisResult: "analysisResult 无效，无法解析当前分析结果。",
  drillDownFailed: "手动下钻分析失败。",
} as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidNodePath(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "number" &&
        Number.isInteger(item) &&
        Number.isFinite(item) &&
        item >= 0,
    )
  );
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const filePaths = body.filePaths;
    const repositoryContext = body.repositoryContext as
      | Record<string, unknown>
      | undefined;
    const nodePath = body.nodePath;

    if (
      !Array.isArray(filePaths) ||
      filePaths.length === 0 ||
      !filePaths.every(isNonEmptyString)
    ) {
      return NextResponse.json(
        { error: TEXT.invalidFilePaths },
        { status: 400 },
      );
    }

    if (
      !repositoryContext ||
      !isNonEmptyString(repositoryContext.owner) ||
      !isNonEmptyString(repositoryContext.repo) ||
      !isNonEmptyString(repositoryContext.branch) ||
      !isNonEmptyString(repositoryContext.repositoryUrl)
    ) {
      return NextResponse.json(
        { error: TEXT.invalidRepositoryContext },
        { status: 400 },
      );
    }

    if (!isValidNodePath(nodePath)) {
      return NextResponse.json(
        { error: TEXT.invalidNodePath },
        { status: 400 },
      );
    }

    const normalizedFilePaths = (filePaths as string[]).map((path) =>
      path.trim(),
    );
    const normalizedNodePath = nodePath as number[];
    let analysisResult: AIAnalysisResult;
    try {
      analysisResult = normalizeAIAnalysisResult(body.analysisResult);
    } catch {
      return NextResponse.json(
        { error: TEXT.invalidAnalysisResult },
        { status: 400 },
      );
    }

    const outcome = await drillDownFunctionOverviewNode({
      filePaths: normalizedFilePaths,
      repositoryContext: {
        owner: repositoryContext.owner.trim(),
        repo: repositoryContext.repo.trim(),
        branch: repositoryContext.branch.trim(),
        repositoryUrl: repositoryContext.repositoryUrl.trim(),
        repositoryDescription:
          typeof repositoryContext.repositoryDescription === "string"
            ? repositoryContext.repositoryDescription
            : null,
      },
      analysisResult,
      nodePath: normalizedNodePath,
    });

    return NextResponse.json({
      result: outcome.result,
      debug: {
        functionOverview: createJsonPreview(outcome.debug),
      },
    });
  } catch (error: unknown) {
    console.error("Manual Drill-Down Error:", error);

    const message =
      error instanceof Error ? error.message : TEXT.drillDownFailed;

    return NextResponse.json(
      {
        error: message,
        debug:
          error instanceof AIAnalysisServiceError && error.debug?.functionOverview
            ? {
                functionOverview: createJsonPreview(
                  error.debug.functionOverview,
                ),
              }
            : undefined,
      },
      { status: 500 },
    );
  }
}
