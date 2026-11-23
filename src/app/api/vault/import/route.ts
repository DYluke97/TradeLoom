import { NextRequest, NextResponse } from "next/server";
import { importUploadedFile, rebuildVault } from "@/lib/vault";
import { getActiveVaultId, runWithVault } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const pinnedVaultId = getActiveVaultId();
  return runWithVault(pinnedVaultId, async () => {
    try {
      const form = await request.formData();
      const files = form.getAll("file").filter((item): item is File => item instanceof File);
      if (files.length === 0) {
        return NextResponse.json({ ok: false, error: "请选择至少一个复盘文件上传" }, { status: 400 });
      }

      const results: Array<{ fileName: string; ok: boolean; sourceRel?: string; carrier?: string; warnings?: string[]; error?: string }> = new Array(files.length);

      // Write all uploaded files concurrently (bounded pool) without rebuilding per file
      // (prevents O(N^2) rebuild stalls on 100+ file batches)
      const CONCURRENCY = 8;
      let nextIdx = 0;
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, files.length) }, async () => {
          while (nextIdx < files.length) {
            const i = nextIdx++;
            const file = files[i];
            const buf = Buffer.from(await file.arrayBuffer());
            const outcome = await importUploadedFile(file.name, buf, { skipRebuild: true });
            if (outcome.ok) {
              results[i] = {
                fileName: file.name,
                ok: true,
                sourceRel: outcome.sourceRel,
                carrier: outcome.carrier,
                warnings: outcome.warnings,
              };
            } else {
              results[i] = { fileName: file.name, ok: false, error: outcome.error };
            }
          }
        }),
      );

      const succeeded = results.filter((r) => r.ok).length;
      const latestIndex = succeeded > 0 ? await rebuildVault() : null;
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
  });
}
