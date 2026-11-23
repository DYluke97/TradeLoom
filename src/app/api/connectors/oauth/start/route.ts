import { NextRequest, NextResponse } from "next/server";
import { startConnectorMcpOAuth } from "@/lib/cloud-connectors";
import type { McpOAuthConnectorId } from "@/lib/mcp-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set<McpOAuthConnectorId>(["dida365", "notion"]);

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { id?: string; region?: "cn" | "global" };
    const id = body.id as McpOAuthConnectorId;
    if (!ALLOWED.has(id)) {
      return NextResponse.json({ ok: false, error: "该平台暂不支持官方 MCP 一键 OAuth 登录" }, { status: 400 });
    }

    const rawHost = request.headers.get("x-forwarded-host") || request.headers.get("host") || `127.0.0.1:${process.env.PORT || 3200}`;
    const host = rawHost.split(",")[0]!.trim();
    const rawProto = request.headers.get("x-forwarded-proto") || "http";
    const proto = rawProto.split(",")[0]!.trim() === "https" ? "https" : "http";
    const origin = `${proto}://${host}`;

    const result = await startConnectorMcpOAuth({
      id,
      origin,
      region: body.region === "global" ? "global" : "cn",
    });
    if (!result.ok) {
      return NextResponse.json(result, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "发起 OAuth 授权失败" },
      { status: 500 },
    );
  }
}