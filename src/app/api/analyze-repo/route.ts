import { NextResponse } from "next/server";

import { normalizeAppSettingsInput } from "@/lib/appSettings";
import {
  AIAnalysisServiceError,
  analyzeRepository,
} from "@/lib/ai/openaiCompatible";
import { createJsonPreview } from "@/lib/jsonPreview";
import { normalizeRepositoryContext } from "@/types/repository";

export const runtime = "nodejs";

const TEXT = {
  invalidFilePaths: "filePaths 数组无效或为空。",
  invalidRepositoryContext: "repositoryContext 无效。",
  invalidSettings: "settings 无效。",
  analyzeFailed: "分析项目失败。",
} as const;

export async function POST(req: Request) {
  let stage = "parse_request";

  try {
    const body = await req.json();
    const { filePaths } = body;

    if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
      return NextResponse.json(
        { error: TEXT.invalidFilePaths },
        { status: 400 },
      );
    }

    let repositoryContext;
    let settings;

    try {
      stage = "normalize_repository_context";
      repositoryContext = normalizeRepositoryContext(body.repositoryContext);
    } catch {
      return NextResponse.json(
        { error: TEXT.invalidRepositoryContext },
        { status: 400 },
      );
    }

    try {
      stage = "normalize_settings";
      settings = normalizeAppSettingsInput(body.settings);
    } catch {
      return NextResponse.json(
        { error: TEXT.invalidSettings },
        { status: 400 },
      );
    }

    stage = "analyze_repository";
    const analysis = await analyzeRepository({
      filePaths,
      repositoryContext,
      settings,
    });

    stage = "preview_debug";
    const debug = createJsonPreview(analysis.debug);

    stage = "serialize_response";
    return NextResponse.json({
      result: analysis.result,
      debug,
    });
  } catch (error: unknown) {
    console.error(`AI Analysis Error [${stage}]:`, error);

    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }

    const message = error instanceof Error ? error.message : TEXT.analyzeFailed;

    return NextResponse.json(
      {
        error: message,
        stage,
        debug:
          error instanceof AIAnalysisServiceError && error.debug
            ? createJsonPreview(error.debug)
            : undefined,
      },
      { status: 500 },
    );
  }
}
