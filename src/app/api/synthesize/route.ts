import { NextRequest, NextResponse } from "next/server";
import { buildPrecheck, materializeDocs, runStageSynthesis } from "@/lib/synthesis";
import { loadOrBuildVault } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  let body: {
    mode?: "precheck" | "run";
    docIds?: string[];
    skillId?: string;
    stageTitle?: string;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "请求体格式错误" }, { status: 400 });
  }

  const docIds = Array.isArray(body.docIds) ? body.docIds.filter((id): id is string => typeof id === "string" && Boolean(id)) : [];
  if (docIds.length === 0) {
    return NextResponse.json({ ok: false, error: "请先在时间线中至少勾选 1 篇复盘笔记" }, { status: 400 });
  }

  const { index } = await loadOrBuildVault();
  const byId = new Map(index.documents.map((d) => [d.doc_id, d]));
  const selectedDocs = docIds.map((id) => byId.get(id)).filter((d): d is NonNullable<typeof d> => Boolean(d));

  if (selectedDocs.length === 0) {
    return NextResponse.json({ ok: false, error: "所选文档在当前知识库中不存在" }, { status: 404 });
  }

  if (body.mode !== "run") {
    const materialized = await materializeDocs(selectedDocs);
    const { snapshot } = buildPrecheck(materialized);
    return NextResponse.json({ ok: true, mode: "precheck", snapshot });
  }

  const result = await runStageSynthesis({
    docs: selectedDocs,
    skillId: body.skillId || "short-term",
    stageTitle: body.stageTitle,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, mode: "run", report: result.report });
}
