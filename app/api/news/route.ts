import { after } from "next/server";
import { NextResponse } from "next/server";
import { readNewsSnapshot, refreshNewsSnapshot } from "@/lib/newsService";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.max(1, parseInt(searchParams.get("pageSize") ?? "30", 10) || 30);
  const forceRefresh = searchParams.has("refresh");
  let snapshot = await readNewsSnapshot();
  if (!snapshot) snapshot = await refreshNewsSnapshot();
  if (!snapshot) {
    return NextResponse.json({ error: "Český snapshot filmových novinek zatím není připravený" }, { status: 503 });
  }

  const start = (page - 1) * pageSize;
  const articles = snapshot.data.articles.slice(start, start + pageSize);
  const data = {
    articles,
    hasMore: start + pageSize < snapshot.data.total,
    page,
    pageSize,
    total: snapshot.data.total,
    freshness: {
      version: snapshot.version,
      sourceFetchedAt: snapshot.sourceFetchedAt,
      translatedAt: snapshot.translatedAt,
    },
  };

  if (forceRefresh || Date.now() - new Date(snapshot.sourceFetchedAt).getTime() > 5 * 60_000) {
    after(async () => {
      await refreshNewsSnapshot();
    });
  }

  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    },
  });
}
