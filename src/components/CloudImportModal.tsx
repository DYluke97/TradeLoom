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
import { useEffect, useMemo, useState } from "react";
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

const REVIEW_TEMPLATES = [
  {
    id: "plan-exec",
    label: "盘前计划 vs 盘后执行",
    tags: "盘前预案, 知行合一, 执行偏差",
    body: `## 一、市场环境与周期锚定
- 指数与成交额量级：
- 情绪/主线阶段定位（顺风进攻 / 震荡轮动 / 退潮防守）：
- 今日计划总仓位上限：

## 二、盘前交易预案（非计划内标的盘中严禁临时起意）
- 目标标的与核心逻辑：
- 计划买点触发条件：
- 计划止损 / 不及预期退出位：

## 三、盘中实际执行与偏离审计
- 实际操作记录（标的 / 仓位 / 成交逻辑）：
- 是否发生计划外冲动交易或扛单偏离：
- 当日账户盈亏与最大回撤感受：

## 四、明日修正纪律
- 明日开盘去弱留强标准：
`,
  },
  {
    id: "swing-track",
    label: "趋势/周期持仓跟踪",
    tags: "趋势波段, 仓位管理, 逻辑证伪",
    body: `## 一、核心持仓与中期驱动假设
- 当前核心持仓与仓位占比（含是否使用融资）：
- 核心供需/景气/业绩驱动逻辑：

## 二、关键验证指标与加减仓节点
- 逻辑强化的右侧加仓条件：
- 波动率/回撤降仓红线：
- 核心逻辑证伪的无条件清仓条件：

## 三、今日盘面反馈与心态记录
- 板块与个股强弱反馈：
- 是否有恐慌杀跌或过早止盈倾向：
`,
  },
  {
    id: "loss-autopsy",
    label: "大亏反例深度解剖",
    tags: "反例复盘, 大亏回撤, 风控红线",
    body: `## 一、亏损事实还原
- 亏损标的、介入日期与单笔/账户回撤幅度：
- 当时所处的市场与板块阶段：

## 二、致命归因（区分模式内正常试错 vs 模式外违纪）
- 违反了哪条既有交易纪律（如退潮硬做、逆势满融、破位补仓）：
- 当时的真实心理诱因（怕踏空 / 急于回本 / 锚定浮盈）：

## 三、可执行的硬性阻断条款
- 下次出现什么可观测信号时无条件物理阻断：
`,
  },
] as const;

function buildBookmarklet(origin: string, clipToken: string): string {
  const endpoint = `${origin}/api/vault/clip`;
  const code = `(async()=>{const s=window.getSelection&&window.getSelection().toString().trim();const el=document.querySelector('#js_content,.article__bd__detail,.Post-RichText,.ennote,.ne-viewer-body,article,main')||document.body;const payload={title:document.title,url:location.href,html:s?'':el.innerHTML,text:s||el.innerText};try{const r=await fetch(${JSON.stringify(endpoint)},{method:'POST',headers:{'Content-Type':'application/json','X-TradeLoom-Clip-Token':${JSON.stringify(clipToken)}},body:JSON.stringify(payload)});const d=await r.json();alert(d.ok?'已剪藏到 TradeLoom：'+d.title:'剪藏失败：'+(d.error||r.status));}catch(e){alert('无法连接本地 TradeLoom (${origin})，请确认服务已启动');}})();`;
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
  const [clipToken, setClipToken] = useState("");

  useEffect(() => {
    if (!open) return;
    fetch("/api/vault/clip", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && typeof d.clipToken === "string") setClipToken(d.clipToken);
      })
      .catch(() => {});
  }, [open]);

  const origin = typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:3200";
  const bookmarkletHref = useMemo(() => buildBookmarklet(origin, clipToken), [origin, clipToken]);

  const parsedUrlCount = useMemo(() => {
    return urlInput
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => /https?:\/\//i.test(s)).length;
  }, [urlInput]);

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
      const isBatch = parsedUrlCount > 1;
      const res = await fetch("/api/vault/import-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isBatch
            ? {
                urls: urlInput,
                eventDate: urlDate || undefined,
                tags: urlTags || undefined,
              }
            : {
                url: urlInput.trim(),
                title: urlTitle || undefined,
                eventDate: urlDate || undefined,
                tags: urlTags || undefined,
              },
        ),
      });
      const data = await res.json();
      if (data.ok && data.index) {
        if (data.batch) {
          const failNote = data.failed > 0 ? `（另有 ${data.failed} 条抓取失败）` : "";
          onImported(
            data.index,
            data.cardRel,
            `批量防限流队列完成：成功入库 ${data.succeeded} / ${data.total} 篇复盘${failNote}，并已完成双链编排。`,
          );
        } else {
          onImported(
            data.index,
            data.cardRel,
            `已抓取网页《${data.title}》转为 Markdown 入库，并更新双链知识库。`,
          );
        }
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--cyan)]/35 bg-[var(--surface)] shadow-[var(--shadow-modal)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Cloud className="h-[19px] w-[19px] text-[var(--cyan)]" />
            <h2 className="text-sm font-semibold text-[var(--ink-strong)]">云端复盘采集 · 粘贴 / URL 抓取 / 剪藏</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--ink-dim)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
          >
            <X className="h-[19px] w-[19px]" />
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
            <ClipboardPaste className="h-[17px] w-[17px]" />
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
            <Globe className="h-[17px] w-[17px]" />
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
            <Bookmark className="h-[17px] w-[17px]" />
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
                    type="date" onClick={(e) => { try { (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch {} }}
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-1.5 font-mono text-xs text-[var(--ink)] focus:border-[var(--cyan)] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1.5">
                  <label className="text-[11px] text-[var(--ink-muted)]">复盘正文（支持粘贴富文本，或一键套用专业投研模板）</label>
                  <div className="flex flex-wrap items-center gap-1">
                    {REVIEW_TEMPLATES.map((tpl) => (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => {
                          setCapturedHtml("");
                          setContent((prev) => (prev.trim() ? `${prev.trim()}\n\n${tpl.body}` : tpl.body));
                          if (!tags.trim()) setTags(tpl.tags);
                        }}
                        className="rounded border border-[var(--accent)]/40 bg-[var(--accent-soft)]/70 px-2 py-0.5 text-[10px] text-[var(--accent)] transition hover:brightness-110"
                      >
                        + {tpl.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  {capturedHtml && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--emerald)]/35 bg-[var(--emerald-soft)] px-2 py-0.5 text-[10px] text-[var(--emerald)]">
                      <Sparkles className="h-4 w-4" />
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

              {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-xs text-[var(--rose)]">{error}</div>}

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
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-strong)] px-4 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                >
                  {busy && <Loader2 className="h-[17px] w-[17px] animate-spin" />}
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
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-[11px] font-medium text-[var(--ink-muted)]">
                    网页链接 URL（支持单条，或每行一条批量粘贴最多 50 条）
                  </label>
                  {parsedUrlCount > 1 && (
                    <span className="rounded-full border border-[var(--cyan)]/40 bg-[var(--cyan-soft)] px-2 py-0.5 font-mono text-[10px] text-[var(--cyan)]">
                      检测到 {Math.min(parsedUrlCount, 50)} 条链接 · 自动启用防限流队列与单次重建
                    </span>
                  )}
                </div>
                <div className="relative mt-1">
                  <Link2 className="pointer-events-none absolute left-3 top-2.5 h-[17px] w-[17px] text-[var(--accent)]" />
                  <textarea
                    rows={parsedUrlCount > 1 ? 5 : 3}
                    required
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder={
                      "单条抓取或每行一条批量抓取（内置同域名礼貌节流 + 雪球 Cookie/WAF 退避重试）：\nhttps://xueqiu.com/4600361796/351477201\nhttps://mp.weixin.qq.com/s/..."
                    }
                    className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] py-2 pl-9 pr-3 font-mono text-xs leading-5 text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                  />
                </div>
              </div>

              <div className={parsedUrlCount > 1 ? "grid gap-3 sm:grid-cols-2" : "grid gap-3 sm:grid-cols-3"}>
                {parsedUrlCount <= 1 && (
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] text-[var(--ink-muted)]">
                      自定义标题（留空自动抓取页面标题）
                    </label>
                    <input
                      value={urlTitle}
                      onChange={(e) => setUrlTitle(e.target.value)}
                      placeholder="留空自动提取"
                      className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-1.5 text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-[11px] text-[var(--ink-muted)]">
                    {parsedUrlCount > 1 ? "默认复盘日期（留空按每篇原文自动识别）" : "复盘日期（留空自动识别）"}
                  </label>
                  <input
                    type="date" onClick={(e) => { try { (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch {} }}
                    value={urlDate}
                    onChange={(e) => setUrlDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-1.5 font-mono text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                  />
                </div>
                {parsedUrlCount > 1 && (
                  <div>
                    <label className="block text-[11px] text-[var(--ink-muted)]">批量补充标签（可选）</label>
                    <input
                      value={urlTags}
                      onChange={(e) => setUrlTags(e.target.value)}
                      placeholder="例如：每日复盘, 实盘记录"
                      className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-1.5 text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                    />
                  </div>
                )}
              </div>

              {parsedUrlCount <= 1 && (
                <div>
                  <label className="block text-[11px] text-[var(--ink-muted)]">补充标签（可选）</label>
                  <input
                    value={urlTags}
                    onChange={(e) => setUrlTags(e.target.value)}
                    placeholder="例如：基本面排雷, 龙头梯队"
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-1.5 text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                  />
                </div>
              )}

              {error && (
                <div className="space-y-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-[var(--rose)]">
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
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-strong)] px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-[var(--accent)] disabled:opacity-50"
                >
                  {busy && <Loader2 className="h-[17px] w-[17px] animate-spin" />}
                  {busy
                    ? parsedUrlCount > 1
                      ? `正在防限流排队抓取 ${Math.min(parsedUrlCount, 50)} 篇...`
                      : "正在抓取正文并转 Markdown..."
                    : parsedUrlCount > 1
                      ? `批量防限流抓取入库 (${Math.min(parsedUrlCount, 50)} 条)`
                      : "立即抓取入库"}
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
                    className="inline-flex cursor-grab items-center gap-1.5 rounded-lg border border-[var(--cyan)]/60 bg-[var(--accent-soft)] px-3.5 py-2 text-xs font-semibold text-[var(--ink-strong)] active:cursor-grabbing"
                  >
                    <Bookmark className="h-[17px] w-[17px] text-[var(--cyan)]" />
                    发送到 TradeLoom（拖我到书签栏）
                  </a>

                  <button
                    type="button"
                    onClick={copyBookmarkletCode}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--ink-muted)] transition hover:border-[var(--cyan)]/50 hover:text-[var(--ink)]"
                  >
                    {copiedBookmarklet ? (
                      <>
                        <Check className="h-[17px] w-[17px] text-[var(--emerald)]" />
                        已复制脚本（可手动新建书签粘贴至网址栏）
                      </>
                    ) : (
                      <>
                        <Copy className="h-[17px] w-[17px]" />
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
                    <Cloud className="h-[17px] w-[17px]" />
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
