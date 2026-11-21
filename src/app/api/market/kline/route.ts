import { NextResponse } from "next/server";
import { A_SHARE_BENCHMARKS, getAShareDailyBars } from "@/lib/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol")?.trim() || "";
  const kind = searchParams.get("kind") === "index" ? "index" : "stock";
  const start = searchParams.get("start")?.trim() || undefined;
  const end = searchParams.get("end")?.trim() || undefined;
  const forceRefresh = searchParams.get("refresh") === "1";

  if (!symbol) {
    return NextResponse.json({ ok: true, benchmarks: A_SHARE_BENCHMARKS });
  }

  const res = await getAShareDailyBars({ symbol, kind, start, end, forceRefresh });
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, series: res.series });
}