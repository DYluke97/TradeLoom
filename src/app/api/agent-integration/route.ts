import { NextRequest, NextResponse } from "next/server";
import { buildAgentIntegrationBundle } from "@/lib/mcp-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const host = request.headers.get("host") || "127.0.0.1:3200";
  const baseUrl = `http://${host}`;
  const bundle = buildAgentIntegrationBundle(baseUrl);
  return NextResponse.json({ ok: true, ...bundle }, { headers: { "Cache-Control": "no-store" } });
}
