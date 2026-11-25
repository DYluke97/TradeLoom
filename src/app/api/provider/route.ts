import { NextRequest, NextResponse } from "next/server";
import { callLocalCliAgent, detectLocalCliAgents, type CliAgentId } from "@/lib/cli-agents";
import {
  callChatCompletion,
  getMaskedProviderStatus,
  loadProviderConfig,
  PROVIDER_PRESETS,
  saveCliAgentProviderConfig,
  saveProviderConfig,
} from "@/lib/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET() {
  const status = await getMaskedProviderStatus();
  const cliAgents = detectLocalCliAgents();
  return NextResponse.json(
    { ok: true, status, presets: PROVIDER_PRESETS, cliAgents },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  let body: {
    action?: "save" | "save-cli" | "test" | "test-cli";
    url?: string;
    model?: string;
    apiKey?: string;
    keepExistingKey?: boolean;
    label?: string;
    agentId?: string;
    binPath?: string;
    customArgs?: string;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "请求体格式错误" }, { status: 400 });
  }

  if (body.action === "save-cli") {
    const saved = await saveCliAgentProviderConfig({
      agentId: body.agentId ?? "",
      model: body.model,
      binPath: body.binPath,
      customArgs: body.customArgs,
    });
    if (!saved.ok) {
      return NextResponse.json(saved, { status: 400 });
    }
    return NextResponse.json({ ...saved, cliAgents: detectLocalCliAgents() });
  }

  if (body.action === "test-cli") {
    const ping = await callLocalCliAgent({
      agentId: (body.agentId ?? "") as CliAgentId,
      model: body.model,
      binPath: body.binPath,
      customArgs: body.customArgs,
      system: "Reply with a short OK only.",
      user: "ping",
      timeoutMs: 90_000,
    });
    if (!ping.ok) return NextResponse.json({ ok: false, error: ping.error }, { status: 502 });
    return NextResponse.json({
      ok: true,
      reply: ping.content.slice(0, 120),
      model: ping.model,
      usage: ping.usage,
    });
  }

  if (body.action === "test") {
    const { config } = await loadProviderConfig();
    if (!config) {
      return NextResponse.json({ ok: false, error: "请先保存 AI 引擎配置（本机 CLI Agent 或 API）再进行连通测试" }, { status: 400 });
    }
    const ping = await callChatCompletion({
      config,
      system: "Reply with a short OK.",
      user: "ping",
      timeoutMs: config.mode === "cli" ? 90_000 : 25_000,
    });
    if (!ping.ok) return NextResponse.json({ ok: false, error: ping.error }, { status: 502 });
    return NextResponse.json({
      ok: true,
      reply: ping.content.slice(0, 120),
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
