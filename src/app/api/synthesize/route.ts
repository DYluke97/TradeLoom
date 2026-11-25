import { NextRequest, NextResponse } from "next/server";
import { buildPeriodQuantBrief } from "@/lib/ledger";
import {
  buildPrecheck,
  clampOutboundLimit,
  exportSynthesisPromptPack,
  importExternalSynthesisResult,
  materializeDocs,
  materializeManuals,
  runStageSynthesis,
} from "@/lib/synthesis";
import { loadOrBuildVault } from "@/lib/vault";
import { getActiveVaultId, runWithVault } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  let body: {
    mode?: "precheck" | "run" | "export-prompt" | "import-result";
    stream?: boolean;
    docIds?: string[];
    manualIds?: string[];
    skillId?: string;
    stageTitle?: string;
    includeQuantAudit?: boolean;
    maxChars?: number;
    rawResponse?: string;
    modelLabel?: string;
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

  // Pin active vault ID at request entry so mid-synthesis vault switches never write manuals into the wrong vault
  const pinnedVaultId = getActiveVaultId();

  return runWithVault(pinnedVaultId, async () => {
    const { index } = await loadOrBuildVault();
    const byId = new Map(index.documents.map((d) => [d.doc_id, d]));
    const selectedDocs = docIds.map((id) => byId.get(id)).filter((d): d is NonNullable<typeof d> => Boolean(d));

    if (selectedDocs.length === 0 && manualIds.length === 0) {
      return NextResponse.json({ ok: false, error: "所选文档在当前知识库中不存在" }, { status: 404 });
    }

    const outboundLimit = clampOutboundLimit(body.maxChars);

    if (body.mode === "export-prompt") {
      const exported = await exportSynthesisPromptPack({
        docs: selectedDocs,
        manualIds,
        skillId: body.skillId || "short-term",
        stageTitle: body.stageTitle,
        includeQuantAudit: body.includeQuantAudit !== false,
        maxChars: outboundLimit,
      });
      if (!exported.ok) {
        return NextResponse.json({ ok: false, error: exported.error }, { status: exported.status });
      }
      return NextResponse.json({ ...exported, mode: "export-prompt" });
    }

    if (body.mode === "import-result") {
      const imported = await importExternalSynthesisResult({
        docs: selectedDocs,
        manualIds,
        skillId: body.skillId || "short-term",
        stageTitle: body.stageTitle,
        includeQuantAudit: body.includeQuantAudit !== false,
        maxChars: outboundLimit,
        rawResponse: typeof body.rawResponse === "string" ? body.rawResponse : "",
        modelLabel: typeof body.modelLabel === "string" ? body.modelLabel : undefined,
      });
      if (!imported.ok) {
        return NextResponse.json({ ok: false, error: imported.error }, { status: imported.status });
      }
      return NextResponse.json({ ok: true, mode: "import-result", report: imported.report });
    }

    if (body.mode !== "run") {
      const [matDocs, matManuals] = await Promise.all([
        selectedDocs.length > 0 ? materializeDocs(selectedDocs) : Promise.resolve([]),
        manualIds.length > 0 ? materializeManuals(manualIds) : Promise.resolve([]),
      ]);
      if (matDocs.length === 0 && matManuals.length === 0) {
        return NextResponse.json({ ok: false, error: "所选阶段手册或文档不存在" }, { status: 404 });
      }
      const { snapshot } = buildPrecheck([...matDocs, ...matManuals], outboundLimit);
      const quantBrief = await buildPeriodQuantBrief(
        snapshot.date_range.from ?? undefined,
        snapshot.date_range.to ?? undefined,
      ).catch(() => null);
      return NextResponse.json({ ok: true, mode: "precheck", snapshot, quantBrief });
    }

    if (body.stream) {
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          await runWithVault(pinnedVaultId, async () => {
            const send = (payload: Record<string, unknown>) => {
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
              } catch {
                /* stream already closed */
              }
            };
            try {
              const result = await runStageSynthesis({
                docs: selectedDocs,
                manualIds,
                skillId: body.skillId || "short-term",
                stageTitle: body.stageTitle,
                includeQuantAudit: body.includeQuantAudit !== false,
                maxChars: outboundLimit,
                signal: request.signal,
                onStage: (ev) => send({ type: "progress", ...ev }),
              });
              if (!result.ok) {
                send({ type: "error", error: result.error });
              } else {
                send({ type: "done", ok: true, report: result.report });
              }
            } catch (err) {
              send({ type: "error", error: err instanceof Error ? err.message : "流式提炼中断" });
            } finally {
              try {
                controller.close();
              } catch {
                /* ignore */
              }
            }
          });
        },
      });

      return new Response(readable, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    const result = await runStageSynthesis({
      docs: selectedDocs,
      manualIds,
      skillId: body.skillId || "short-term",
      stageTitle: body.stageTitle,
      includeQuantAudit: body.includeQuantAudit !== false,
      maxChars: outboundLimit,
      signal: request.signal,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }

    return NextResponse.json({ ok: true, mode: "run", report: result.report });
  });
}
