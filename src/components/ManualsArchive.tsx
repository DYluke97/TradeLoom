"use client";

import Link from "next/link";
import { BookOpen, ChevronDown, ChevronRight, FileStack, Layers, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import ReportView from "@/components/ReportView";
import type { SynthesisReport } from "@/lib/synthesis";

type ViewFilter = "tree" | "l2" | "l1";

function isL2Synthesis(m: SynthesisReport): boolean {
  return m.source_mode === "manuals" || m.source_mode === "mixed";
}

function formatShortRange(m: SynthesisReport): string {
  const from = m.date_range?.from?.slice(0, 7);
  const to = m.date_range?.to?.slice(0, 7);
  if (from && to) return from === to ? from : `${from} ~ ${to}`;
  return m.created_at.slice(0, 10);
}

export default function ManualsArchive() {
  const [manuals, setManuals] = useState<SynthesisReport[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewFilter, setViewFilter] = useState<ViewFilter>("tree");
  const [collapsedL2, setCollapsedL2] = useState<Record<string, boolean>>({});

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/manuals", { cache: "no-store" });
      const data = await res.json();
      if (data.ok) {
        const list = (data.manuals ?? []) as SynthesisReport[];
        setManuals(list);
        if (list.length > 0 && !activeId) {
          const firstL2 = list.find(isL2Synthesis);
          setActiveId((firstL2 ?? list[0]).id);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDelete(id: string) {
    await fetch(`/api/manuals?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setManuals((prev) => {
      const next = prev.filter((m) => m.id !== id);
      if (activeId === id) setActiveId(next[0]?.id ?? null);
      return next;
    });
  }

  const hierarchy = useMemo(() => {
    const l2List = manuals.filter(isL2Synthesis);
    const l1List = manuals.filter((m) => !isL2Synthesis(m));
    const l1Map = new Map<string, SynthesisReport>(l1List.map((m) => [m.id, m]));
    const attachedL1Ids = new Set<string>();

    const l2Groups = l2List.map((parent) => {
      const children: SynthesisReport[] = [];
      for (const src of parent.source_docs ?? []) {
        const child = l1Map.get(src.doc_id);
        if (child) {
          children.push(child);
          attachedL1Ids.add(child.id);
        }
      }
      // Sort child stage manuals chronologically so evolution reads top-to-bottom
      children.sort((a, b) => (a.date_range?.from ?? a.created_at).localeCompare(b.date_range?.from ?? b.created_at));
      return { parent, children };
    });

    const standaloneL1 = l1List.filter((m) => !attachedL1Ids.has(m.id));
    return { l2List, l1List, l2Groups, standaloneL1 };
  }, [manuals]);

  const active = manuals.find((m) => m.id === activeId) ?? null;

  function toggleL2Group(id: string) {
    setCollapsedL2((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  if (loading) {
    return <div className="py-12 text-center text-sm text-[var(--ink-muted)]">正在加载交易手册归档...</div>;
  }

  if (manuals.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] p-12 text-center">
        <BookOpen className="mx-auto h-8 w-8 text-[var(--accent)] opacity-85" />
        <h2 className="mt-3 text-base font-semibold text-[var(--ink-strong)]">尚未沉淀任何个人交易手册</h2>
        <p className="mt-1.5 text-xs text-[var(--ink-muted)]">
          前往「阶段提炼」勾选一段时期的复盘样本，选择短线或基本面 Skill 生成你的第一份可回溯交易手册。
          生成后也会自动写入 Obsidian 知识库的 <code>40-交易手册/</code> 目录。
        </p>
        <Link
          href="/synthesize"
          className="mt-4 inline-flex items-center rounded-lg bg-[var(--accent-strong)] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[var(--accent)]"
        >
          前往阶段提炼
        </Link>
      </div>
    );
  }

  function renderL1Item(m: SynthesisReport, nested: boolean) {
    const isActive = m.id === active?.id;
    return (
      <div
        key={m.id}
        className={`group flex items-start justify-between gap-2 rounded-lg border transition ${
          nested ? "px-2.5 py-2" : "p-2.5"
        } ${
          isActive
            ? "border-[var(--accent)] bg-[var(--accent-soft)]/70"
            : "border-[var(--border)] bg-[var(--bg-deep)] hover:border-[var(--border-strong)]"
        }`}
      >
        <button type="button" onClick={() => setActiveId(m.id)} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 rounded bg-[var(--surface-2)] px-1.5 py-0.2 font-mono text-[10px] text-[var(--amber)]">
              L1 阶段
            </span>
            <span className="truncate text-[10px] font-mono text-[var(--ink-dim)]">{formatShortRange(m)}</span>
          </div>
          <div className="mt-1 truncate text-xs font-medium text-[var(--ink)]" title={m.title}>
            {m.title}
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--ink-dim)]">
            {m.statistics.rules_count} 条规则 · {m.statistics.timeline_count} 节点 · {m.statistics.docs_count} 篇样本
          </div>
        </button>
        <button
          type="button"
          onClick={() => handleDelete(m.id)}
          title="删除该手册"
          className="rounded p-1 text-[var(--ink-dim)] opacity-0 hover:text-[var(--rose)] group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[330px_minmax(0,1fr)]">
      <aside className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="text-xs font-semibold text-[var(--ink-strong)]">已沉淀手册（{manuals.length}）</div>
          <span className="font-mono text-[10px] text-[var(--ink-dim)]">
            L2:{hierarchy.l2List.length} / L1:{hierarchy.l1List.length}
          </span>
        </div>

        {/* Tier View Filter */}
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] p-1 text-[11px]">
          <button
            type="button"
            onClick={() => setViewFilter("tree")}
            className={`rounded-md px-2 py-1 font-medium transition ${
              viewFilter === "tree"
                ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            二层树状
          </button>
          <button
            type="button"
            onClick={() => setViewFilter("l2")}
            className={`rounded-md px-2 py-1 font-medium transition ${
              viewFilter === "l2"
                ? "bg-[var(--cyan-soft)] text-[var(--cyan)]"
                : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            二次综合 ({hierarchy.l2List.length})
          </button>
          <button
            type="button"
            onClick={() => setViewFilter("l1")}
            className={`rounded-md px-2 py-1 font-medium transition ${
              viewFilter === "l1"
                ? "bg-[var(--amber-soft)] text-[var(--amber)]"
                : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            一次沉淀 ({hierarchy.l1List.length})
          </button>
        </div>

        {/* Tree View (Default Two-Tier Structure) */}
        {viewFilter === "tree" && (
          <div className="space-y-4">
            {/* Tier 2: Map-Reduce Master Playbooks with nested L1 children */}
            {hierarchy.l2Groups.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--cyan)]">
                  <Layers className="h-3.5 w-3.5" />
                  <span>第二层 · 二次综合总纲（Map-Reduce）</span>
                </div>
                <div className="space-y-2.5">
                  {hierarchy.l2Groups.map(({ parent, children }) => {
                    const isActive = parent.id === active?.id;
                    const isCollapsed = Boolean(collapsedL2[parent.id]);
                    return (
                      <div key={parent.id} className="space-y-1.5">
                        <div
                          className={`group rounded-lg border p-2.5 transition ${
                            isActive
                              ? "border-[var(--cyan)] bg-[var(--cyan-soft)]/50"
                              : "border-[var(--cyan)]/35 bg-[var(--bg-deep)] hover:border-[var(--cyan)]/70"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-1.5">
                            <button
                              type="button"
                              onClick={() => setActiveId(parent.id)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="inline-flex items-center gap-1 rounded bg-[var(--cyan-soft)] px-1.5 py-0.2 text-[10px] font-semibold text-[var(--cyan)]">
                                  <Sparkles className="h-2.5 w-2.5" />
                                  L2 总纲
                                </span>
                                <span className="font-mono text-[10px] text-[var(--ink-muted)]">
                                  {formatShortRange(parent)}
                                </span>
                              </div>
                              <div className="mt-1.5 line-clamp-2 text-xs font-semibold leading-4.5 text-[var(--ink-strong)]" title={parent.title}>
                                {parent.title}
                              </div>
                              <div className="mt-1 text-[11px] text-[var(--ink-dim)]">
                                {parent.statistics.rules_count} 条规则 · {parent.statistics.timeline_count} 节点 · 综合 {children.length || parent.statistics.docs_count} 份阶段手册
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(parent.id)}
                              title="删除该总纲"
                              className="rounded p-1 text-[var(--ink-dim)] opacity-0 hover:text-[var(--rose)] group-hover:opacity-100"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          {children.length > 0 && (
                            <button
                              type="button"
                              onClick={() => toggleL2Group(parent.id)}
                              className="mt-2 flex w-full items-center justify-between rounded-md border border-[var(--border)] bg-[var(--surface)]/80 px-2 py-1 text-[11px] text-[var(--ink-muted)] transition hover:border-[var(--cyan)]/50 hover:text-[var(--cyan)]"
                            >
                              <span className="inline-flex items-center gap-1">
                                {isCollapsed ? (
                                  <ChevronRight className="h-3.5 w-3.5" />
                                ) : (
                                  <ChevronDown className="h-3.5 w-3.5 text-[var(--cyan)]" />
                                )}
                                <span>所含一次沉淀阶段手册（{children.length}）</span>
                              </span>
                              <span className="text-[10px] text-[var(--ink-dim)]">
                                {isCollapsed ? "展开" : "收起"}
                              </span>
                            </button>
                          )}
                        </div>

                        {/* Nested Tier 1 child stage manuals */}
                        {children.length > 0 && !isCollapsed && (
                          <div className="ml-3 space-y-1.5 border-l-2 border-[var(--cyan)]/30 pl-2.5">
                            {children.map((child) => renderL1Item(child, true))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tier 1: Standalone / Unmerged Stage Manuals */}
            {hierarchy.standaloneL1.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1 text-[11px] font-semibold text-[var(--amber)]">
                  <span className="inline-flex items-center gap-1.5">
                    <FileStack className="h-3.5 w-3.5" />
                    <span>
                      {hierarchy.l2Groups.length > 0
                        ? `独立一次沉淀（未归并，${hierarchy.standaloneL1.length}）`
                        : `第一层 · 一次阶段沉淀（${hierarchy.standaloneL1.length}）`}
                    </span>
                  </span>
                </div>
                <div className="space-y-1.5">
                  {hierarchy.standaloneL1.map((m) => renderL1Item(m, false))}
                </div>
              </div>
            )}

            {hierarchy.l2Groups.length === 0 && hierarchy.l1List.length >= 2 && (
              <Link
                href="/synthesize"
                className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--cyan)]/45 bg-[var(--cyan-soft)]/25 px-3 py-2 text-[11px] text-[var(--cyan)] transition hover:bg-[var(--cyan-soft)]/45"
              >
                <Layers className="h-3.5 w-3.5" />
                去将这 {hierarchy.l1List.length} 份阶段手册二次综合为总纲 →
              </Link>
            )}
          </div>
        )}

        {/* L2 Only Filter */}
        {viewFilter === "l2" && (
          <div className="space-y-1.5">
            {hierarchy.l2List.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--border)] p-4 text-center text-xs text-[var(--ink-muted)]">
                暂无二次综合总纲。前往「阶段提炼 → 阶段手册二次综合」即可生成。
              </div>
            ) : (
              hierarchy.l2List.map((parent) => {
                const isActive = parent.id === active?.id;
                return (
                  <div
                    key={parent.id}
                    className={`group flex items-start justify-between gap-2 rounded-lg border p-2.5 transition ${
                      isActive
                        ? "border-[var(--cyan)] bg-[var(--cyan-soft)]/50"
                        : "border-[var(--border)] bg-[var(--bg-deep)] hover:border-[var(--cyan)]/60"
                    }`}
                  >
                    <button type="button" onClick={() => setActiveId(parent.id)} className="min-w-0 flex-1 text-left">
                      <div className="flex items-center gap-1.5">
                        <span className="rounded bg-[var(--cyan-soft)] px-1.5 py-0.2 text-[10px] font-semibold text-[var(--cyan)]">
                          L2 总纲
                        </span>
                        <span className="font-mono text-[10px] text-[var(--ink-dim)]">{formatShortRange(parent)}</span>
                      </div>
                      <div className="mt-1 truncate text-xs font-semibold text-[var(--ink-strong)]">{parent.title}</div>
                      <div className="mt-0.5 text-[11px] text-[var(--ink-dim)]">
                        {parent.statistics.rules_count} 条规则 · {parent.statistics.timeline_count} 节点
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(parent.id)}
                      title="删除该总纲"
                      className="rounded p-1 text-[var(--ink-dim)] opacity-0 hover:text-[var(--rose)] group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* L1 Only Filter */}
        {viewFilter === "l1" && (
          <div className="space-y-1.5">
            {hierarchy.l1List.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--border)] p-4 text-center text-xs text-[var(--ink-muted)]">
                暂无一次阶段沉淀手册。
              </div>
            ) : (
              hierarchy.l1List.map((m) => renderL1Item(m, false))
            )}
          </div>
        )}
      </aside>

      <div>{active && <ReportView report={active} />}</div>
    </div>
  );
}