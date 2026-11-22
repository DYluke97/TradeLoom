import { NextRequest, NextResponse } from "next/server";
import { saveFeishuCredentialsFromRegistration } from "@/lib/cloud-connectors";
import {
  beginFeishuAppRegistration,
  detectLarkCliStatus,
  pollFeishuAppRegistration,
  startLarkCliUserLogin,
} from "@/lib/feishu-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      action?: "register_start" | "register_poll" | "cli_status" | "cli_login";
      brand?: "feishu" | "lark";
      sessionId?: string;
      existingAppId?: string;
      profile?: string;
    };

    if (body.action === "register_start") {
      const started = await beginFeishuAppRegistration({
        brand: body.brand === "lark" ? "lark" : "feishu",
        existingAppId: body.existingAppId,
      });
      return NextResponse.json({ ok: true, ...started });
    }

    if (body.action === "register_poll") {
      const sessionId = String(body.sessionId ?? "").trim();
      if (!sessionId) {
        return NextResponse.json({ ok: false, error: "缺少 sessionId" }, { status: 400 });
      }
      const outcome = await pollFeishuAppRegistration(sessionId);
      if (outcome.status === "completed") {
        const connectors = await saveFeishuCredentialsFromRegistration({
          appId: outcome.appId,
          appSecret: outcome.appSecret,
          domain: outcome.domain,
        });
        return NextResponse.json({
          ok: true,
          status: "completed",
          appId: outcome.appId,
          domain: outcome.domain,
          connectors,
        });
      }
      if (outcome.status === "pending") {
        return NextResponse.json({
          ok: true,
          status: "pending",
          interval: outcome.interval,
          remainingSec: outcome.remainingSec,
        });
      }
      return NextResponse.json({ ok: false, status: outcome.status, error: outcome.error }, { status: 400 });
    }

    if (body.action === "cli_status") {
      const cli = await detectLarkCliStatus(body.profile);
      return NextResponse.json({ ok: true, cli });
    }

    if (body.action === "cli_login") {
      const login = await startLarkCliUserLogin(body.profile);
      if (!login.ok) {
        return NextResponse.json({ ok: false, error: login.message }, { status: 422 });
      }
      return NextResponse.json(login);
    }

    return NextResponse.json({ ok: false, error: "未知的飞书 Agent 操作类型" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "飞书 Agent 请求失败" },
      { status: 500 },
    );
  }
}