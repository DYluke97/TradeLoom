import { NextRequest, NextResponse } from "next/server";
import { buildPrecheck, materializeDocs, materializeManuals, runStageSynthesis } from "@/lib/synthesis";
import { loadOrBuildVault } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: NextRequest) {
  let body: {
    mode?: "precheck" | "run";
    docIds?: string[];
    manualIds?: string[];
    skillId?: string;
    stageTitle?: string;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "请求体格式错误" }, { status: 400 });
  }

  const docIds = Array.isArray(body.docIds) ? body.docIds.filter((id): id is string => typeof id === "string" && Boolean(id)) : [];
  const manualIds = Array.isArray(body.manualIds)
    ? body.manualIds.filter((id): id is string => typeof id === "string" && Boolean(id))
    : [];

  if (docIds.length === 0 && manualIds.length === 0) {
    return NextResponse.json({ ok: false, error: "请先至少勾选 1 篇复盘笔记或 1 份阶段手册" }, { status: 400 });
  }

  const { index } = await loadOrBuildVault();
  const byId = new Map(index.documents.map((d) => [d.doc_id, d]));
  const selectedDocs = docIds.map((id) => byId.get(id)).filter((d): d is NonNullable<typeof d> => Boolean(d));

  if (selectedDocs.length === 0 && manualIds.length === 0) {
    return NextResponse.json({ ok: false, error: "所选文档在当前知识库中不存在" }, { status: 404 });
  }

  if (body.mode !== "run") {
    const [matDocs, matManuals] = await Promise.all([
      selectedDocs.length > 0 ? materializeDocs(selectedDocs) : Promise.resolve([]),
      manualIds.length > 0 ? materializeManuals(manualIds) : Promise.resolve([]),
    ]);
    if (matDocs.length === 0 && matManuals.length === 0) {
      return NextResponse.json({ ok: false, error: "所选阶段手册或文档不存在" }, { status: 404 });
    }
    const { snapshot } = buildPrecheck([...matDocs, ...matManuals]);
    return NextResponse.json({ ok: true, mode: "precheck", snapshot });
  }

  const result = await runStageSynthesis({
    docs: selectedDocs,
    manualIds,
    skillId: body.skillId || "short-term",
    stageTitle: body.stageTitle,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, mode: "run", report: result.report });
}
