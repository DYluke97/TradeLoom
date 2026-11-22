"use client";

import Link from "next/link";
import { BookMarked, Calendar, CheckSquare, Cpu, Layers, Loader2, Play, ShieldCheck, Square, StopCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReportView from "@/components/ReportView";
import type { MaskedProviderStatus } from "@/lib/provider";
import type { SkillSpec } from "@/lib/skills";
import type { PeriodQuantBrief } from "@/lib/ledger-analytics";
import type { PrecheckSnapshot, SynthesisReport } from "@/lib/synthesis";
import type { VaultDoc, VaultIndex } from "@/lib/vault-builder";

type SourceTab = "docs" | "manuals";

export default function SynthesizeWorkspace() {
  const [vault, setVault] = useState<VaultIndex | null>(null);
  const [skills, setSkills] = useState<SkillSpec[]>([]);
  const [provider, setProvider] = useState<MaskedProviderStatus | null>(null);
  const [savedManuals, setSavedManuals] = useState<SynthesisReport[]>([]);

  const [sourceTab, setSourceTab] = useState<SourceTab>("docs");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [kindFilter, setKindFilter] = useState("ALL");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedManualIds, setSelectedManualIds] = useState<string[]>([]);
  const [skillId, setSkillId] = useState("short-term");
  const [stageTitle, setStageTitle] = useState("");

  const [snapshot, setSnapshot] = useState<PrecheckSnapshot | null>(null);
  const [quantBrief, setQuantBrief] = useState<PeriodQuantBrief | null>(null);
  const [includeQuantAudit, setIncludeQuantAudit] = useState(true);
  const [report, setReport] = useState<SynthesisReport | null>(null);
  const [loadingPrecheck, setLoadingPrecheck] = useState(false);
  const [running, setRunning] = useState(false);
  const [streamStatus, setStreamStatus] = useState("");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  async function refreshManuals() {
    const res = await fetch("/api/manuals", { cache: "no-store" }).then((r) => r.json());
    if (res.ok && Array.isArray(res.manuals)) {
      setSavedManuals(res.manuals);
    }
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/vault", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/skills", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/provider", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/manuals", { cache: "no-store" }).then((r) => r.json()),
    ]).then(([v, s, p, m]) => {
      if (v.ok) {
        setVault(v.index);
        const docs = (v.index.documents ?? []) as VaultDoc[];
        setSelectedIds(docs.slice(0, 12).map((d) => d.doc_id));
      }
      if (s.ok && Array.isArray(s.skills)) {
        setSkills(s.skills);
        const paramSkill =
          typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("skill") : null;
        if (paramSkill && s.skills.some((sk: SkillSpec) => sk.id === paramSkill)) {
          setSkillId(paramSkill);
        }
      }
      if (p.ok) setProvider(p.status);
      if (m.ok && Array.isArray(m.manuals)) setSavedManuals(m.manuals);
    });
  }, []);

  const filteredDocs = useMemo(() => {
    const docs = [...(vault?.documents ?? [])].sort((a, b) =>
      (a.event_date ?? "9999-99-99").localeCompare(b.event_date ?? "9999-99-99"),
    );
    return docs.filter((d) => {
      if (kindFilter !== "ALL" && d.kind !== kindFilter) return false;
      if (fromDate && (!d.event_date || d.event_date < fromDate)) return false;
      if (toDate && (!d.event_date || d.event_date > toDate)) return false;
      return true;
    });
  }, [vault, kindFilter, fromDate, toDate]);

  const sortedManuals = useMemo(() => {
    return [...savedManuals].sort((a, b) =>
      (a.date_range?.from ?? a.created_at).localeCompare(b.date_range?.from ?? b.created_at),
    );
  }, [savedManuals]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedManualSet = useMemo(() => new Set(selectedManualIds), [selectedManualIds]);

  const activeSelectionCount = sourceTab === "manuals" ? selectedManualIds.length : selectedIds.length;

  function switchTab(next: SourceTab) {
    setSourceTab(next);
    setSnapshot(null);
    setError("");
  }

  function toggleId(id: string) {
    setSnapshot(null);
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleManualId(id: string) {
    setSnapshot(null);
    setSelectedManualIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function selectAllFiltered() {
    setSnapshot(null);
    if (sourceTab === "manuals") {
      setSelectedManualIds(sortedManuals.map((m) => m.id));
    } else {
      setSelectedIds(filteredDocs.map((d) => d.doc_id));
    }
  }

  function clearSelection() {
    setSnapshot(null);
    if (sourceTab === "manuals") {
      setSelectedManualIds([]);
    } else {
      setSelectedIds([]);
    }
  }

  function invertSelection() {
    setSnapshot(null);
    if (sourceTab === "manuals") {
      setSelectedManualIds(sortedManuals.filter((m) => !selectedManualSet.has(m.id)).map((m) => m.id));
    } else {
      setSelectedIds(filteredDocs.filter((d) => !selectedSet.has(d.doc_id)).map((d) => d.doc_id));
    }
  }

  function openDatePicker(e: React.MouseEvent<HTMLInputElement>) {
    try {
      (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
    } catch {
      // Fallback gracefully on browsers without showPicker()
    }
  }

  function applyYearStage(year: string) {
    setSnapshot(null);
    setFromDate(`${year}-01-01`);
    setToDate(`${year}-12-31`);
    const ids = (vault?.documents ?? [])
      .filter((d) => d.event_date && d.event_date.startsWith(`${year}-`))
      .map((d) => d.doc_id);
    setSelectedIds(ids);
    if (!stageTitle) setStageTitle(`${year} 年度交易方法演变与个人手册`);
  }

  function resetDateRange() {
    setSnapshot(null);
    setFromDate("");
    setToDate("");
  }

  function buildRequestPayload(mode: "precheck" | "run") {
    return sourceTab === "manuals"
      ? { mode, manualIds: selectedManualIds, skillId, stageTitle, includeQuantAudit }
      : { mode, docIds: selectedIds, skillId, stageTitle, includeQuantAudit };
  }

  async function handlePrecheck() {
    setError("");
    setLoadingPrecheck(true);
    try {
      const res = await fetch("/api/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequestPayload("precheck")),
      });
      const data = await res.json();
      if (!data.ok) setError(data.error || "预检失败");
      else {
        setSnapshot(data.snapshot);
        setQuantBrief(data.quantBrief ?? null);
      }
    } finally {
      setLoadingPrecheck(false);
    }
  }

  function handleCancelSynthesis() {
    abortRef.current?.abort();
  }

  async function handleRunSynthesis() {
    setError("");
    setRunning(true);
    setElapsedSec(0);
    setStreamStatus("正在连接本地提炼引擎并装载材料...");
    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = Date.now();
    const ticker = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    try {
      const res = await fetch("/api/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...buildRequestPayload("run"), stream: true }),
        signal: controller.signal,
      });

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("text/event-stream") && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split(/\r?\n/);
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const raw = trimmed.slice(5).trim();
            if (!raw) continue;
            const evt = JSON.parse(raw) as {
              type: "progress" | "done" | "error";
              message?: string;
              report?: SynthesisReport;
              error?: string;
            };
            if (evt.type === "progress" && evt.message) {
              setStreamStatus(evt.message);
            } else if (evt.type === "done" && evt.report) {
              setReport(evt.report);
              refreshManuals().catch(() => {});
            } else if (evt.type === "error") {
              setError(evt.error || "提炼失败");
            }
          }
        }
      } else {
        const data = await res.json();
        if (!data.ok) setError(data.error || "提炼失败");
        else {
          setReport(data.report);
          refreshManuals().catch(() => {});
        }
      }
    } catch (err) {
      if (controller.signal.aborted) {
        setError("已取消本次大模型提炼请求。");
      } else {
        setError(err instanceof Error ? err.message : "网络请求异常");
      }
    } finally {
      clearInterval(ticker);
      abortRef.current = null;
      setRunning(false);
      setStreamStatus("");
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        {/* Step 1: Timeline Sample Selector OR Hierarchical Map-Reduce Manual Selector */}
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {sourceTab === "manuals" ? (
                <Layers className="h-[19px] w-[19px] text-[var(--cyan)]" />
              ) : (
                <Calendar className="h-[19px] w-[19px] text-[var(--accent)]" />
              )}
              <h2 className="text-sm font-semibold text-[var(--ink-strong)]">
                {sourceTab === "manuals" ? "1. 勾选已有阶段手册（Map-Reduce 二次综合）" : "1. 按时间线阶段框选复盘样本"}
              </h2>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <button type="button" onClick={selectAllFiltered} className="text-[var(--accent)] hover:underline">
                全选 ({sourceTab === "manuals" ? sortedManuals.length : filteredDocs.length})
              </button>
              <span className="text-[var(--ink-dim)]">·</span>
              <button type="button" onClick={clearSelection} className="text-[var(--ink-muted)] hover:underline">
                清空
              </button>
            </div>
          </div>

          {/* Mode Toggle: Raw Reviews vs Stage Manuals Map-Reduce */}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => switchTab("docs")}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                sourceTab === "docs"
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "border-[var(--border)] bg-[var(--bg-deep)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
              }`}
            >
              <Calendar className="h-[17px] w-[17px]" />
              原始复盘笔记 ({vault?.documents.length ?? 0})
            </button>
            <button
              type="button"
              onClick={() => switchTab("manuals")}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                sourceTab === "manuals"
                  ? "border-[var(--cyan)] bg-[var(--cyan-soft)] text-[var(--cyan)]"
                  : "border-[var(--border)] bg-[var(--bg-deep)] text-[var(--ink-muted)] hover:text-[var(--cyan)]"
              }`}
            >
              <Layers className="h-[17px] w-[17px]" />
              阶段手册二次综合 · Map-Reduce ({savedManuals.length})
            </button>
          </div>

          {sourceTab === "manuals" ? (
            <>
              <div className="mt-3 rounded-lg border border-[var(--cyan)]/30 bg-[var(--cyan-soft)]/45 p-3 text-xs leading-5 text-[var(--ink)]">
                <strong>分层二次综合（Map-Reduce）</strong>：勾选多份已生成的周度 / 月度 / 季度阶段手册，跨周期对比认知升级与稳定铁律，一键合成年度总纲或终极个人交易手册，突破单次 8 万字上下文上限。
              </div>

              <div className="mt-4 max-h-[390px] space-y-1.5 overflow-y-auto pr-1">
                {sortedManuals.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[var(--border-strong)] p-6 text-center text-xs text-[var(--ink-muted)]">
                    尚未生成任何阶段手册。请先在「原始复盘笔记」标签下分阶段生成至少 2 份月度或季度手册，再回到这里执行二次综合。
                  </div>
                ) : (
                  sortedManuals.map((m) => {
                    const checked = selectedManualSet.has(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => toggleManualId(m.id)}
                        className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition ${
                          checked
                            ? "border-[var(--cyan)]/65 bg-[var(--cyan-soft)]/50"
                            : "border-[var(--border)] bg-[var(--bg-deep)] hover:border-[var(--border-strong)]"
                        }`}
                      >
                        {checked ? (
                          <CheckSquare className="mt-0.5 h-[19px] w-[19px] shrink-0 text-[var(--cyan)]" />
                        ) : (
                          <Square className="mt-0.5 h-[19px] w-[19px] shrink-0 text-[var(--ink-dim)]" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[11px] text-[var(--amber)]">
                              {m.date_range?.from ?? "—"} ~ {m.date_range?.to ?? "—"}
                            </span>
                            <span className="truncate text-xs font-semibold text-[var(--ink-strong)]">{m.title}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--ink-dim)]">
                            <span className="inline-flex items-center gap-1 text-[var(--cyan)]">
                              <BookMarked className="h-4 w-4" />
                              {m.skill_name}
                            </span>
                            <span>·</span>
                            <span>{m.statistics.docs_count} 样本</span>
                            <span>·</span>
                            <span>{m.statistics.timeline_count} 节点</span>
                            <span>·</span>
                            <span>{m.statistics.rules_count} 规则</span>
                            {m.source_mode === "manuals" && (
                              <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.2 text-[10px] text-[var(--cyan)]">
                                二次综合
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            <>
              {/* Multi-year Quick Stage Chips */}
              {vault && vault.years.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-[var(--ink-dim)]">快速按年份框选：</span>
                  <button
                    type="button"
                    onClick={resetDateRange}
                    className={`rounded border px-2 py-0.5 text-[11px] transition ${
                      !fromDate && !toDate
                        ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "border-[var(--border)] bg-[var(--bg-deep)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
                    }`}
                  >
                    全部年份
                  </button>
                  {vault.years.map((y) => {
                    const active = fromDate === `${y}-01-01` && toDate === `${y}-12-31`;
                    return (
                      <button
                        key={y}
                        type="button"
                        onClick={() => applyYearStage(y)}
                        className={`rounded border px-2 py-0.5 font-mono text-[11px] transition ${
                          active
                            ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                            : "border-[var(--border)] bg-[var(--bg-deep)] text-[var(--ink-muted)] hover:border-[var(--accent)]/50 hover:text-[var(--ink)]"
                        }`}
                      >
                        {y}年
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Date Range + Kind Filters */}
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label className="block text-[11px] text-[var(--ink-dim)]">
                  <span className="flex items-center justify-between">
                    <span>起始日期</span>
                    {fromDate && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          setSnapshot(null);
                          setFromDate("");
                        }}
                        className="text-[10px] text-[var(--ink-muted)] hover:text-[var(--ink)]"
                      >
                        清除
                      </button>
                    )}
                  </span>
                  <input
                    type="date"
                    value={fromDate}
                    onClick={openDatePicker}
                    onChange={(e) => {
                      setSnapshot(null);
                      setFromDate(e.target.value);
                    }}
                    className="mt-1 w-full cursor-pointer rounded-md border border-[var(--border)] bg-[var(--bg-deep)] px-2.5 py-1.5 text-xs text-[var(--ink)] [color-scheme:dark] hover:border-[var(--accent)]/60 focus:border-[var(--accent)] focus:outline-none"
                  />
                </label>
                <label className="block text-[11px] text-[var(--ink-dim)]">
                  <span className="flex items-center justify-between">
                    <span>截止日期</span>
                    {toDate && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          setSnapshot(null);
                          setToDate("");
                        }}
                        className="text-[10px] text-[var(--ink-muted)] hover:text-[var(--ink)]"
                      >
                        清除
                      </button>
                    )}
                  </span>
                  <input
                    type="date"
                    value={toDate}
                    onClick={openDatePicker}
                    onChange={(e) => {
                      setSnapshot(null);
                      setToDate(e.target.value);
                    }}
                    className="mt-1 w-full cursor-pointer rounded-md border border-[var(--border)] bg-[var(--bg-deep)] px-2.5 py-1.5 text-xs text-[var(--ink)] [color-scheme:dark] hover:border-[var(--accent)]/60 focus:border-[var(--accent)] focus:outline-none"
                  />
                </label>
                <label className="text-[11px] text-[var(--ink-dim)]">
                  笔记类型
                  <select
                    value={kindFilter}
                    onChange={(e) => setKindFilter(e.target.value)}
                    className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg-deep)] px-2.5 py-1.5 text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                  >
                    <option value="ALL">全部类型</option>
                    {(vault?.kinds ?? []).map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Timeline Checklist */}
              <div className="mt-4 max-h-[380px] space-y-1.5 overflow-y-auto pr-1">
                {filteredDocs.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[var(--border-strong)] p-6 text-center text-xs text-[var(--ink-muted)]">
                    暂无符合条件的复盘笔记。请先前往{" "}
                    <Link href="/vault" className="text-[var(--accent)] underline">
                      双链知识库
                    </Link>{" "}
                    导入笔记或加载示例库。
                  </div>
                ) : (
                  filteredDocs.map((doc) => {
                    const checked = selectedSet.has(doc.doc_id);
                    return (
                      <button
                        key={doc.doc_id}
                        type="button"
                        onClick={() => toggleId(doc.doc_id)}
                        className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition ${
                          checked
                            ? "border-[var(--accent)]/55 bg-[var(--accent-soft)]/70"
                            : "border-[var(--border)] bg-[var(--bg-deep)] hover:border-[var(--border-strong)]"
                        }`}
                      >
                        {checked ? (
                          <CheckSquare className="mt-0.5 h-[19px] w-[19px] shrink-0 text-[var(--accent)]" />
                        ) : (
                          <Square className="mt-0.5 h-[19px] w-[19px] shrink-0 text-[var(--ink-dim)]" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[11px] text-[var(--amber)]">
                              {doc.event_date ?? "未标日期"}
                            </span>
                            <span className="truncate text-xs font-medium text-[var(--ink)]">{doc.title}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--ink-dim)]">
                            <span>{doc.kind}</span>
                            <span>·</span>
                            <span>{doc.carrier.toUpperCase()}</span>
                            {[...doc.tags, ...(doc.auto_concepts ?? [])].slice(0, 3).map((t) => (
                              <span
                                key={t}
                                className="rounded bg-[var(--surface-2)] px-1.5 py-0.2 text-[10px] text-[var(--cyan)]"
                              >
                                #{t}
                              </span>
                            ))}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}

          {/* Bottom Selection Action Bar */}
          {(() => {
            const totalInView = sourceTab === "manuals" ? sortedManuals.length : filteredDocs.length;
            const selectedInView =
              sourceTab === "manuals"
                ? sortedManuals.filter((m) => selectedManualSet.has(m.id)).length
                : filteredDocs.filter((d) => selectedSet.has(d.doc_id)).length;
            const allInViewSelected = totalInView > 0 && selectedInView === totalInView;
            return (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
                <div className="text-xs text-[var(--ink-muted)]">
                  已选{" "}
                  <span className="font-mono font-semibold text-[var(--ink-strong)]">{activeSelectionCount}</span>
                  {" / "}
                  <span className="font-mono">{totalInView}</span>{" "}
                  {sourceTab === "manuals" ? "份手册" : "篇复盘"}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={totalInView === 0}
                    onClick={allInViewSelected ? clearSelection : selectAllFiltered}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition disabled:opacity-40 ${
                      allInViewSelected
                        ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "border-[var(--border-strong)] bg-[var(--bg-deep)] text-[var(--ink)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    }`}
                  >
                    {allInViewSelected ? <CheckSquare className="h-[17px] w-[17px]" /> : <Square className="h-[17px] w-[17px]" />}
                    {allInViewSelected ? `已全选 (${totalInView})` : `全选 (${totalInView})`}
                  </button>
                  <button
                    type="button"
                    disabled={totalInView === 0}
                    onClick={invertSelection}
                    className="rounded-md border border-[var(--border)] bg-[var(--bg-deep)] px-2.5 py-1 text-xs text-[var(--ink-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--ink)] disabled:opacity-40"
                  >
                    反选
                  </button>
                  <button
                    type="button"
                    disabled={activeSelectionCount === 0}
                    onClick={clearSelection}
                    className="rounded-md border border-[var(--border)] bg-[var(--bg-deep)] px-2.5 py-1 text-xs text-[var(--ink-muted)] transition hover:border-rose-500/40 hover:text-[var(--rose)] disabled:opacity-40"
                  >
                    清空
                  </button>
                </div>
              </div>
            );
          })()}
        </section>

        {/* Step 2: Skill Picker + Precheck + Run */}
        <section className="flex flex-col justify-between space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Cpu className="h-[19px] w-[19px] text-[var(--accent)]" />
                <h2 className="text-sm font-semibold text-[var(--ink-strong)]">2. 选择分析 Skill 与阶段命名</h2>
              </div>
              <Link
                href="/settings?tab=skills"
                className="text-[11px] font-medium text-[var(--cyan)] hover:underline"
              >
                自定义 / 管理 Skill →
              </Link>
            </div>

            <div className="max-h-[260px] space-y-2 overflow-y-auto pr-1">
              {skills.map((sk) => {
                const active = sk.id === skillId;
                return (
                  <button
                    key={sk.id}
                    type="button"
                    onClick={() => setSkillId(sk.id)}
                    className={`w-full rounded-lg border p-3 text-left transition ${
                      active
                        ? "border-[var(--accent)] bg-[var(--accent-soft)]/70"
                        : "border-[var(--border)] bg-[var(--bg-deep)] hover:border-[var(--border-strong)]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-xs font-semibold text-[var(--ink-strong)]">{sk.name}</span>
                        {!sk.builtin && (
                          <span className="shrink-0 rounded bg-[var(--cyan-soft)] px-1.5 py-0.2 text-[10px] text-[var(--cyan)]">
                            自定义
                          </span>
                        )}
                      </div>
                      <span className="shrink-0 font-mono text-[10px] text-[var(--ink-dim)]">{sk.id}</span>
                    </div>
                    <p className="mt-1 text-[11px] leading-5 text-[var(--ink-muted)]">{sk.summary}</p>
                  </button>
                );
              })}
            </div>

            <label className="block text-[11px] text-[var(--ink-dim)]">
              {sourceTab === "manuals" ? "总纲手册标题（可选，留空自动按跨度命名）" : "阶段手册标题（可选，留空自动按时间段与 Skill 命名）"}
              <input
                value={stageTitle}
                onChange={(e) => setStageTitle(e.target.value)}
                placeholder={
                  sourceTab === "manuals"
                    ? "例如：2024–2025 个人短线交易方法论年度总纲"
                    : "例如：2025 上半年短线情绪周期演进手册"
                }
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg-deep)] px-3 py-2 text-xs text-[var(--ink)] placeholder:text-[var(--ink-dim)] focus:border-[var(--accent)] focus:outline-none"
              />
            </label>

            {/* Provider Status Banner */}
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[var(--ink-muted)]">当前大模型通道</span>
                <Link href="/settings" className="text-[var(--accent)] hover:underline">
                  {provider?.configured ? "更换配置" : "去配置 API"}
                </Link>
              </div>
              <div className="mt-1 font-medium text-[var(--ink)]">
                {provider?.configured
                  ? `${provider.model}（${provider.url}）`
                  : "尚未配置大模型 API Key（预检免费可用，执行提炼前需配置）"}
              </div>
            </div>

            {/* Precheck Result */}
            {snapshot && (
              <div className="space-y-1.5 rounded-lg border border-[var(--emerald)]/35 bg-[var(--emerald-soft)] p-3 text-xs">
                <div className="flex items-center gap-1.5 font-semibold text-[var(--emerald)]">
                  <ShieldCheck className="h-[19px] w-[19px]" />
                  外发预检通过（0 Token 消耗）
                </div>
                <div className="text-[var(--ink)]">
                  将纳入 <strong>{snapshot.included_ids.length}</strong> {sourceTab === "manuals" ? "份阶段手册" : "篇复盘"}（共{" "}
                  <strong>{snapshot.total_chars.toLocaleString()}</strong> / {snapshot.limit.toLocaleString()} 字），
                  已切片生成 <strong>{snapshot.evidence_count}</strong> 条可核验证据 ID。
                </div>
                <div className="font-mono text-[11px] text-[var(--ink-muted)]">
                  时间范围：{snapshot.date_range.from ?? "—"} ~ {snapshot.date_range.to ?? "—"} · 指纹：
                  {snapshot.fingerprint.slice(0, 12)}
                </div>
                {quantBrief ? (
                  <div className="mt-2 rounded-lg border border-[var(--cyan)]/35 bg-[var(--bg-deep)] p-2.5 text-[11px] text-[var(--ink)]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-[var(--cyan)]">
                        <input
                          type="checkbox"
                          checked={includeQuantAudit}
                          onChange={(e) => setIncludeQuantAudit(e.target.checked)}
                          className="accent-[var(--cyan)]"
                        />
                        注入同期脱敏实盘账本，开启“文字 × 盈亏”定量证伪
                      </label>
                      <span className="font-mono text-[10px] text-[var(--ink-dim)]">仅传百分比，不传绝对资金</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-[var(--ink-muted)]">
                      <span>对齐 {quantBrief.matchedDays} 天 / {quantBrief.tradeCount} 笔</span>
                      <span>区间收益 {quantBrief.periodReturnPct > 0 ? "+" : ""}{quantBrief.periodReturnPct}%</span>
                      <span>MDD {quantBrief.mddPct}%</span>
                      {quantBrief.excessAlphaPct !== null && (
                        <span>超额 {quantBrief.excessAlphaPct > 0 ? "+" : ""}{quantBrief.excessAlphaPct}%</span>
                      )}
                      {quantBrief.profitFactor !== null && <span>PF {quantBrief.profitFactor}</span>}
                    </div>
                  </div>
                ) : (
                  <div className="pt-1 text-[11px] text-[var(--ink-dim)]">
                    提示：当前时间段暂无匹配的实盘账本记录，可前往{" "}
                    <Link href="/ledger" className="text-[var(--cyan)] hover:underline">
                      实盘账本
                    </Link>{" "}
                    导入交割单或每日净值以开启定量证伪。
                  </div>
                )}
              </div>
            )}

            {running && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--cyan)]/40 bg-[var(--cyan-soft)]/50 p-3 text-xs text-[var(--ink)]">
                <div className="flex min-w-0 items-center gap-2">
                  <Loader2 className="h-[19px] w-[19px] shrink-0 animate-spin text-[var(--cyan)]" />
                  <span className="truncate">{streamStatus || "正在调用大模型提炼..."}</span>
                </div>
                <span className="shrink-0 font-mono text-[11px] text-[var(--cyan)]">{elapsedSec}s</span>
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-[var(--rose)]/40 bg-[var(--rose-soft)] p-3 text-xs text-[var(--rose)]">
                {error}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 pt-2">
            <button
              type="button"
              onClick={handlePrecheck}
              disabled={loadingPrecheck || running || activeSelectionCount === 0}
              className="flex-1 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] px-4 py-2 text-xs font-medium text-[var(--ink)] hover:border-[var(--accent)]/60 disabled:opacity-50"
            >
              {loadingPrecheck
                ? "预检中..."
                : `先做发送预检（已选 ${activeSelectionCount} ${sourceTab === "manuals" ? "份" : "篇"}）`}
            </button>
            {running ? (
              <button
                type="button"
                onClick={handleCancelSynthesis}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-rose-500"
              >
                <StopCircle className="h-[17px] w-[17px]" />
                取消提炼（立即中断）
              </button>
            ) : (
              <button
                type="button"
                onClick={handleRunSynthesis}
                disabled={activeSelectionCount === 0 || !provider?.configured}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--accent-strong)] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[var(--accent)] disabled:opacity-45"
              >
                <Play className="h-[17px] w-[17px]" />
                {sourceTab === "manuals" ? "二次综合生成总纲手册" : "开始提炼时间轴与手册"}
              </button>
            )}
          </div>
        </section>
      </div>

      {/* Live Output */}
      {report && <ReportView report={report} />}
    </div>
  );
}
