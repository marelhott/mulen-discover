import { NextResponse } from "next/server";
import { refreshMoviesSnapshot } from "@/app/api/movies/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const snapshot = await refreshMoviesSnapshot();
    return NextResponse.json({ ok: true, items: snapshot?.itemCount ?? 0, refreshedAt: snapshot?.sourceFetchedAt }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Refresh failed" }, { status: 502 });
  }
}
