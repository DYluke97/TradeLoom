import { NextRequest, NextResponse } from "next/server";
import { exportVaultZipBuffer } from "@/lib/vault";
import { DEFAULT_VAULT_ID, getActiveVaultId, isValidVaultId } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const qVault = request.nextUrl.searchParams.get("vaultId")?.trim();
    const vaultId = qVault && isValidVaultId(qVault) ? qVault : getActiveVaultId();
    const zipBuf = await exportVaultZipBuffer(vaultId);
    const dateStamp = new Date().toISOString().slice(0, 10);
    const suffix = vaultId === DEFAULT_VAULT_ID ? "" : `-${vaultId}`;
    return new NextResponse(new Uint8Array(zipBuf), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="TradeLoom-Vault${suffix}-${dateStamp}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "打包导出知识库失败" },
      { status: 500 },
    );
  }
}
