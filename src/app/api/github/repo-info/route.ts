import { GET as handleRepositoryInfo } from "@/app/api/repository/info/route";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  url.searchParams.set("sourceType", "github");

  return handleRepositoryInfo(new Request(url, req));
}
