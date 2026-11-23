import { NextRequest, NextResponse } from "next/server";

const MUTATING_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

function isAllowedHostHeader(rawHost: string): boolean {
  const trimmed = rawHost.trim().toLowerCase();
  if (!trimmed) return false;

  // Strip port (handles IPv4/hostname `localhost:3200` and bracketed IPv6 `[::1]:3200`)
  let hostname = trimmed;
  if (trimmed.startsWith("[")) {
    const closeIdx = trimmed.indexOf("]");
    if (closeIdx > 0) hostname = trimmed.slice(0, closeIdx + 1);
  } else {
    hostname = trimmed.split(":")[0] ?? "";
  }

  if (hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]") {
    return true;
  }

  const extra = (process.env.TRADELOOM_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return extra.includes(trimmed) || extra.includes(hostname);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const host = request.headers.get("host") ?? "";
  if (host && !isAllowedHostHeader(host)) {
    return NextResponse.json(
      { ok: false, error: "安全拦截：拒绝未授权的 Host 访问（防止 DNS Rebinding 攻击）" },
      { status: 403 },
    );
  }

  // Bookmarklet clipper endpoint uses its own cryptographic X-TradeLoom-Clip-Token + CORS
  if (pathname === "/api/vault/clip") {
    return NextResponse.next();
  }

  if (MUTATING_METHODS.has(request.method.toUpperCase())) {
    const fetchSite = (request.headers.get("sec-fetch-site") ?? "").toLowerCase();
    if (fetchSite === "cross-site") {
      return NextResponse.json(
        { ok: false, error: "安全拦截：禁止第三方网页跨站调用本地写接口（CSRF 防护）" },
        { status: 403 },
      );
    }

    const origin = request.headers.get("origin");
    if (origin && host) {
      try {
        const originHost = new URL(origin).host.toLowerCase();
        if (originHost !== host.trim().toLowerCase()) {
          return NextResponse.json(
            { ok: false, error: "安全拦截：请求 Origin 与当前服务地址不一致" },
            { status: 403 },
          );
        }
      } catch {
        return NextResponse.json({ ok: false, error: "安全拦截：非法的 Origin 请求头" }, { status: 403 });
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
