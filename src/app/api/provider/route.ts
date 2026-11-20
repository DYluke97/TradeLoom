import { NextRequest, NextResponse } from "next/server";
import {
  callChatCompletion,
  getMaskedProviderStatus,
  loadProviderConfig,
  PROVIDER_PRESETS,
  saveProviderConfig,
} from "@/lib/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getMaskedProviderStatus();
  return NextResponse.json({ ok: true, status, presets: PROVIDER_PRESETS }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  let body: {
    action?: "save" | "test";
    url?: string;
    model?: string;
    apiKey?: string;
    keepExistingKey?: boolean;
    label?: string;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "请求体格式错误" }, { status: 400 });
  }

  if (body.action === "test") {
    const { config } = await loadProviderConfig();
    if (!config) {
      return NextResponse.json({ ok: false, error: "请先保存大模型 API 配置再进行连通测试" }, { status: 400 });
    }
    const ping = await callChatCompletion({
      config,
      system: "Reply with a short OK.",
      user: "ping",
      timeoutMs: 25_000,
    });
    if (!ping.ok) return NextResponse.json({ ok: false, error: ping.error }, { status: 502 });
    return NextResponse.json({
      ok: true,
      reply: ping.content.slice(0, 80),
      model: ping.model,
      usage: ping.usage,
    });
  }

  const saved = await saveProviderConfig({
    url: body.url ?? "",
    model: body.model ?? "",
    apiKey: body.apiKey,
    keepExistingKey: body.keepExistingKey,
    label: body.label,
  });
  if (!saved.ok) {
    return NextResponse.json(saved, { status: 400 });
  }
  return NextResponse.json(saved);
}
