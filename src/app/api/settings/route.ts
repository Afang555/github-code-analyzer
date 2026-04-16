import { NextResponse } from "next/server";

import { getAppSettingsEnvironmentSnapshot } from "@/lib/serverAppSettings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    env: getAppSettingsEnvironmentSnapshot(),
  });
}
