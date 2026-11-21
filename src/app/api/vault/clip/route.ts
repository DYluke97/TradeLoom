import { NextRequest, NextResponse } from "next/server";
import { detectPlatformFromUrl, importPastedReview } from "@/lib/cloud-ingest";
import { getOrCreateClipToken, verifyClipToken } from "@/lib/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function corsHeaders(request: NextRequest): HeadersInit {
  const origin = request.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-TradeLoom-Clip-Token",
  };
}

export async function GET() {
  const clipToken = await getOrCreateClipToken();
  return NextResponse.json({ ok: true, clipToken }, { headers: { "Cache-Control": "no-store" } });
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: NextRequest) {
  const headers = corsHeaders(request);
  try {
    const body = (await request.json()) as {
      title?: string;
      url?: string;
      html?: string;
      text?: string;
      eventDate?: string;
      clipToken?: string;
    };

    const headerToken = request.headers.get("x-tradeloom-clip-token") ?? body.clipToken ?? "";
    if (!(await verifyClipToken(headerToken))) {
      return NextResponse.json(
        {
          ok: false,
          error: "剪藏安全令牌缺失或已更新，请在本地 TradeLoom「云端采集 → 浏览器剪藏」重新拖拽最新书签按钮。",
        },
        { status: 403, headers },
      );
    }

    const platform = body.url ? detectPlatformFromUrl(body.url) : "浏览器剪藏";
    const outcome = await importPastedReview({
      title: body.title,
      html: body.html,
      content: body.text,
      eventDate: body.eventDate,
      sourcePlatform: `${platform} · 剪藏`,
      sourceUrl: body.url,
      folder: "_云端_剪藏",
    });

    if (!outcome.ok) {
      return NextResponse.json({ ok: false, error: outcome.error }, { status: outcome.status, headers });
    }
    return NextResponse.json(
      {
        ok: true,
        title: outcome.title,
        sourceRel: outcome.sourceRel,
        cardRel: outcome.cardRel,
        eventDate: outcome.eventDate,
      },
      { headers },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "剪藏失败" },
      { status: 500, headers },
    );
  }
}
