import { NextRequest, NextResponse } from "next/server";
import { materializeUnlinkedMention } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: { sourceCard?: string; targetRel?: string; match?: string } = {};
  try {
    body = (await request.json()) as { sourceCard?: string; targetRel?: string; match?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "请求体格式错误" }, { status: 400 });
  }

  if (!body.sourceCard || !body.targetRel || !body.match) {
    return NextResponse.json({ ok: false, error: "缺少 sourceCard、targetRel 或 match 参数" }, { status: 400 });
  }

  const outcome = await materializeUnlinkedMention({
    sourceCard: body.sourceCard,
    targetRel: body.targetRel,
    match: body.match,
  });

  if (!outcome.ok) {
    return NextResponse.json(outcome, { status: outcome.status });
  }
  return NextResponse.json(outcome);
}
