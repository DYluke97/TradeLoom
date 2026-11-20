import { NextRequest, NextResponse } from "next/server";
import { loadOrBuildVault, readOriginalBytes } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const card = (request.nextUrl.searchParams.get("card") ?? "").trim();
  if (!card) return new NextResponse("Missing card parameter", { status: 400 });

  const { index } = await loadOrBuildVault();
  const doc = index.documents.find((d) => d.card === card);
  if (!doc) return new NextResponse("Not found", { status: 404 });

  const raw = await readOriginalBytes(doc.source_rel);
  if (!raw) return new NextResponse("File unavailable", { status: 404 });

  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
    "Content-Length": String(raw.byteLength),
  };

  if (doc.carrier === "pdf") {
    headers["Content-Type"] = "application/pdf";
  } else if (doc.carrier === "html") {
    headers["Content-Type"] = "text/html; charset=utf-8";
    headers["Content-Security-Policy"] = "sandbox; default-src 'none'; style-src 'unsafe-inline'";
  } else {
    headers["Content-Type"] = "text/plain; charset=utf-8";
  }

  return new NextResponse(raw.bytes, { status: 200, headers });
}
