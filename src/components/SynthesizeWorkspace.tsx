"use client";

import Link from "next/link";
import {
  ArrowRight,
  BookMarked,
  Calendar,
  Check,
  CheckCircle2,
  CheckSquare,
  ClipboardPaste,
  Copy,
  Cpu,
  Download,
  Layers,
  Loader2,
  Play,
  ShieldCheck,
  Square,
  StopCircle,
  Terminal,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { dispatchVaultChanged } from "@/components/CreateVaultModal";
import ReportView from "@/components/ReportView";
import { endGuidedTour, useGuidedTour } from "@/lib/onboarding-tour";
import type { MaskedProviderStatus } from "@/lib/provider";
import type { SkillSpec } from "@/lib/skills";
import type { PeriodQuantBrief } from "@/lib/ledger-analytics";
import type { PrecheckSnapshot, SynthesisReport } from "@/lib/synthesis";
import type { VaultDoc, VaultIndex } from "@/lib/vault-builder";

type SourceTab = "docs" | "manuals";
type ExecMode = "direct" | "manual";

export default function SynthesizeWorkspace() {
  const [urlHasTour, setUrlHasTour] = useState(false);
  const [execMode, setExecMode] = useState<ExecMode>("direct");
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      setUrlHasTour(sp.get("tour") === "1");
      if (sp.get("mode") === "manual") setExecMode("manual");
    } catch {
      setUrlHasTour(false);
    }
  }, []);
  const tourActive = useGuidedTour(urlHasTour);
  const [tourGraduated, setTourGraduated] = useState(false);

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
  const [maxChars, setMaxChars] = useState<number>(500_000);

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

  // Zero-API manual collaboration state
  const [exportedPrompt, setExportedPrompt] = useState("");
  const [exportedMeta, setExportedMeta] = useState<{ chars: number; evidence: number; docs: number } | null>(null);
  const [exportingPrompt, setExportingPrompt] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [pastedResponse, setPastedResponse] = useState("");
  const [manualModelLabel, setManualModelLabel] = useState("网页 AI / 外部 Agent 协作");
  const [importingResult, setImportingResult] = useState(false);

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
      fetch("/api/vaults", { cache: "no-store" }).then((r) => r.json()),
    ]).then(([v, s, p, m, ov]) => {
      if (v.ok) {
        setVault(v.index);
        const docs = (v.index.documents ?? []) as VaultDoc[];
        setSelectedIds(docs.slice(0, 50).map((d) => d.doc_id));
      }
      if (s.ok && Array.isArray(s.skills)) {
        setSkills(s.skills);
        const paramSkill =
          typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("skill") : null;
        const vaultDefaultSkill = ov?.ok ? ov.activeVault?.defaultSkillId : null;
        const preferred = paramSkill || vaultDefaultSkill;
        if (preferred && s.skills.some((sk: SkillSpec) => sk.id === preferred)) {
          setSkillId(preferred);
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

  function buildRequestPayload(mode: "precheck" | "run" | "export-prompt" | "import-result") {
    return sourceTab === "manuals"
      ? { mode, manualIds: selectedManualIds, skillId, stageTitle, includeQuantAudit, maxChars }
      : { mode, docIds: selectedIds, skillId, stageTitle, includeQuantAudit, maxChars };
  }

  async function handleExportPromptPack() {
    setError("");
    setExportingPrompt(true);
    setPromptCopied(false);
    try {
      const res = await fetch("/api/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequestPayload("export-prompt")),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "生成提示词包失败");
      } else {
        setSnapshot(data.snapshot);
        setQuantBrief(data.quantBrief ?? null);
        setExportedPrompt(data.promptText || "");
        setExportedMeta({
          chars: data.charCount ?? 0,
          evidence: data.evidenceCount ?? 0,
          docs: data.snapshot?.included_ids?.length ?? 0,
        });
        try {
          await navigator.clipboard.writeText(data.promptText || "");
          setPromptCopied(true);
          setTimeout(() => setPromptCopied(false), 2500);
        } catch {
          /* clipboard may be blocked in non-secure context; user can click copy/download */
        }
      }
    } finally {
      setExportingPrompt(false);
    }
  }

  async function handleCopyExistingPrompt() {
    if (!exportedPrompt) return;
    try {
      await navigator.clipboard.writeText(exportedPrompt);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2500);
    } catch {
      /* ignore */
    }
  }

  function handleDownloadPromptTxt() {
    if (!exportedPrompt) return;
    const blob = new Blob([exportedPrompt], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tradeloom-prompt-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportExternalResult() {
    setError("");
    setImportingResult(true);
    try {
      const res = await fetch("/api/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildRequestPayload("import-result"),
          rawResponse: pastedResponse,
          modelLabel: manualModelLabel,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "校验并生成手册失败");
      } else {
        setReport(data.report);
        setPastedResponse("");
        if (tourActive) {
          endGuidedTour();
          setTourGraduated(true);
        }
        dispatchVaultChanged();
        refreshManuals().catch(() => {});
      }
    } finally {
      setImportingResult(false);
    }
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
              if (tourActive) {
                endGuidedTour();
                setTourGraduated(true);
              }
              dispatchVaultChanged();
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
          if (tourActive) {
            endGuidedTour();
            setTourGraduated(true);
          }
          dispatchVaultChanged();
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
                <Layers className="h-[17px] w-[17px] text-[var(--cyan)]" />
              ) : (
                <Calendar className="h-[17px] w-[17px] text-[var(--accent)]" />
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
              <Calendar className="h-[15px] w-[15px]" />
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
              <Layers className="h-[15px] w-[15px]" />
              阶段手册二次综合 · Map-Reduce ({savedManuals.length})
            </button>
          </div>

          {sourceTab === "manuals" ? (
            <>
              <div className="mt-3 rounded-lg border border-[var(--cyan)]/30 bg-[var(--cyan-soft)]/45 p-3 text-xs leading-5 text-[var(--ink)]">
                <strong>分层二次综合（Map-Reduce）</strong>：勾选多份已生成的周度 / 月度 / 季度阶段手册，跨周期对比认知升级与稳定铁律，一键合成年度总纲或终极个人交易手册。
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
                          <CheckSquare className="mt-0.5 h-[17px] w-[17px] shrink-0 text-[var(--cyan)]" />
                        ) : (
                          <Square className="mt-0.5 h-[17px] w-[17px] shrink-0 text-[var(--ink-dim)]" />
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
                    className="mt-1 w-full cursor-pointer rounded-md border border-[var(--border)] bg-[var(--bg-deep)] px-2.5 py-1.5 text-xs text-[var(--ink)] hover:border-[var(--accent)]/60 focus:border-[var(--accent)] focus:outline-none"
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
                    className="mt-1 w-full cursor-pointer rounded-md border border-[var(--border)] bg-[var(--bg-deep)] px-2.5 py-1.5 text-xs text-[var(--ink)] hover:border-[var(--accent)]/60 focus:border-[var(--accent)] focus:outline-none"
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
                          <CheckSquare className="mt-0.5 h-[17px] w-[17px] shrink-0 text-[var(--accent)]" />
                        ) : (
                          <Square className="mt-0.5 h-[17px] w-[17px] shrink-0 text-[var(--ink-dim)]" />
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
                    {allInViewSelected ? <CheckSquare className="h-[15px] w-[15px]" /> : <Square className="h-[15px] w-[15px]" />}
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
                <Cpu className="h-[17px] w-[17px] text-[var(--accent)]" />
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

            <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_172px]">
              <label className="block text-[11px] text-[var(--ink-dim)]">
                {sourceTab === "manuals" ? "总纲手册标题（可选）" : "阶段手册标题（可选，留空自动命名）"}
                <input
                  value={stageTitle}
                  onChange={(e) => setStageTitle(e.target.value)}
                  placeholder={
                    sourceTab === "manuals"
                      ? "例如：2024–2025 个人交易方法论年度总纲"
                      : "例如：2025 上半年短线情绪周期演进手册"
                  }
                  className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg-deep)] px-3 py-2 text-xs text-[var(--ink)] placeholder:text-[var(--ink-dim)] focus:border-[var(--accent)] focus:outline-none"
                />
              </label>

              <label className="block text-[11px] text-[var(--ink-dim)]">
                单次装箱容量上限
                <select
                  value={maxChars}
                  onChange={(e) => {
                    setSnapshot(null);
                    setMaxChars(Number(e.target.value));
                  }}
                  className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg-deep)] px-2.5 py-2 font-mono text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                >
                  <option value={200000}>20 万字（标准 128K）</option>
                  <option value={500000}>50 万字（推荐默认）</option>
                  <option value={1200000}>120 万字（百万长窗）</option>
                  <option value={3000000}>300 万字（全量装箱）</option>
                </select>
              </label>
            </div>

            {/* Execution Mode Switch: Direct (CLI Agent / API) vs Zero-API Collaboration */}
            <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] p-1 text-xs">
              <button
                type="button"
                onClick={() => {
                  setExecMode("direct");
                  setError("");
                }}
                className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium transition ${
                  execMode === "direct"
                    ? "bg-[var(--surface)] text-[var(--ink-strong)] shadow-xs"
                    : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
                }`}
              >
                <Terminal className="h-3.5 w-3.5 text-[var(--accent)]" />
                直连提炼（本机 Agent / API）
              </button>
              <button
                type="button"
                onClick={() => {
                  setExecMode("manual");
                  setError("");
                }}
                className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium transition ${
                  execMode === "manual"
                    ? "bg-[var(--surface)] text-[var(--cyan)] shadow-xs"
                    : "text-[var(--ink-muted)] hover:text-[var(--cyan)]"
                }`}
              >
                <Copy className="h-3.5 w-3.5 text-[var(--cyan)]" />
                免 API 协作（网页 AI / 订阅）
              </button>
            </div>

            {/* Provider Status Banner (Direct Mode) */}
            {execMode === "direct" && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--ink-muted)]">当前直连 AI 引擎</span>
                  <Link href={tourActive ? "/settings?tour=1" : "/settings"} className="text-[var(--accent)] hover:underline">
                    {provider?.configured ? "更换本机 Agent / API" : "去配置本机 Agent 或 API"}
                  </Link>
                </div>
                <div className="mt-1 font-medium text-[var(--ink)]">
                  {provider?.configured
                    ? provider.mode === "cli"
                      ? `本机 CLI Agent：${provider.label}（免 API Key 直连）`
                      : `${provider.model}（${provider.url}）`
                    : "尚未配置直连引擎——可前往设置一键直连本机 CLI Agent，或直接切右侧「免 API 协作」零配置完成凝练。"}
                </div>
                {!provider?.configured && (
                  <button
                    type="button"
                    onClick={() => setExecMode("manual")}
                    className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--cyan)] hover:underline"
                  >
                    没有 API Key？切到「免 API 网页/订阅协作」立即凝练 →
                  </button>
                )}
              </div>
            )}

            {/* Zero-API Web / External Agent Collaboration Panel */}
            {execMode === "manual" && (
              <div className="space-y-3 rounded-lg border border-[var(--cyan)]/35 bg-[var(--bg-deep)] p-3.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-[var(--ink-strong)]">
                    免 API 协作：复制到 ChatGPT / Claude / DeepSeek / Kimi / 任意 Agent
                  </span>
                  <span className="font-mono text-[10px] text-[var(--cyan)]">0 API 消耗 · 同等防幻觉核验</span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleExportPromptPack}
                    disabled={exportingPrompt || activeSelectionCount === 0}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--cyan)] px-3.5 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-45"
                  >
                    {exportingPrompt ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : promptCopied ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {exportingPrompt
                      ? "正在装箱证据切片..."
                      : promptCopied
                        ? "已生成并复制到剪贴板！"
                        : `1. 生成并复制完整提示词包（已选 ${activeSelectionCount} ${sourceTab === "manuals" ? "份" : "篇"}）`}
                  </button>

                  {exportedPrompt && (
                    <>
                      <button
                        type="button"
                        onClick={handleCopyExistingPrompt}
                        className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-2 text-[11px] font-medium text-[var(--ink)] hover:border-[var(--cyan)]"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        再次复制
                      </button>
                      <button
                        type="button"
                        onClick={handleDownloadPromptTxt}
                        title="长复盘下载成 .txt 附件直接拖入 Kimi / ChatGPT / Claude / DeepSeek 更省心"
                        className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-2 text-[11px] font-medium text-[var(--ink)] hover:border-[var(--cyan)]"
                      >
                        <Download className="h-3.5 w-3.5" />
                        下载 .txt 附件
                      </button>
                    </>
                  )}
                </div>

                {exportedMeta && (
                  <div className="rounded-md border border-[var(--emerald)]/30 bg-[var(--emerald-soft)]/60 px-2.5 py-1.5 font-mono text-[11px] text-[var(--emerald)]">
                    已打包 {exportedMeta.docs} 份材料 · {exportedMeta.chars.toLocaleString()} 字 · {exportedMeta.evidence} 条确定性 evidence_id。请发给你的 AI 后，将完整回复贴在下方：
                  </div>
                )}

                <div className="space-y-2 pt-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-[11px] font-medium text-[var(--ink-muted)]">
                      2. 粘贴 AI / Agent 返回的回复（支持直接包含 ```json 代码块）
                    </label>
                    <input
                      value={manualModelLabel}
                      onChange={(e) => setManualModelLabel(e.target.value)}
                      placeholder="署名标注（如 ChatGPT Plus）"
                      className="w-44 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--ink)] focus:border-[var(--cyan)] focus:outline-none"
                    />
                  </div>
                  <textarea
                    value={pastedResponse}
                    onChange={(e) => setPastedResponse(e.target.value)}
                    rows={5}
                    placeholder='把网页 AI 或外部 Agent 生成的 JSON 粘贴到这里，例如：{"overview": ..., "timeline": [...], "manual": [...]}'
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] p-2.5 font-mono text-[11px] text-[var(--ink)] placeholder:text-[var(--ink-dim)] focus:border-[var(--cyan)] focus:outline-none"
                  />
                </div>
              </div>
            )}

            {/* Precheck Result */}
            {snapshot && (
              <div className="space-y-1.5 rounded-lg border border-[var(--emerald)]/35 bg-[var(--emerald-soft)] p-3 text-xs">
                <div className="flex items-center gap-1.5 font-semibold text-[var(--emerald)]">
                  <ShieldCheck className="h-[17px] w-[17px]" />
                  外发预检通过（0 Token 消耗）
                </div>
                <div className="text-[var(--ink)]">
                  将纳入 <strong>{snapshot.included_ids.length}</strong> / {snapshot.selected_ids.length}{" "}
                  {sourceTab === "manuals" ? "份阶段手册" : "篇复盘"}（共{" "}
                  <strong>{snapshot.total_chars.toLocaleString()}</strong> / {snapshot.limit.toLocaleString()} 字），
                  已切片生成 <strong>{snapshot.evidence_count}</strong> 条可核验证据 ID。
                </div>
                <div className="font-mono text-[11px] text-[var(--ink-muted)]">
                  时间范围：{snapshot.date_range.from ?? "—"} ~ {snapshot.date_range.to ?? "—"} · 指纹：
                  {snapshot.fingerprint.slice(0, 12)}
                </div>
                {(snapshot.over_limit_ids.length > 0 || snapshot.omitted_ids.length > 0) && (
                  <div className="mt-2 rounded-lg border border-[var(--amber)]/40 bg-[var(--amber-soft)] p-2.5 text-[11px] leading-5 text-[var(--ink)]">
                    <div className="font-semibold text-[var(--amber)]">
                      {snapshot.over_limit_ids.length > 0
                        ? `有 ${snapshot.over_limit_ids.length} 篇超出单次 ${snapshot.limit.toLocaleString()} 字上限，整篇未纳入本轮装箱`
                        : `有 ${snapshot.omitted_ids.length} 篇因正文为空或超限未纳入本轮装箱`}
                    </div>
                    {snapshot.over_limit_ids.length > 0 && sourceTab === "docs" && (
                      <div className="mt-0.5 text-[var(--ink-muted)]">
                        建议：先用左侧「快速按年份框选」分年度生成阶段手册，再切换至「阶段手册二次综合 · Map-Reduce」跨年合并为终极交易手册，避免遗漏后期记录。
                      </div>
                    )}
                  </div>
                )}
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
                  <Loader2 className="h-[17px] w-[17px] shrink-0 animate-spin text-[var(--cyan)]" />
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

          {execMode === "manual" ? (
            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={handleImportExternalResult}
                disabled={importingResult || activeSelectionCount === 0 || !pastedResponse.trim()}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--accent-strong)] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-[var(--accent)] disabled:opacity-45"
              >
                {importingResult ? (
                  <Loader2 className="h-[15px] w-[15px] animate-spin" />
                ) : (
                  <ClipboardPaste className="h-[15px] w-[15px]" />
                )}
                {importingResult ? "正在逐字核验 evidence_id 并落库..." : "3. 核验原文证据并生成正式交易手册"}
              </button>
            </div>
          ) : (
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
                  <StopCircle className="h-[15px] w-[15px]" />
                  取消提炼（立即中断）
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleRunSynthesis}
                  disabled={activeSelectionCount === 0 || !provider?.configured}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--accent-strong)] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[var(--accent)] disabled:opacity-45"
                >
                  <Play className="h-[15px] w-[15px]" />
                  {sourceTab === "manuals" ? "二次综合生成总纲手册" : "开始提炼时间轴与手册"}
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Live Output & Tour Graduation Banner */}
      {tourGraduated && report && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--emerald)]/45 bg-[var(--emerald-soft)]/60 px-4 py-3 text-xs">
          <div className="flex items-center gap-2 font-medium text-[var(--ink-strong)]">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--emerald)]" />
            <span>
              恭喜！第 1 份个人交易手册已凝练完成，上方全部工作台导航已为你解锁。
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/manuals"
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 font-medium text-[var(--ink-strong)] transition hover:border-[var(--accent)]"
            >
              前往手册档案库
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent-strong)] px-3.5 py-1.5 font-semibold text-white transition hover:bg-[var(--accent)]"
            >
              回到总览工作台
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      )}
      {report && <ReportView report={report} />}
    </div>
  );
}
