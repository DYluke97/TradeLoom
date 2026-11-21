import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_CONCEPT_RULES, loadConceptRules, resetConceptRules, saveConceptRules } from "@/lib/concepts";
import { rebuildVault } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { rules, customized } = await loadConceptRules();
  return NextResponse.json({
    ok: true,
    rules,
    customized,
    defaultsCount: DEFAULT_CONCEPT_RULES.length,
  });
}

export async function PUT(request: NextRequest) {
  let body: { rules?: unknown } = {};
  try {
    body = (await request.json()) as { rules?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "请求体格式错误" }, { status: 400 });
  }

  if (!Array.isArray(body.rules)) {
    return NextResponse.json({ ok: false, error: "缺少有效的 rules 数组" }, { status: 400 });
  }

  const rules = await saveConceptRules(body.rules);
  const index = await rebuildVault();
  return NextResponse.json({ ok: true, rules, index });
}

export async function POST(request: NextRequest) {
  let body: { action?: string } = {};
  try {
    body = (await request.json()) as { action?: string };
  } catch {
    body = {};
  }

  if (body.action === "reset") {
    const rules = await resetConceptRules();
    const index = await rebuildVault();
    return NextResponse.json({ ok: true, rules, index });
  }

  return NextResponse.json({ ok: false, error: "未知操作" }, { status: 400 });
}
