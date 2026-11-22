"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  BookOpen,
  Calendar,
  CandlestickChart,
  ChevronDown,
  ChevronRight,
  Cloud,
  Download,
  Edit3,
  FileText,
  Folder,
  FolderOpen,
  Hash,
  Link2,
  Network,
  PlusCircle,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CloudImportModal from "@/components/CloudImportModal";
import ConceptTaxonomyEditor from "@/components/ConceptTaxonomyEditor";
import { dispatchVaultChanged } from "@/components/CreateVaultModal";
import MarkdownView from "@/components/MarkdownView";
import ObsidianGraph from "@/components/ObsidianGraph";
import type { ParsedMarkdown } from "@/lib/markdown";
import type { LedgerDailySnapshot } from "@/lib/ledger-analytics";
import type { UnlinkedMention, VaultDoc, VaultFileItem, VaultIndex, VaultNodeType } from "@/lib/vault-builder";

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
  unlinked?: UnlinkedMention[];
  error?: string;
};

function FileNodeIcon({ type }: { type: VaultNodeType }) {
  switch (type) {
    case "timeline":
      return <Calendar className="h-3.5 w-3.5 shrink-0 text-[var(--amber)]/85" />;
    case "topic":
      return <Hash className="h-3.5 w-3.5 shrink-0 text-[var(--cyan)]/85" />;
    case "manual":
      return <BookOpen className="h-3.5 w-3.5 shrink-0 text-[var(--emerald)]/85" />;
    case "overview":
      return <Sparkles className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />;
    default:
      return <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--ink-dim)]" />;
  }
}

function HighlightSnippet({ snippet, match }: { snippet: string; match: string }) {
  const lower = snippet.toLowerCase();
  const idx = lower.indexOf(match.toLowerCase());
  if (idx < 0) return <>{snippet}</>;
  return (
    <>
      {snippet.slice(0, idx)}
      <mark className="rounded bg-[var(--amber-soft)] px-0.5 text-[var(--amber)]">
        {snippet.slice(idx, idx + match.length)}
      </mark>
      {snippet.slice(idx + match.length)}
    </>
  );
}

export default function VaultWorkspace() {
  const searchParams = useSearchParams();
  const paramCard = searchParams.get("card");
  const paramView = searchParams.get("view");
  const paramImport = searchParams.get("import");

  const [index, setIndex] = useState<VaultIndex | null>(null);
  const [hasSamples, setHasSamples] = useState(false);
  const [ledgerByDate, setLedgerByDate] = useState<Record<string, LedgerDailySnapshot>>({});
  const [ledgerColor, setLedgerColor] = useState<"cn" | "global">("cn");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [activeCard, setActiveCard] = useState<string>(paramCard || "00-总览.md");
  const [openTabs, setOpenTabs] = useState<string[]>([paramCard || "00-总览.md"]);
  const [centerMode, setCenterMode] = useState<"card" | "source" | "graph">(
    paramView === "graph" ? "graph" : "card",
  );
  const [docData, setDocData] = useState<DocResponse | null>(null);
  const [query, setQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [showUnlinked, setShowUnlinked] = useState(true);
  const [linkingKey, setLinkingKey] = useState<string | null>(null);
  const paramConcepts = searchParams.get("concepts");
  const [cloudImportOpen, setCloudImportOpen] = useState(paramImport === "cloud");
  const [conceptsOpen, setConceptsOpen] = useState(paramConcepts === "1");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (paramCard) {
      setActiveCard(paramCard);
      setOpenTabs((prev) => (prev.includes(paramCard) ? prev : [...prev.slice(-5), paramCard]));
      setCenterMode("card");
    }
  }, [paramCard]);

  useEffect(() => {
    if (paramView === "graph") {
      setCenterMode("graph");
    }
  }, [paramView]);

  useEffect(() => {
    if (paramImport === "cloud") {
      setCloudImportOpen(true);
    }
  }, [paramImport]);

  useEffect(() => {
    if (paramConcepts === "1") {
      setConceptsOpen(true);
    }
  }, [paramConcepts]);

  const loadIndex = useCallback(async () => {
    const res = await fetch("/api/vault", { cache: "no-store" });
    const data = await res.json();
    if (data.ok) {
      setIndex(data.index);
      setHasSamples(Boolean(data.hasSamples));
    }
  }, []);

  const loadDoc = useCallback(async (card: string, mode: "card" | "source") => {
    setEditing(false);
    setConfirmDelete(false);
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
    fetch("/api/ledger?mode=lite", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && d.dailyByDate) {
          setLedgerByDate(d.dailyByDate);
          if (d.settings?.colorScheme === "global") setLedgerColor("global");
        }
      })
      .catch(() => {});
  }, [loadIndex]);

  useEffect(() => {
    const modeToFetch = centerMode === "source" ? "source" : "card";
    loadDoc(activeCard, modeToFetch);
  }, [activeCard, centerMode, loadDoc]);

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
    setOpenTabs((prev) => (prev.includes(rel) ? prev : [...prev.slice(-5), rel]));
    setCenterMode("card");
  }

  function closeTab(rel: string) {
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t !== rel);
      if (next.length === 0) return ["00-总览.md"];
      if (activeCard === rel) {
        setActiveCard(next[next.length - 1]);
      }
      return next;
    });
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

  function toggleGroup(group: string) {
    setCollapsedGroups((prev) => ({ ...prev, [group]: !prev[group] }));
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
        setStatusMsg(`导入完成：成功 ${data.succeeded}/${data.total} 份，双链与未链接提及索引已更新。`);
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

  async function handleAction(action: "rebuild" | "load-samples" | "clear-samples") {
    setBusy(true);
    setStatusMsg(
      action === "load-samples"
        ? "正在载入示例复盘..."
        : action === "clear-samples"
          ? "正在清理内置示例复盘..."
          : "正在按当前主题词典重建双链索引...",
    );
    try {
      const res = await fetch("/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.ok && data.index) {
        setIndex(data.index);
        setHasSamples(Boolean(data.hasSamples));
        openCard("00-总览.md");
        await loadDoc("00-总览.md", "card");
        setStatusMsg(
          action === "load-samples"
            ? `已加载 ${data.copied} 篇示例复盘。`
            : action === "clear-samples"
              ? `已将 ${data.removed} 篇示例复盘移入回收站，不影响你的个人笔记。`
              : "双链知识库重建完成。",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteActiveDoc() {
    if (!docData?.doc) return;
    const deletingCard = docData.card;
    setBusy(true);
    setStatusMsg("正在将笔记移入本地回收站并重建双链...");
    try {
      const res = await fetch(`/api/vault/doc?card=${encodeURIComponent(deletingCard)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.ok && data.index) {
        setIndex(data.index);
        setHasSamples(Boolean(data.hasSamples));
        setConfirmDelete(false);
        const remainingTabs = openTabs.filter((t) => t !== deletingCard);
        const nextCard = remainingTabs[remainingTabs.length - 1] ?? "00-总览.md";
        setOpenTabs(remainingTabs.length > 0 ? remainingTabs : ["00-总览.md"]);
        setActiveCard(nextCard);
        await loadDoc(nextCard, "card");
        setStatusMsg(`已将《${data.title}》安全移入本地 workspace/${data.trashedTo}，双链已更新。`);
      } else {
        setStatusMsg(data.error || "删除笔记失败");
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

  async function handleConvertUnlinked(mention: UnlinkedMention) {
    const key = `${mention.source}::${mention.match}`;
    setLinkingKey(key);
    try {
      const res = await fetch("/api/vault/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceCard: mention.source,
          targetRel: activeCard,
          match: mention.match,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        if (data.index) setIndex(data.index);
        await loadDoc(activeCard, centerMode === "source" ? "source" : "card");
        setStatusMsg(
          `已将《${mention.sourceTitle}》中的「${mention.match}」转为 [[双链]]，原件已备份至 ${data.backup}`,
        );
      } else {
        setStatusMsg(data.error || "转为双链失败");
      }
    } finally {
      setLinkingKey(null);
    }
  }

  const groupedFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    const groups = new Map<string, VaultFileItem[]>();
    for (const f of index?.files ?? []) {
      if (q && !f.title.toLowerCase().includes(q) && !f.rel.toLowerCase().includes(q)) continue;
      const arr = groups.get(f.group) ?? [];
      arr.push(f);
      groups.set(f.group, arr);
    }
    return [...groups.entries()];
  }, [index, query]);

  const breadcrumbParts = activeCard.split("/");
  const unlinkedList = docData?.unlinked ?? [];

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-[var(--bg)]">
      {/* LEFT PANE: Obsidian File Explorer */}
      <aside className="flex w-[268px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] select-none">
        {/* Explorer Action Toolbar */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
            文件浏览器
          </span>
          <div className="flex items-center gap-0.5">
            <a
              href="/api/vault/export"
              title="打包导出 Obsidian 知识库与交易手册 (.zip)"
              className="rounded p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--emerald)]"
            >
              <Download className="h-3.5 w-3.5" />
            </a>
            <button
              type="button"
              onClick={() => setConceptsOpen(true)}
              title="管理本库关键词词典并重织双链（仅作用于当前知识库）"
              className="rounded p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--cyan)]"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setCenterMode((m) => (m === "graph" ? "card" : "graph"))}
              title="切换全局力导向图谱"
              className={`rounded p-1.5 transition ${
                centerMode === "graph"
                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
              }`}
            >
              <Network className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleAction("rebuild")}
              disabled={busy}
              title="重新扫描源文件并重建双链索引"
              className="rounded p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={() => setCloudImportOpen(true)}
              disabled={busy}
              title="云端采集：富文本粘贴 / 网页链接抓取 / 浏览器一键剪藏"
              className="ml-0.5 inline-flex items-center gap-1 rounded border border-[var(--cyan)]/45 bg-[var(--cyan-soft)] px-2 py-1 text-[11px] font-medium text-[var(--cyan)] transition hover:border-[var(--cyan)] hover:bg-[var(--cyan)]/20"
            >
              <Cloud className="h-3 w-3" />
              云端
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              title="导入本地文件 .md / .txt / .docx / .html / .pdf"
              className="ml-0.5 inline-flex items-center gap-1 rounded bg-[var(--accent-strong)] px-2 py-1 text-[11px] font-medium text-white transition hover:bg-[var(--accent)]"
            >
              <Upload className="h-3 w-3" />
              本地
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

        {/* Inline Explorer Filter */}
        <div className="border-b border-[var(--border)] p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-[var(--ink-dim)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="筛选卡片 / 年月 / 主题..."
              className="w-full rounded border border-[var(--border)] bg-[var(--bg-deep)] py-1 pl-7 pr-2 text-xs text-[var(--ink)] placeholder:text-[var(--ink-dim)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>

          {index && index.counts.total === 0 && (
            <button
              type="button"
              onClick={() => handleAction("load-samples")}
              disabled={busy}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded border border-[var(--accent)]/40 bg-[var(--accent-soft)] py-1.5 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/20"
            >
              <Sparkles className="h-3.5 w-3.5" />
              加载 6 篇示例复盘
            </button>
          )}
          {hasSamples && (
            <button
              type="button"
              onClick={() => handleAction("clear-samples")}
              disabled={busy}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded border border-amber-500/35 bg-amber-500/10 py-1 text-[11px] text-amber-300 transition hover:bg-amber-500/20 disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" />
              一键清理 6 篇演示样本
            </button>
          )}
        </div>

        {/* Collapsible Obsidian Folder Tree */}
        <div className="flex-1 space-y-1 overflow-y-auto px-1.5 py-2">
          {groupedFiles.map(([group, items]) => {
            const collapsed = Boolean(collapsedGroups[group]) && !query.trim();
            return (
              <div key={group}>
                <button
                  type="button"
                  onClick={() => toggleGroup(group)}
                  className="flex w-full items-center justify-between rounded px-1.5 py-1 text-left text-[11px] font-medium text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                >
                  <span className="flex items-center gap-1 truncate">
                    {collapsed ? (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--ink-dim)]" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--ink-dim)]" />
                    )}
                    {collapsed ? (
                      <Folder className="h-3.5 w-3.5 shrink-0 text-[var(--ink-dim)]" />
                    ) : (
                      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]/80" />
                    )}
                    <span className="truncate">{group}</span>
                  </span>
                  <span className="font-mono text-[10px] text-[var(--ink-dim)]">{items.length}</span>
                </button>

                {!collapsed && (
                  <div className="ml-3 mt-0.5 space-y-0.5 border-l border-[var(--border)] pl-1.5">
                    {items.map((item) => {
                      const active = item.rel === activeCard && centerMode !== "graph";
                      return (
                        <button
                          key={item.rel}
                          type="button"
                          onClick={() => openCard(item.rel)}
                          className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition ${
                            active
                              ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                              : "text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                          }`}
                        >
                          <FileNodeIcon type={item.nodeType} />
                          <span className="truncate">{item.title}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      {/* CENTER PANE: Obsidian Multi-Tab Canvas */}
      <section className="flex min-w-0 flex-1 flex-col bg-[var(--bg)]">
        {/* Note Tabs Strip */}
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)]/60 px-2 pt-1">
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
            {openTabs.map((tabRel) => {
              const active = tabRel === activeCard && centerMode !== "graph";
              return (
                <div
                  key={tabRel}
                  className={`group flex max-w-[200px] items-center gap-1.5 rounded-t border-x border-t px-2.5 py-1 text-xs transition ${
                    active
                      ? "border-[var(--border)] bg-[var(--bg)] font-medium text-[var(--ink)]"
                      : "border-transparent text-[var(--ink-dim)] hover:bg-[var(--surface-2)]/60 hover:text-[var(--ink-muted)]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => openCard(tabRel)}
                    className="truncate text-left"
                  >
                    {titleByRel.get(tabRel) || tabRel.split("/").pop()}
                  </button>
                  {openTabs.length > 1 && (
                    <button
                      type="button"
                      onClick={() => closeTab(tabRel)}
                      className="rounded p-0.5 opacity-0 hover:bg-[var(--surface-3)] group-hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => setCenterMode("graph")}
              className={`flex items-center gap-1 rounded-t border-x border-t px-2.5 py-1 text-xs transition ${
                centerMode === "graph"
                  ? "border-[var(--cyan)]/45 bg-[var(--bg)] font-medium text-[var(--cyan)] shadow-[0_-4px_14px_rgba(34,211,238,0.16)]"
                  : "border-transparent text-[var(--ink-dim)] hover:text-[var(--cyan)]"
              }`}
            >
              <Network className="h-3 w-3" />
              全息星图
            </button>
          </div>

          {/* Right Note Controls */}
          <div className="mb-1 flex shrink-0 items-center gap-1.5">
            {centerMode !== "graph" && docData?.doc && (
              <div className="inline-flex rounded border border-[var(--border)] bg-[var(--bg-deep)] p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setCenterMode("card")}
                  className={`rounded px-2 py-0.5 ${
                    centerMode === "card" ? "bg-[var(--surface-2)] font-medium text-[var(--ink)]" : "text-[var(--ink-muted)]"
                  }`}
                >
                  双链阅读
                </button>
                <button
                  type="button"
                  onClick={() => setCenterMode("source")}
                  className={`rounded px-2 py-0.5 ${
                    centerMode === "source" ? "bg-[var(--surface-2)] font-medium text-[var(--ink)]" : "text-[var(--ink-muted)]"
                  }`}
                >
                  {docData.doc.carrier === "pdf" ? "PDF 原件" : "原始笔记"}
                </button>
              </div>
            )}

            {centerMode === "source" && docData?.editable && !editing && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1 rounded border border-[var(--border-strong)] bg-[var(--surface-2)] px-2 py-1 text-[11px] text-[var(--ink)] hover:border-[var(--accent)]/60"
              >
                <Edit3 className="h-3 w-3" />
                编辑
              </button>
            )}

            {centerMode !== "graph" && docData?.doc && !editing && (
              confirmDelete ? (
                <div className="inline-flex items-center gap-1 rounded border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px]">
                  <span className="text-red-300">移入回收站？</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleDeleteActiveDoc}
                    className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-red-500"
                  >
                    确认
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="px-1 text-[10px] text-[var(--ink-muted)] hover:text-[var(--ink)]"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  title="将本篇笔记移入本地回收站 workspace/.trash/"
                  className="inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--bg-deep)] px-2 py-1 text-[11px] text-[var(--ink-muted)] transition hover:border-red-500/50 hover:text-red-300"
                >
                  <Trash2 className="h-3 w-3" />
                  回收站
                </button>
              )
            )}

            {editing && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setDraft(docData?.text ?? "");
                  }}
                  className="rounded border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--ink-muted)]"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleSaveSource}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded bg-[var(--emerald)] px-2.5 py-1 text-[11px] font-semibold text-[#0b1310]"
                >
                  <Save className="h-3 w-3" />
                  安全保存
                </button>
              </>
            )}
          </div>
        </div>

        {/* Obsidian Breadcrumb Bar */}
        {centerMode !== "graph" && (
          <div className="flex items-center justify-between border-b border-[var(--border)]/60 px-6 py-1.5 text-[11px] text-[var(--ink-dim)]">
            <div className="flex items-center gap-1 truncate font-mono">
              {breadcrumbParts.map((part, idx) => (
                <span key={idx} className="flex items-center gap-1 truncate">
                  {idx > 0 && <span>/</span>}
                  <span className={idx === breadcrumbParts.length - 1 ? "text-[var(--ink-muted)]" : ""}>
                    {part}
                  </span>
                </span>
              ))}
            </div>
            {docData?.doc?.event_date && (
              <span className="shrink-0 font-mono text-[var(--amber)]">{docData.doc.event_date}</span>
            )}
          </div>
        )}

        {statusMsg && (
          <div className="border-b border-[var(--border)] bg-[var(--accent-soft)]/50 px-6 py-1.5 text-xs text-[var(--accent)]">
            {statusMsg}
          </div>
        )}

        {/* Main Center Content */}
        {centerMode === "graph" ? (
          <div className="min-h-0 flex-1">
            <ObsidianGraph
              index={index}
              activeRel={activeCard}
              mode="global"
              onSelectNode={(rel) => openCard(rel)}
              onToggleExpand={() => setCenterMode("card")}
            />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-6 sm:px-10">
            <div className="mx-auto max-w-[820px]">
              {centerMode === "source" && docData?.carrier === "pdf" && docData.fileUrl ? (
                <embed
                  src={docData.fileUrl}
                  type="application/pdf"
                  className="h-[75vh] w-full rounded-lg border border-[var(--border)]"
                />
              ) : editing ? (
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="h-[72vh] w-full resize-none rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] p-4 font-mono text-xs leading-6 text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                />
              ) : docData?.parsed ? (
                <>
                  {docData.doc?.event_date && ledgerByDate[docData.doc.event_date] && (() => {
                    const snap = ledgerByDate[docData.doc.event_date!];
                    const upCls = ledgerColor === "cn" ? "text-red-400" : "text-emerald-400";
                    const downCls = ledgerColor === "cn" ? "text-emerald-400" : "text-red-400";
                    return (
                      <div className="mb-5 rounded-xl border border-[var(--cyan)]/35 bg-[#090f1d]/95 p-3.5 text-xs shadow-[0_0_20px_rgba(34,211,238,0.08)]">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 font-mono">
                            <span className="inline-flex items-center gap-1.5 font-sans font-semibold text-[var(--cyan)]">
                              <CandlestickChart className="h-3.5 w-3.5" />
                              客观实盘锚点 · {snap.date}
                            </span>
                            {(snap.nav !== 1 || snap.dailyReturnPct !== 0) && (
                              <>
                                <span>
                                  当日{" "}
                                  <strong className={snap.dailyReturnPct >= 0 ? upCls : downCls}>
                                    {snap.dailyReturnPct >= 0 ? "+" : ""}
                                    {snap.dailyReturnPct.toFixed(2)}%
                                  </strong>
                                </span>
                                <span className="text-[var(--ink-muted)]">净值 {snap.nav.toFixed(4)}</span>
                                <span className="text-red-300/80">回撤 {snap.drawdownPct.toFixed(2)}%</span>
                              </>
                            )}
                            {snap.positionPct !== undefined && (
                              <span className={snap.positionPct > 100 ? "font-semibold text-amber-300" : "text-[var(--ink-muted)]"}>
                                仓位 {snap.positionPct}%{snap.positionPct > 100 ? " (含融)" : ""}
                              </span>
                            )}
                            {snap.excessDailyPct !== undefined && (
                              <span className={snap.excessDailyPct >= 0 ? "text-[var(--cyan)]" : "text-amber-400"}>
                                超额 {snap.excessDailyPct >= 0 ? "+" : ""}
                                {snap.excessDailyPct.toFixed(2)}%
                              </span>
                            )}
                          </div>
                          <Link href="/ledger" className="text-[11px] text-[var(--cyan)] hover:underline">
                            打开实盘账本 →
                          </Link>
                        </div>
                        {snap.trades.length > 0 && (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] pt-2">
                            <span className="text-[10px] text-[var(--ink-dim)]">当日交割：</span>
                            {snap.trades.map((tr, ti) => (
                              <Link
                                key={ti}
                                href={`/ledger?symbol=${encodeURIComponent(tr.symbol)}`}
                                title="点击查看该股真实 K 线买卖节点"
                                className="inline-flex items-center gap-1 rounded border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-0.5 font-mono text-[10px] text-[var(--ink)] transition hover:border-[var(--cyan)]/60"
                              >
                                <span className={tr.side === "BUY" ? "font-bold text-rose-400" : "font-bold text-sky-400"}>
                                  {tr.side === "BUY" ? "B" : "S"}
                                </span>
                                <span className="font-sans">{tr.name}</span>
                                <span className="text-[var(--ink-muted)]">¥{tr.price.toFixed(2)}</span>
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  <MarkdownView
                    parsed={docData.parsed}
                  onWikiClick={handleWikiClick}
                    onTagClick={handleTagClick}
                  />
                </>
              ) : (
                <div className="py-16 text-center text-xs text-[var(--ink-dim)]">正在读取双链笔记...</div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* RIGHT PANE: Force-Directed Local Graph + Backlinks + Unlinked Mentions + Outgoing */}
      <aside className="hidden w-[312px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface)] xl:flex">
        {/* Local Physics Graph */}
        <div className="h-[252px] shrink-0 border-b border-[var(--border)]">
          <ObsidianGraph
            index={index}
            activeRel={activeCard}
            mode="local"
            onSelectNode={(rel) => openCard(rel)}
            onToggleExpand={() => setCenterMode("graph")}
          />
        </div>

        {/* Scrollable Inspector */}
        <div className="flex-1 divide-y divide-[var(--border)] overflow-y-auto">
          {/* 1. Backlinks (Linked Mentions) */}
          <div className="p-3.5">
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
              <span className="flex items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5 text-[var(--emerald)]" />
                反向链接 · Backlinks
              </span>
              <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.2 font-mono text-[10px] text-[var(--emerald)]">
                {docData?.links.in.length ?? 0}
              </span>
            </div>

            <div className="mt-2 space-y-1">
              {(docData?.links.in ?? []).length === 0 ? (
                <div className="text-xs text-[var(--ink-dim)]">暂无其他卡片指向当前笔记</div>
              ) : (
                docData!.links.in.map((src) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => openCard(src)}
                    className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-[var(--ink-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--emerald)]"
                  >
                    <span className="text-[var(--emerald)]">←</span>
                    <span className="truncate">{titleByRel.get(src) || src}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* 2. Native Obsidian Unlinked Mentions */}
          <div className="p-3.5">
            <button
              type="button"
              onClick={() => setShowUnlinked((s) => !s)}
              className="flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]"
            >
              <span className="flex items-center gap-1.5">
                {showUnlinked ? (
                  <ChevronDown className="h-3.5 w-3.5 text-[var(--amber)]" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-[var(--amber)]" />
                )}
                未链接提及 · Unlinked
              </span>
              <span className="rounded bg-[var(--amber-soft)] px-1.5 py-0.2 font-mono text-[10px] text-[var(--amber)]">
                {unlinkedList.length}
              </span>
            </button>

            {showUnlinked && (
              <div className="mt-2 space-y-2">
                {unlinkedList.length === 0 ? (
                  <div className="text-xs text-[var(--ink-dim)]">暂无待连接的潜在提及</div>
                ) : (
                  unlinkedList.map((m) => {
                    const key = `${m.source}::${m.match}`;
                    const isLinking = linkingKey === key;
                    return (
                      <div
                        key={key}
                        className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] p-2 text-xs"
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <button
                            type="button"
                            onClick={() => openCard(m.source)}
                            className="truncate font-medium text-[var(--ink)] hover:text-[var(--accent)]"
                          >
                            {m.sourceTitle}
                          </button>
                          <button
                            type="button"
                            disabled={isLinking}
                            onClick={() => handleConvertUnlinked(m)}
                            title={`在《${m.sourceTitle}》中将「${m.match}」一键转为 Obsidian [[双链]]`}
                            className="inline-flex shrink-0 items-center gap-1 rounded border border-[var(--amber)]/40 bg-[var(--amber-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--amber)] transition hover:bg-[var(--amber)]/25 disabled:opacity-50"
                          >
                            <PlusCircle className="h-3 w-3" />
                            {isLinking ? "链接中..." : "转为双链"}
                          </button>
                        </div>
                        <p className="mt-1 text-[11px] leading-5 text-[var(--ink-muted)]">
                          <HighlightSnippet snippet={m.snippet} match={m.match} />
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* 3. Outgoing Links */}
          <div className="p-3.5">
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
              <span className="flex items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5 text-[var(--accent)]" />
                正向链接 · Outgoing
              </span>
              <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.2 font-mono text-[10px] text-[var(--accent)]">
                {docData?.links.out.length ?? 0}
              </span>
            </div>

            <div className="mt-2 space-y-1">
              {(docData?.links.out ?? []).length === 0 ? (
                <div className="text-xs text-[var(--ink-dim)]">暂无出链</div>
              ) : (
                docData!.links.out.map((target) => (
                  <button
                    key={target}
                    type="button"
                    onClick={() => openCard(target)}
                    className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-[var(--accent)] transition hover:bg-[var(--accent-soft)]"
                  >
                    <span className="opacity-70">→</span>
                    <span className="truncate">{titleByRel.get(target) || target}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* 4. Auto-extracted Concepts & Meta */}
          {docData?.doc && (
            <div className="space-y-2 p-3.5 text-xs text-[var(--ink-muted)]">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-dim)]">
                  词典识别主题 & 元信息
                </span>
                <Link href="/settings?tab=concepts" className="text-[10px] text-[var(--cyan)] hover:underline">
                  编辑词典
                </Link>
              </div>
              {docData.doc.auto_concepts?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {docData.doc.auto_concepts.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => handleTagClick(c)}
                      className="rounded-full border border-[var(--cyan)]/30 bg-[var(--cyan-soft)] px-2 py-0.5 text-[10px] text-[var(--cyan)] hover:border-[var(--cyan)]"
                    >
                      #{c}
                    </button>
                  ))}
                </div>
              )}
              <div className="space-y-1 pt-1 text-[11px] text-[var(--ink-dim)]">
                <div>
                  类型：{docData.doc.kind} · {docData.doc.carrier.toUpperCase()}
                </div>
                <div className="truncate font-mono">源文件：{docData.doc.source_rel}</div>
                <div className="font-mono">SHA256：{docData.doc.sha256.slice(0, 12)}</div>
              </div>
            </div>
          )}
        </div>
      </aside>

      <CloudImportModal
        open={cloudImportOpen}
        onClose={() => {
          setCloudImportOpen(false);
          if (typeof window !== "undefined" && window.location.search.includes("import=cloud")) {
            const url = new URL(window.location.href);
            url.searchParams.delete("import");
            window.history.replaceState(null, "", url.pathname + url.search);
          }
        }}
        onImported={(nextIndex, cardRel, message) => {
          setIndex(nextIndex);
          setStatusMsg(message);
          dispatchVaultChanged();
          if (cardRel) openCard(cardRel);
        }}
      />

      {conceptsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#04060c]/80 p-4 backdrop-blur-sm"
          onClick={() => {
            setConceptsOpen(false);
            loadIndex();
            dispatchVaultChanged();
          }}
        >
          <div
            className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[#0f1422] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-deep)] px-5 py-3">
              <div>
                <h3 className="text-sm font-semibold text-[#f8fafc]">本库核心关键词词典（仅作用于当前知识库）</h3>
                <p className="text-[11px] text-[var(--ink-dim)]">
                  决定哪些交易术语会被自动提取为主题节点与双链连线；不同知识库拥有各自独立的词典。
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setConceptsOpen(false);
                  loadIndex();
                  dispatchVaultChanged();
                }}
                className="rounded-lg p-1.5 text-[var(--ink-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-5">
              <ConceptTaxonomyEditor />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
