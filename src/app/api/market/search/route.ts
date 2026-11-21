import { NextResponse } from "next/server";
import { searchAShareSymbols } from "@/lib/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() || "";
  if (!q) return NextResponse.json({ ok: true, items: [] });
  const items = await searchAShareSymbols(q);
  return NextResponse.json({ ok: true, items });
}