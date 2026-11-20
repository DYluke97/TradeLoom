import { NextRequest, NextResponse } from "next/server";
import { loadOrBuildVault, loadSampleReviews, rebuildVault } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await loadOrBuildVault();
  return NextResponse.json({ ok: true, ...data }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  let body: { action?: string } = {};
  try {
    body = (await request.json()) as { action?: string };
  } catch {
    /* ignore */
  }

  if (body.action === "load-samples") {
    const res = await loadSampleReviews();
    return NextResponse.json({ ok: true, copied: res.copied, index: res.index });
  }

  const index = await rebuildVault();
  return NextResponse.json({ ok: true, index });
}
