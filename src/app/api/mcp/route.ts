import { NextRequest, NextResponse } from "next/server";
import { handleMcpJsonRpc, MCP_PROTOCOL_VERSION, MCP_SERVER_INFO, TRADELOOM_MCP_TOOLS } from "@/lib/mcp-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      protocol: "mcp-streamable-http",
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: MCP_SERVER_INFO,
      toolsCount: TRADELOOM_MCP_TOOLS.length,
      tools: TRADELOOM_MCP_TOOLS.map((t) => ({ name: t.name, description: t.description })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "无效的 JSON-RPC 请求体" } },
      { status: 400 },
    );
  }

  // Handle JSON-RPC batch or single message
  if (Array.isArray(payload)) {
    const responses = [];
    for (const item of payload) {
      if (!item || typeof item !== "object") continue;
      const res = await handleMcpJsonRpc(item as Record<string, unknown>);
      if (res) responses.push(res);
    }
    if (responses.length === 0) return new NextResponse(null, { status: 202 });
    return NextResponse.json(responses, { headers: { "Cache-Control": "no-store" } });
  }

  if (!payload || typeof payload !== "object") {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "无效的 JSON-RPC 对象" } },
      { status: 400 },
    );
  }

  const res = await handleMcpJsonRpc(payload as Record<string, unknown>);
  if (!res) {
    return new NextResponse(null, { status: 202 });
  }
  return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
}
