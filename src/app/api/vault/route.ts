import { NextRequest, NextResponse } from "next/server";
import { clearSampleReviews, hasLoadedSamples, loadOrBuildVault, loadSampleReviews, rebuildVault } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await loadOrBuildVault();
  const hasSamples = await hasLoadedSamples(data.index);
  return NextResponse.json({ ok: true, ...data, hasSamples }, { headers: { "Cache-Control": "no-store" } });
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
    const hasSamples = await hasLoadedSamples(res.index);
    return NextResponse.json({ ok: true, copied: res.copied, index: res.index, hasSamples });
  }
  if (body.action === "clear-samples") {
    const res = await clearSampleReviews();
    const hasSamples = await hasLoadedSamples(res.index);
    return NextResponse.json({ ok: true, removed: res.removed, index: res.index, hasSamples });
  }
  const index = await rebuildVault();
  const hasSamples = await hasLoadedSamples(index);
  return NextResponse.json({ ok: true, index, hasSamples });
}
