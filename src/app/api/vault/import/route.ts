import { NextRequest, NextResponse } from "next/server";
import { importUploadedFile } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const files = form.getAll("file").filter((item): item is File => item instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ ok: false, error: "请选择至少一个复盘文件上传" }, { status: 400 });
    }

    const results: Array<{ fileName: string; ok: boolean; sourceRel?: string; carrier?: string; warnings?: string[]; error?: string }> = [];
    let latestIndex = null;

    for (const file of files) {
      const buf = Buffer.from(await file.arrayBuffer());
      const outcome = await importUploadedFile(file.name, buf);
      if (outcome.ok) {
        latestIndex = outcome.index;
        results.push({
          fileName: file.name,
          ok: true,
          sourceRel: outcome.sourceRel,
          carrier: outcome.carrier,
          warnings: outcome.warnings,
        });
      } else {
        results.push({ fileName: file.name, ok: false, error: outcome.error });
      }
    }

    const succeeded = results.filter((r) => r.ok).length;
    return NextResponse.json(
      { ok: succeeded > 0, succeeded, total: results.length, results, index: latestIndex },
      { status: succeeded > 0 ? 200 : 422 },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "文件导入失败" },
      { status: 500 },
    );
  }
}
