"use client";

import { useSearchParams } from "next/navigation";
import { Edit3, FileText, FolderOpen, Link2, RefreshCw, Save, Search, Sparkles, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MarkdownView from "@/components/MarkdownView";
import type { ParsedMarkdown } from "@/lib/markdown";
import type { VaultDoc, VaultIndex } from "@/lib/vault-builder";

type DocResponse = {
  ok: boolean;
  mode: "card" | "source";
  card: string;
  doc: VaultDoc | null;
  carrier: string;
  editable: boolean;
  text: string | null;
  parsed: ParsedMarkdown | null;
  sha256: string;
  fileUrl?: string;
  links: { out: string[]; in: string[] };
  error?: string;
};

export default function VaultWorkspace() {
  const searchParams = useSearchParams();
  const initialCard = searchParams.get("card") || "00-总览.md";

  const [index, setIndex] = useState<VaultIndex | null>(null);
  const [activeCard, setActiveCard] = useState<string>(initialCard);
  const [viewMode, setViewMode] = useState<"card" | "source">("card");
  const [docData, setDocData] = useState<DocResponse | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadIndex = useCallback(async () => {
    const res = await fetch("/api/vault", { cache: "no-store" });
    const data = await res.json();
    if (data.ok) setIndex(data.index);
  }, []);

  const loadDoc = useCallback(async (card: string, mode: "card" | "source") => {
    setEditing(false);
    setStatusMsg("");
    const res = await fetch(`/api/vault/doc?card=${encodeURIComponent(card)}&mode=${mode}`, { cache: "no-store" });
    const data = (await res.json()) as DocResponse;
    if (data.ok) {
      setDocData(data);
      setDraft(data.text ?? "");
    } else {
      setStatusMsg(data.error || "加载卡片失败");
    }
  }, []);

  useEffect(() => {
    loadIndex();
  }, [loadIndex]);

  useEffect(() => {
    loadDoc(activeCard, viewMode);
  }, [activeCard, viewMode, loadDoc]);

  const titleByRel = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of index?.files ?? []) map.set(f.rel, f.title);
    return map;
  }, [index]);

  const resolveWikiTarget = useCallback(
    (target: string): string | null => {
      if (!index) return null;
      const clean = target.trim();
      for (const f of index.files) {
        if (f.rel === clean || f.rel === `${clean}.md` || f.rel.replace(/\.md$/, "") === clean) return f.rel;
      }
      const tail = clean.replace(/\.md$/, "").split("/").pop() ?? clean;
      for (const f of index.files) {
        if (f.rel.replace(/\.md$/, "").split("/").pop() === tail) return f.rel;
      }
      return null;
    },
    [index],
  );

  function openCard(rel: string) {
    setActiveCard(rel);
    setViewMode("card");
  }

  function handleWikiClick(target: string) {
    const resolved = resolveWikiTarget(target);
    if (resolved) openCard(resolved);
    else setStatusMsg(`未在当前知识库找到双链目标：[[${target}]]`);
  }

  function handleTagClick(tag: string) {
    const target = `30-主题/${tag}.md`;
    if (index?.files.some((f) => f.rel === target)) {
      openCard(target);
    } else {
      setQuery(tag);
    }
  }

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setStatusMsg("正在导入并重建 Obsidian 双链知识库...");
    try {
      const form = new FormData();
      for (const f of Array.from(files)) form.append("file", f);
      const res = await fetch("/api/vault/import", { method: "POST", body: form });
      const data = await res.json();
      if (data.ok && data.index) {
        setIndex(data.index);
        setStatusMsg(`导入完成：成功 ${data.succeeded}/${data.total} 份，双链索引已更新。`);
        const firstDoc = data.index.documents?.[0];
        if (firstDoc) openCard(firstDoc.card);
      } else {
        setStatusMsg(data.error || data.results?.[0]?.error || "导入失败");
      }
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleAction(action: "rebuild" | "load-samples") {
    setBusy(true);
    setStatusMsg(action === "load-samples" ? "正在载入示例复盘..." : "正在重建 Obsidian 双链索引...");
    try {
      const res = await fetch("/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.ok && data.index) {
        setIndex(data.index);
        await loadDoc("00-总览.md", "card");
        setActiveCard("00-总览.md");
        setViewMode("card");
        setStatusMsg(action === "load-samples" ? `已加载 ${data.copied} 篇示例复盘。` : "双链知识库重建完成。");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSource() {
    if (!docData) return;
    setBusy(true);
    setStatusMsg("正在安全备份并原子写入...");
    try {
      const res = await fetch("/api/vault/doc", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card: docData.card, text: draft, sha256: docData.sha256 }),
      });
      const data = await res.json();
      if (data.ok) {
        if (data.index) setIndex(data.index);
        setEditing(false);
        await loadDoc(docData.card, "source");
        setStatusMsg(`保存成功，已自动备份旧版本至 ${data.backup}`);
      } else {
        setStatusMsg(data.error || "保存失败");
      }
    } finally {
      setBusy(false);
    }
  }

  const groupedFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    const groups = new Map<string, { rel: string; title: string }[]>();
    for (const f of index?.files ?? []) {
      if (q && !f.title.toLowerCase().includes(q) && !f.rel.toLowerCase().includes(q)) continue;
      const arr = groups.get(f.group) ?? [];
      arr.push({ rel: f.rel, title: f.title });
      groups.set(f.group, arr);
    }
    return [...groups.entries()];
  }, [index, query]);

  return (
    <div className="grid gap-4 lg:grid-cols-[290px_minmax(0,1fr)_270px]">
      {/* Left Sidebar: Import + Tree */}
      <aside className="flex max-h-[calc(100vh-110px)] flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="space-y-2.5 border-b border-[var(--border)] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[var(--ink)]">Obsidian 复盘库</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleAction("rebuild")}
                disabled={busy}
                title="扫描源文件并重建双链索引"
                className="rounded-md border border-[var(--border)] p-1.5 text-[var(--ink-muted)] hover:border-[var(--accent)]/50 hover:text-[var(--ink)]"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-semibold text-[#111] hover:opacity-90"
              >
                <Upload className="h-3.5 w-3.5" />
                导入笔记
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".md,.markdown,.txt,.docx,.html,.htm,.pdf"
                className="hidden"
                onChange={(e) => handleUpload(e.target.files)}
              />
            </div>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--ink-dim)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索卡片 / 日期 / 主题..."
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] py-1.5 pl-8 pr-2.5 text-xs text-[var(--ink)] placeholder:text-[var(--ink-dim)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>

          {index && index.counts.total === 0 && (
            <button
              type="button"
              onClick={() => handleAction("load-samples")}
              disabled={busy}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent-soft)] py-1.5 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/20"
            >
              <Sparkles className="h-3.5 w-3.5" />
              加载 6 篇示例复盘
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2.5 space-y-3">
          {groupedFiles.map(([group, items]) => (
            <div key={group}>
              <div className="mb-1 flex items-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-dim)]">
                <FolderOpen className="h-3 w-3" />
                {group} ({items.length})
              </div>
              <div className="space-y-0.5">
                {items.map((item) => {
                  const active = item.rel === activeCard;
                  return (
                    <button
                      key={item.rel}
                      type="button"
                      onClick={() => openCard(item.rel)}
                      className={`flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                        active
                          ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                          : "text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                      }`}
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" />
                      <span className="truncate">{item.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* Center Pane: Card / Original Reader & Editor */}
      <section className="flex min-h-[70vh] flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-5 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-[var(--ink)]">
              {titleByRel.get(activeCard) || activeCard}
            </div>
            <div className="truncate font-mono text-[11px] text-[var(--ink-dim)]">{activeCard}</div>
          </div>

          <div className="flex items-center gap-1.5">
            {docData?.doc && (
              <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setViewMode("card")}
                  className={`rounded-md px-2.5 py-1 ${
                    viewMode === "card" ? "bg-[var(--surface-2)] font-medium text-[var(--ink)]" : "text-[var(--ink-muted)]"
                  }`}
                >
                  双链卡片
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("source")}
                  className={`rounded-md px-2.5 py-1 ${
                    viewMode === "source" ? "bg-[var(--surface-2)] font-medium text-[var(--ink)]" : "text-[var(--ink-muted)]"
                  }`}
                >
                  {docData.doc.carrier === "pdf" ? "查看 PDF 原件" : "查看原文"}
                </button>
              </div>
            )}

            {viewMode === "source" && docData?.editable && !editing && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] px-2.5 py-1.5 text-xs text-[var(--ink)] hover:border-[var(--accent)]/60"
              >
                <Edit3 className="h-3.5 w-3.5" />
                编辑原文
              </button>
            )}

            {editing && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setDraft(docData?.text ?? "");
                  }}
                  className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--ink-muted)]"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleSaveSource}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-lg bg-[var(--emerald)] px-3 py-1.5 text-xs font-semibold text-[#0b1310]"
                >
                  <Save className="h-3.5 w-3.5" />
                  安全保存
                </button>
              </>
            )}
          </div>
        </div>

        {statusMsg && (
          <div className="border-b border-[var(--border)] bg-[var(--surface-2)]/70 px-5 py-2 text-xs text-[var(--accent)]">
            {statusMsg}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          {viewMode === "source" && docData?.carrier === "pdf" && docData.fileUrl ? (
            <embed
              src={docData.fileUrl}
              type="application/pdf"
              className="h-[72vh] w-full rounded-lg border border-[var(--border)]"
            />
          ) : editing ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="h-[65vh] w-full resize-none rounded-lg border border-[var(--border-strong)] bg-[var(--bg)] p-4 font-mono text-xs leading-6 text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
            />
          ) : docData?.parsed ? (
            <MarkdownView
              parsed={docData.parsed}
              onWikiClick={handleWikiClick}
              onTagClick={handleTagClick}
            />
          ) : (
            <div className="py-12 text-center text-sm text-[var(--ink-muted)]">正在读取知识库卡片...</div>
          )}
        </div>
      </section>

      {/* Right Sidebar: Bi-directional Links */}
      <aside className="space-y-4">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink)]">
            <Link2 className="h-3.5 w-3.5 text-[var(--accent)]" />
            正向链接（出链 · {docData?.links.out.length ?? 0}）
          </div>
          <div className="mt-2.5 space-y-1">
            {(docData?.links.out ?? []).length === 0 ? (
              <div className="text-xs text-[var(--ink-dim)]">暂无出链</div>
            ) : (
              docData!.links.out.map((target) => (
                <button
                  key={target}
                  type="button"
                  onClick={() => openCard(target)}
                  className="block w-full truncate rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-left text-xs text-[var(--accent)] hover:border-[var(--accent)]/60"
                >
                  [[{titleByRel.get(target) || target}]]
                </button>
              ))
            )}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink)]">
            <Link2 className="h-3.5 w-3.5 text-[var(--emerald)]" />
            反向链接（入链 · {docData?.links.in.length ?? 0}）
          </div>
          <div className="mt-2.5 space-y-1">
            {(docData?.links.in ?? []).length === 0 ? (
              <div className="text-xs text-[var(--ink-dim)]">暂无其他卡片指向此处</div>
            ) : (
              docData!.links.in.map((src) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => openCard(src)}
                  className="block w-full truncate rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-left text-xs text-[var(--emerald)] hover:border-[var(--emerald)]/60"
                >
                  ← {titleByRel.get(src) || src}
                </button>
              ))
            )}
          </div>
        </div>

        {docData?.doc && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-xs space-y-1.5 text-[var(--ink-muted)]">
            <div className="font-semibold text-[var(--ink)]">文档元信息</div>
            <div>日期：{docData.doc.event_date || "未标日期"}</div>
            <div>分类：{docData.doc.kind}</div>
            <div>载体：{docData.doc.carrier.toUpperCase()}</div>
            <div className="truncate">源文件：{docData.doc.source_rel}</div>
            <div className="font-mono text-[11px] text-[var(--ink-dim)]">
              SHA256: {docData.doc.sha256.slice(0, 12)}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
