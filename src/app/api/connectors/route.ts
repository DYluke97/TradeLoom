import { NextRequest, NextResponse } from "next/server";
import {
  disconnectConnector,
  getMaskedConnectors,
  saveConnectorConfig,
  syncConnector,
  testConnector,
  type ConnectorId,
} from "@/lib/cloud-connectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_IDS = new Set<ConnectorId>(["notion", "feishu", "yuque", "dida365", "youdao"]);

export async function GET() {
  const connectors = await getMaskedConnectors();
  return NextResponse.json({ ok: true, connectors });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      action?: "save" | "test" | "sync" | "disconnect";
      id?: string;
      fields?: Record<string, string>;
    };

    const id = body.id as ConnectorId;
    if (!VALID_IDS.has(id)) {
      return NextResponse.json({ ok: false, error: "不支持的连接器类型" }, { status: 400 });
    }

    if (body.action === "save") {
      const saved = await saveConnectorConfig(id, body.fields ?? {});
      if (!saved.ok) return NextResponse.json(saved, { status: 400 });
      return NextResponse.json(saved);
    }

    if (body.action === "disconnect") {
      const res = await disconnectConnector(id);
      return NextResponse.json(res);
    }

    if (body.action === "test") {
      const tested = await testConnector(id);
      if (!tested.ok) return NextResponse.json(tested, { status: 422 });
      return NextResponse.json(tested);
    }

    if (body.action === "sync") {
      const synced = await syncConnector(id);
      if (!synced.ok) return NextResponse.json(synced, { status: 422 });
      return NextResponse.json(synced);
    }

    return NextResponse.json({ ok: false, error: "未知操作类型" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "连接器请求失败" },
      { status: 500 },
    );
  }
}