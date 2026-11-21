"use client";

import { useEffect } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";

export default function GlobalRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // If browser had stale JS chunks after a local server rebuild, reload once automatically
    const msg = String(error?.message || "");
    if (/ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module/i.test(msg)) {
      const key = "tradeloom_chunk_reload_ts";
      const last = Number(sessionStorage.getItem(key) || "0");
      if (Date.now() - last > 10_000) {
        sessionStorage.setItem(key, String(Date.now()));
        window.location.reload();
      }
    }
  }, [error]);

  return (
    <div className="flex min-h-[70vh] items-center justify-center p-6">
      <div className="max-w-md space-y-4 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-6 text-xs shadow-2xl">
        <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          界面状态需要刷新同步
        </div>
        <p className="leading-6 text-[var(--ink-muted)]">
          检测到前端视图异常（常见于本地服务刚刚热更新构建后，浏览器仍持有旧版脚本缓存）。你的本地笔记与配置均完好无损。
        </p>
        {error?.message && (
          <pre className="max-h-24 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] p-2.5 font-mono text-[11px] text-red-300">
            {error.message}
          </pre>
        )}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-strong)] px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-[var(--accent)]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            强制刷新页面恢复
          </button>
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]"
          >
            重试当前组件
          </button>
        </div>
      </div>
    </div>
  );
}
