import { NextResponse } from "next/server";
import { warmNewsCaches } from "@/lib/newsService";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  const { searchParams } = new URL(request.url);
  const bearer = request.headers.get("authorization");
  const querySecret = searchParams.get("secret");

  return bearer === `Bearer ${cronSecret}` || querySecret === cronSecret;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const warmed = await warmNewsCaches();
    return NextResponse.json({
      ok: true,
      ...warmed,
      warmedAt: new Date().toISOString(),
    }, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Refresh failed" }, { status: 502 });
  }
}
