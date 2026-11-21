import { NextRequest, NextResponse } from "next/server";
import { detectPlatformFromUrl, importPastedReview } from "@/lib/cloud-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function corsHeaders(request: NextRequest): HeadersInit {
  const origin = request.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

/**
 * Local-first Browser Bookmarklet clip endpoint.
 * Allows clipping logged-in pages (雪球 / 有道云笔记 / 印象笔记 / 飞书 / 语雀) directly from the user's browser
 * into the local TradeLoom vault without sharing any cookies or passwords.
 */
export async function POST(request: NextRequest) {
  const headers = corsHeaders(request);
  try {
    const body = (await request.json()) as {
      title?: string;
      url?: string;
      html?: string;
      text?: string;
      eventDate?: string;
    };

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
