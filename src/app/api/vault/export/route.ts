import { NextResponse } from "next/server";
import { exportVaultZipBuffer } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const zipBuf = await exportVaultZipBuffer();
    const dateStamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(new Uint8Array(zipBuf), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="TradeLoom-Vault-${dateStamp}.zip"`,
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
