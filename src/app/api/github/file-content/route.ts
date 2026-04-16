import { GET as handleRepositoryFileContent } from "@/app/api/repository/file-content/route";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  url.searchParams.set("sourceType", "github");

  return handleRepositoryFileContent(new Request(url, req));
}
