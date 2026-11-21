"use client";

import Link from "next/link";
import {
  Bookmark,
  Check,
  ClipboardPaste,
  Cloud,
  Copy,
  Globe,
  Link2,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { VaultIndex } from "@/lib/vault-builder";

const PLATFORMS = [
  "飞书文档",
  "Notion",
  "有道云笔记",
  "滴答清单",
  "印象笔记",
  "雪球",
  "语雀",
  "微信公众号",
];

function buildBookmarklet(origin: string): string {
  const endpoint = `${origin}/api/vault/clip`;
  const code = `(async()=>{const s=window.getSelection&&window.getSelection().toString().trim();const el=document.querySelector('#js_content,.article__bd__detail,.Post-RichText,.ennote,.ne-viewer-body,article,main')||document.body;const payload={title:document.title,url:location.href,html:s?'':el.innerHTML,text:s||el.innerText};try{const r=await fetch(${JSON.stringify(endpoint)},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const d=await r.json();alert(d.ok?'已剪藏到 TradeLoom：'+d.title:'剪藏失败：'+(d.error||r.status));}catch(e){alert('无法连接本地 TradeLoom (${origin})，请确认服务已启动');}})();`;
  return `javascript:${encodeURIComponent(code)}`;
}

export default function CloudImportModal({
  open,
  initialTab = "paste",
  onClose,
  onImported,
}: {
  open: boolean;
  initialTab?: "paste" | "url" | "clip";
  onClose: () => void;
  onImported: (index: VaultIndex, cardRel: string, message: string) => void;
}) {
  const [tab, setTab] = useState<"paste" | "url" | "clip">(initialTab);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requiresLoginHint, setRequiresLoginHint] = useState(false);

  // Paste state
  const [platform, setPlatform] = useState("飞书文档");
  const [title, setTitle] = useState("");
  const [eventDate, setEventDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [tags, setTags] = useState("");
  const [content, setContent] = useState("");
  const [capturedHtml, setCapturedHtml] = useState("");

  // URL state
  const [urlInput, setUrlInput] = useState("");
  const [urlTitle, setUrlTitle] = useState("");
  const [urlDate, setUrlDate] = useState("");
  const [urlTags, setUrlTags] = useState("");

  // Bookmarklet state
  const [copiedBookmarklet, setCopiedBookmarklet] = useState(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:3200";
  const bookmarkletHref = useMemo(() => buildBookmarklet(origin), [origin]);

  if (!open) return null;

  function handleRichPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const html = e.clipboardData.getData("text/html");
    if (html && html.trim().length > 20) {
      setCapturedHtml(html);
    }
  }

  async function handlePasteSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setRequiresLoginHint(false);
    setBusy(true);
    try {
      const res = await fetch("/api/vault/paste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content,
          html: capturedHtml || undefined,
          eventDate,
          sourcePlatform: platform,
          tags,
        }),
      });
      const data = await res.json();
      if (data.ok && data.index) {
        onImported(
          data.index,
          data.cardRel,
          `已从「${platform}」粘贴入库《${data.title}》，并自动编入 Obsidian 双链星图。`,
        );
        setTitle("");
        setContent("");
        setCapturedHtml("");
        setTags("");
        onClose();
      } else {
        setError(data.error || "粘贴入库失败");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleUrlSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setRequiresLoginHint(false);
    setBusy(true);
    try {
      const res = await fetch("/api/vault/import-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: urlInput,
          title: urlTitle || undefined,
          eventDate: urlDate || undefined,
          tags: urlTags || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok && data.index) {
        onImported(
          data.index,
          data.cardRel,
          `已抓取网页《${data.title}》转为 Markdown 入库，并更新双链知识库。`,
        );
        setUrlInput("");
        setUrlTitle("");
        setUrlDate("");
        setUrlTags("");
        onClose();
      } else {
        setError(data.error || "网页抓取失败");
        if (data.requiresLogin) setRequiresLoginHint(true);
      }
    } finally {
      setBusy(false);
    }
  }

  async function copyBookmarkletCode() {
    await navigator.clipboard.writeText(bookmarkletHref);
    setCopiedBookmarklet(true);
    setTimeout(() => setCopiedBookmarklet(false), 2000);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#04060c]/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--cyan)]/35 bg-[#0f1422]/98 shadow-[0_24px_64px_rgba(0,0,0,0.8),0_0_32px_rgba(34,211,238,0.14)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Cloud className="h-4 w-4 text-[var(--cyan)]" />
            <h2 className="text-sm font-semibold text-[#f8fafc]">云端复盘采集 · 粘贴 / URL 抓取 / 剪藏</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--ink-dim)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Sub-Tabs */}
        <div className="flex items-center gap-1.5 border-b border-[var(--border)] bg-[var(--bg-deep)]/80 px-5 py-2.5">
          <button
            type="button"
            onClick={() => {
              setTab("paste");
              setError("");
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              tab === "paste"
                ? "border-[var(--cyan)]/50 bg-[var(--cyan-soft)] text-[var(--cyan)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            <ClipboardPaste className="h-3.5 w-3.5" />
            快捷粘贴（富文本自动转 MD）
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("url");
              setError("");
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              tab === "url"
                ? "border-[var(--accent)]/50 bg-[var(--accent-soft)] text-[var(--accent)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            <Globe className="h-3.5 w-3.5" />
            网页链接抓取（URL）
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("clip");
              setError("");
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              tab === "clip"
                ? "border-[var(--emerald)]/50 bg-[var(--emerald-soft)] text-[var(--emerald)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            <Bookmark className="h-3.5 w-3.5" />
            浏览器剪藏 & 云端直连
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === "paste" && (
            <form onSubmit={handlePasteSubmit} className="space-y-4">
              <div>
                <label className="block text-[11px] font-medium text-[var(--ink-muted)]">
                  来源平台标记（支持直接从云端网页 Ctrl+C 粘贴，自动保留标题/表格/加粗排版）
                </label>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {PLATFORMS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPlatform(p)}
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                        platform === p
                          ? "border-[var(--cyan)] bg-[var(--cyan-soft)] font-medium text-[var(--cyan)]"
                          : "border-[var(--border)] bg-[var(--bg-deep)] text-[var(--ink-muted)] hover:border-[var(--border-strong)] hover:text-[var(--ink)]"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] text-[var(--ink-muted)]">复盘标题（可留空，自动提取首行）</label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="例如：2025-11-20 冰点次日分歧转一致复盘"
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-1.5 text-xs text-[var(--ink)] focus:border-[var(--cyan)] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[var(--ink-muted)]">复盘日期</label>
                  <input
                    type="date"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-1.5 font-mono text-xs text-[var(--ink)] focus:border-[var(--cyan)] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="text-[11px] text-[var(--ink-muted)]">复盘正文（支持直接粘贴富文本或 Markdown）</label>
                  {capturedHtml && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--emerald)]/35 bg-[var(--emerald-soft)] px-2 py-0.5 text-[10px] text-[var(--emerald)]">
                      <Sparkles className="h-3 w-3" />
                      已捕获富文本排版，入库将自动转为 Markdown
                      <button
                        type="button"
                        onClick={() => setCapturedHtml("")}
                        className="ml-1 text-[var(--ink-muted)] hover:text-[var(--ink)]"
                        title="改用纯文本"
                      >
                        ×
                      </button>
                    </span>
                  )}
                </div>
                <textarea
                  value={content}
                  onChange={(e) => {
                    setContent(e.target.value);
                    if (!e.target.value) setCapturedHtml("");
                  }}
                  onPaste={handleRichPaste}
                  rows={8}
                  placeholder="在飞书 / Notion / 有道云笔记 / 印象笔记 / 雪球 / 语雀中 Ctrl+A 复制正文后，直接在这里 Ctrl+V 粘贴..."
                  className="mt-1.5 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] p-3 font-mono text-xs leading-6 text-[var(--ink)] placeholder:text-[var(--ink-dim)] focus:border-[var(--cyan)] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] text-[var(--ink-muted)]">
                  补充标签（可选，逗号或空格分隔，自动关联至 30-主题 节点）
                </label>
                <input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="例如：情绪周期, 龙头战法, 退潮风控"
                  className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-1.5 text-xs text-[var(--ink)] focus:border-[var(--cyan)] focus:outline-none"
                />
              </div>

              {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-xs text-red-300">{error}</div>}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-[var(--border)] px-3.5 py-1.5 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={busy || (!content.trim() && !capturedHtml.trim())}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#7c4dff] to-[#22d3ee] px-4 py-1.5 text-xs font-semibold text-white shadow-[0_0_16px_rgba(34,211,238,0.28)] transition hover:brightness-110 disabled:opacity-50"
                >
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {busy ? "正在转 Markdown 并构建双链..." : "一键入库并编排双链"}
                </button>
              </div>
            </form>
          )}

          {tab === "url" && (
            <form onSubmit={handleUrlSubmit} className="space-y-4">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/90 p-3 text-xs leading-6 text-[var(--ink-muted)]">
                已深度适配 <strong className="text-[var(--cyan)]">7 大主流平台公开链接直抓</strong>：
                <strong className="text-[var(--ink)]">雪球</strong>（含转发原帖）、
                <strong className="text-[var(--ink)]">微信公众号</strong>、
                <strong className="text-[var(--ink)]">语雀</strong>、
                <strong className="text-[var(--ink)]">飞书公开文档</strong>、
                <strong className="text-[var(--ink)]">Notion 公开页</strong>、
                <strong className="text-[var(--ink)]">有道云笔记公开分享</strong>、
                <strong className="text-[var(--ink)]">印象笔记公开分享</strong>（以及 GitHub Raw 与博客）。
                <span className="text-[var(--ink-dim)]">
                  （知乎与 Evernote 国际版因人机风控，推荐使用「快捷粘贴」或「浏览器剪藏」）
                </span>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[var(--ink-muted)]">网页链接 URL</label>
                <div className="relative mt-1">
                  <Link2 className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-[var(--accent)]" />
                  <input
                    type="url"
                    required
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="https://xueqiu.com/... 或 https://mp.weixin.qq.com/s/..."
                    className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] py-2 pl-9 pr-3 text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] text-[var(--ink-muted)]">自定义标题（留空自动抓取页面标题）</label>
                  <input
                    value={urlTitle}
                    onChange={(e) => setUrlTitle(e.target.value)}
                    placeholder="留空自动提取"
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-1.5 text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[var(--ink-muted)]">复盘日期（留空自动识别）</label>
                  <input
                    type="date"
                    value={urlDate}
                    onChange={(e) => setUrlDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-1.5 font-mono text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-[var(--ink-muted)]">补充标签（可选）</label>
                <input
                  value={urlTags}
                  onChange={(e) => setUrlTags(e.target.value)}
                  placeholder="例如：基本面排雷, 龙头梯队"
                  className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-1.5 text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                />
              </div>

              {error && (
                <div className="space-y-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
                  <div>{error}</div>
                  {requiresLoginHint && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setTab("paste");
                          setError("");
                        }}
                        className="rounded border border-[var(--cyan)]/50 bg-[var(--cyan-soft)] px-2.5 py-1 text-[11px] text-[var(--cyan)]"
                      >
                        切换到「快捷粘贴入库」
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setTab("clip");
                          setError("");
                        }}
                        className="rounded border border-[var(--emerald)]/50 bg-[var(--emerald-soft)] px-2.5 py-1 text-[11px] text-[var(--emerald)]"
                      >
                        查看「浏览器一键剪藏」
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-[var(--border)] px-3.5 py-1.5 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={busy || !urlInput.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-strong)] px-4 py-1.5 text-xs font-semibold text-white shadow-[0_0_16px_rgba(124,77,255,0.4)] transition hover:bg-[var(--accent)] disabled:opacity-50"
                >
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {busy ? "正在抓取正文并转 Markdown..." : "立即抓取入库"}
                </button>
              </div>
            </form>
          )}

          {tab === "clip" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-[var(--emerald)]/35 bg-[var(--bg-deep)]/90 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-[var(--emerald)]">
                    方式 A：浏览器一键剪藏（专治雪球 / 有道云笔记 / 印象笔记 登录墙）
                  </div>
                  <span className="rounded-full bg-[var(--emerald-soft)] px-2 py-0.5 font-mono text-[10px] text-[var(--emerald)]">
                    零账号密码风险
                  </span>
                </div>
                <p className="mt-2 text-xs leading-6 text-[var(--ink-muted)]">
                  把下面这个按钮<strong className="text-[var(--ink)]">直接拖拽到浏览器的书签栏</strong>。当你在浏览器里打开已登录的雪球私密笔记、有道云笔记或印象笔记网页版时，点击该书签即可把正文（或你鼠标选中的段落）直接发送到本地 TradeLoom 入库：
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-2.5">
                  <a
                    href={bookmarkletHref}
                    onClick={(e) => e.preventDefault()}
                    draggable
                    title="按住此按钮拖到浏览器书签栏"
                    className="inline-flex cursor-grab items-center gap-1.5 rounded-lg border border-[var(--cyan)]/60 bg-gradient-to-r from-[#7c4dff]/35 to-[#22d3ee]/35 px-3.5 py-2 text-xs font-semibold text-[#f8fafc] shadow-[0_0_16px_rgba(34,211,238,0.22)] active:cursor-grabbing"
                  >
                    <Bookmark className="h-3.5 w-3.5 text-[var(--cyan)]" />
                    发送到 TradeLoom（拖我到书签栏）
                  </a>

                  <button
                    type="button"
                    onClick={copyBookmarkletCode}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--ink-muted)] transition hover:border-[var(--cyan)]/50 hover:text-[var(--ink)]"
                  >
                    {copiedBookmarklet ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-[var(--emerald)]" />
                        已复制脚本（可手动新建书签粘贴至网址栏）
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        复制书签脚本
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-[var(--accent)]/35 bg-[var(--bg-deep)]/90 p-4">
                <div className="text-xs font-semibold text-[var(--accent)]">
                  方式 B：官方 API 批量直连同步（Notion / 飞书文档 / 语雀 / 滴答清单）
                </div>
                <p className="mt-2 text-xs leading-6 text-[var(--ink-muted)]">
                  如果你的多年复盘系统化存在 <strong className="text-[var(--ink)]">Notion、飞书文档、语雀或滴答清单</strong>，可以在「云端平台连接器」中配置你自己的个人 Token（纯本地保存），一键批量拉取历史笔记并自动编织双链。
                </p>
                <div className="mt-3">
                  <Link
                    href="/settings?tab=connectors"
                    onClick={onClose}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-strong)] px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-[var(--accent)]"
                  >
                    <Cloud className="h-3.5 w-3.5" />
                    前往配置 Notion / 飞书 / 语雀 / 滴答清单连接器 →
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
