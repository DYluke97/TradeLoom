import { NextRequest, NextResponse } from "next/server";
import { completeConnectorMcpOAuth } from "@/lib/cloud-connectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const host = request.headers.get("host") || "127.0.0.1:3200";
  const proto = request.headers.get("x-forwarded-proto") || "http";
  const baseOrigin = `${proto}://${host}`;
  const redirectTarget = new URL("/settings", baseOrigin);
  redirectTarget.searchParams.set("tab", "connectors");

  const { searchParams } = new URL(request.url);
  const error = searchParams.get("error");
  const errorDesc = searchParams.get("error_description");
  const code = searchParams.get("code") ?? "";
  const state = searchParams.get("state") ?? "";

  if (error) {
    redirectTarget.searchParams.set("oauth_err", errorDesc || error);
    return NextResponse.redirect(redirectTarget);
  }

  if (!code || !state) {
    redirectTarget.searchParams.set("oauth_err", "回调缺少授权码或 state 参数");
    return NextResponse.redirect(redirectTarget);
  }

  const res = await completeConnectorMcpOAuth({ state, code });
  if (!res.ok) {
    redirectTarget.searchParams.set("oauth_err", res.error);
    return NextResponse.redirect(redirectTarget);
  }

  redirectTarget.searchParams.set("oauth_ok", res.connectorId);
  if (typeof res.discoveredCount === "number") {
    redirectTarget.searchParams.set("oauth_count", String(res.discoveredCount));
  }
  return NextResponse.redirect(redirectTarget);
}