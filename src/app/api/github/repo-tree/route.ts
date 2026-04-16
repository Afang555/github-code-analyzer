import { GET as handleRepositoryTree } from "@/app/api/repository/tree/route";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  url.searchParams.set("sourceType", "github");

  return handleRepositoryTree(new Request(url, req));
}
