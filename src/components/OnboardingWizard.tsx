"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Cloud,
  FileText,
  FileUp,
  FolderOpen,
  Globe,
  Hash,
  Loader2,
  Network,
  RotateCcw,
  Sparkles,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { dispatchVaultChanged } from "@/components/CreateVaultModal";
import { endGuidedTour, startGuidedTour } from "@/lib/onboarding-tour";
import type { VaultIndex } from "@/lib/vault-builder";

type Step = 1 | 2 | 3;
type ImportMode = "file" | "paste" | "url";
type Step3Phase = "weaving" | "result";

type BatchLog = {
  id: number;
  source: string;
  count: number;
};

export const ONBOARDING_STEP_KEY = "tradeloom-onboarding-step";
const ONBOARDING_PREV_TOTAL_KEY = "tradeloom-onboarding-prev-total";

function clearOnboardingSession() {
  try {
    sessionStorage.removeItem(ONBOARDING_STEP_KEY);
    sessionStorage.removeItem(ONBOARDING_PREV_TOTAL_KEY);
  } catch {
    /* ignore */
  }
}

export default function OnboardingWizard({
  initialVaultName,
  initialStep = 1,
  onReplayIntro,
  onSkipToDashboard,
}: {
  initialVaultName?: string;
  initialStep?: Step;
  onReplayIntro: () => void;
  onSkipToDashboard: () => void;
}) {
  const router = useRouter();

  const [step, setStep] = useState<Step>(initialStep);
  const [vaultName, setVaultName] = useState(
    initialVaultName && initialVaultName !== "我的主复盘库" ? initialVaultName : "我的复盘库",
  );
  const [showMountOption, setShowMountOption] = useState(false);
  const [externalDir, setExternalDir] = useState("");
  const [savingVault, setSavingVault] = useState(false);

  // Step 2 multi-channel staging state
  const [importMode, setImportMode] = useState<ImportMode>("file");
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState("");
  const [error, setError] = useState("");
  const [liveIndex, setLiveIndex] = useState<VaultIndex | null>(null);
  const [batchLogs, setBatchLogs] = useState<BatchLog[]>([]);

  // Paste & URL inline state
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteBody, setPasteBody] = useState("");
  const [urlInput, setUrlInput] = useState("");

  // Step 3 weaving -> result state
  const [step3Phase, setStep3Phase] = useState<Step3Phase>("weaving");
  const [weavingStageText, setWeavingStageText] = useState("正在解析复盘日期与时间轴…");

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const syncVaultIndex = useCallback(async () => {
    try {
      const res = await fetch("/api/vault", { cache: "no-store" });
      const data = await res.json();
      if (data.ok && data.index) {
        const idx = data.index as VaultIndex;
        setLiveIndex(idx);
        try {
          const prevRaw = sessionStorage.getItem(ONBOARDING_PREV_TOTAL_KEY);
          if (prevRaw !== null) {
            const prev = Number(prevRaw);
            if (Number.isFinite(prev) && idx.counts.total > prev) {
              setBatchLogs((logs) => [
                ...logs,
                { id: Date.now(), source: "云端同步", count: idx.counts.total - prev },
              ]);
            }
            sessionStorage.removeItem(ONBOARDING_PREV_TOTAL_KEY);
          }
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    syncVaultIndex();
  }, [syncVaultIndex]);

  useEffect(() => {
    try {
      if (step === 2) {
        sessionStorage.setItem(ONBOARDING_STEP_KEY, "2");
      }
    } catch {
      /* ignore */
    }
  }, [step]);

  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute("webkitdirectory", "");
      folderInputRef.current.setAttribute("directory", "");
    }
  }, [step, importMode]);

  useEffect(() => {
    if (step !== 3 || step3Phase !== "weaving") return;
    setWeavingStageText("正在解析复盘日期与时间轴…");
    const t1 = window.setTimeout(() => setWeavingStageText("正在识别高频交易概念与共振关系…"), 520);
    const t2 = window.setTimeout(() => setWeavingStageText("正在编织双向链接星图…"), 1020);
    const t3 = window.setTimeout(() => setStep3Phase("result"), 1550);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [step, step3Phase]);

  function recordBatchIngest(index: VaultIndex, count: number, source: string) {
    setLiveIndex(index);
    setBatchLogs((prev) => [...prev, { id: Date.now(), source, count }]);
    dispatchVaultChanged("default");
  }

  function startGlobalWeave() {
    if ((liveIndex?.counts.total ?? 0) === 0) return;
    setStep3Phase("weaving");
    setStep(3);
  }

  async function handleStep1Submit(e: React.FormEvent) {
    e.preventDefault();
    const cleanName = vaultName.trim() || "我的复盘库";
    setError("");
    setSavingVault(true);
    try {
      const res = await fetch("/api/vaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          id: "default",
          name: cleanName,
          externalSourceDir: showMountOption ? externalDir.trim() : "",
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "初始化知识库失败");
        return;
      }
      setVaultName(cleanName);
      dispatchVaultChanged("default");

      const vRes = await fetch("/api/vault", { cache: "no-store" });
      const vData = await vRes.json();
      if (vData.ok && vData.index) {
        const idx = vData.index as VaultIndex;
        setLiveIndex(idx);
        if (showMountOption && externalDir.trim() && idx.counts.total > 0) {
          setBatchLogs([{ id: Date.now(), source: "挂载目录", count: idx.counts.total }]);
        }
      }
      setStep(2);
    } catch {
      setError("网络请求失败，请检查本地服务状态");
    } finally {
      setSavingVault(false);
    }
  }

  async function handleUploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError("");
    setImporting(true);
    setImportStatus(`正在解析并导入 ${files.length} 份文件…`);
    try {
      const form = new FormData();
      for (const f of Array.from(files)) form.append("file", f);
      const res = await fetch("/api/vault/import", { method: "POST", body: form });
      const data = await res.json();
      if (data.ok && data.index) {
        const idx = data.index as VaultIndex;
        const count = Number(data.succeeded ?? 0) || Math.max(1, idx.counts.total - (liveIndex?.counts.total ?? 0));
        recordBatchIngest(idx, count, "本地文件");
      } else {
        setError(data.error || data.results?.[0]?.error || "导入失败，请确认文件格式（MD/TXT/Word/PDF/HTML）");
      }
    } catch {
      setError("文件上传失败，请稍后重试");
    } finally {
      setImporting(false);
      setImportStatus("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (folderInputRef.current) folderInputRef.current.value = "";
    }
  }

  async function handlePasteSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pasteBody.trim()) {
      setError("请先粘贴复盘内容");
      return;
    }
    setError("");
    setImporting(true);
    setImportStatus("正在存入正文…");
    try {
      const res = await fetch("/api/vault/paste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: pasteTitle.trim() || undefined,
          content: pasteBody.trim(),
          sourcePlatform: "手工粘贴",
        }),
      });
      const data = await res.json();
      if (data.ok && data.index) {
        recordBatchIngest(data.index as VaultIndex, 1, "正文粘贴");
        setPasteTitle("");
        setPasteBody("");
      } else {
        setError(data.error || "粘贴入库失败");
      }
    } catch {
      setError("粘贴入库请求失败");
    } finally {
      setImporting(false);
      setImportStatus("");
    }
  }

  async function handleUrlSubmit(e: React.FormEvent) {
    e.preventDefault();
    const lines = urlInput
      .split(/[\r\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      setError("请输入至少一个文章链接（支持雪球 / 公众号等公开页面）");
      return;
    }
    setError("");
    setImporting(true);
    setImportStatus(`正在抓取 ${lines.length} 条网页复盘…`);
    try {
      const res = await fetch("/api/vault/import-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lines.length > 1 ? { urls: lines } : { url: lines[0] }),
      });
      const data = await res.json();
      if (data.ok && data.index) {
        const idx = data.index as VaultIndex;
        const count = Number(data.succeeded ?? 0) || Math.max(1, idx.counts.total - (liveIndex?.counts.total ?? 0));
        recordBatchIngest(idx, count, "网页抓取");
        setUrlInput("");
      } else {
        setError(data.error || "网页抓取失败（部分需登录平台可改用正文粘贴或云同步）");
      }
    } catch {
      setError("抓取请求失败，请检查网络或链接有效性");
    } finally {
      setImporting(false);
      setImportStatus("");
    }
  }

  function beforeLeaveToSync() {
    try {
      sessionStorage.setItem(ONBOARDING_STEP_KEY, "2");
      sessionStorage.setItem(ONBOARDING_PREV_TOTAL_KEY, String(liveIndex?.counts.total ?? 0));
    } catch {
      /* ignore */
    }
  }

  function handleSkip() {
    clearOnboardingSession();
    endGuidedTour();
    onSkipToDashboard();
  }

  function goToGraph() {
    clearOnboardingSession();
    startGuidedTour();
    dispatchVaultChanged("default");
    router.push("/vault?view=graph&tour=1");
  }

  const totalDocs = liveIndex?.counts.total ?? 0;
  const lastBatch = batchLogs.length > 0 ? batchLogs[batchLogs.length - 1] : null;

  return (
    <div className="tl-fade-up mx-auto max-w-4xl py-4">
      {/* Top Minimal Stepper & Replay Action */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 sm:gap-3">
          {[
            { n: 1 as Step, label: "命名知识库" },
            { n: 2 as Step, label: "导入复盘文件" },
            { n: 3 as Step, label: "织脉成网" },
          ].map((item, idx) => {
            const active = step === item.n;
            const done = step > item.n;
            return (
              <div key={item.n} className="flex items-center gap-2 sm:gap-3">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
                    active
                      ? "bg-[var(--accent-strong)] text-white shadow-xs"
                      : done
                        ? "bg-[var(--emerald-soft)] text-[var(--emerald)]"
                        : "border border-[var(--border)] bg-[var(--surface)] text-[var(--ink-dim)]"
                  }`}
                >
                  <span className="font-mono text-[10px]">{done ? "✓" : `0${item.n}`}</span>
                  <span>{item.label}</span>
                </span>
                {idx < 2 && <span className="hidden h-px w-5 bg-[var(--border-strong)] sm:block" />}
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onReplayIntro}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] text-[var(--ink-muted)] transition hover:border-[var(--accent)]/50 hover:text-[var(--ink-strong)]"
        >
          <RotateCcw className="h-3 w-3" />
          重播开场动效
        </button>
      </div>

      {/* Main Stage Card */}
      <div className="scifi-card overflow-hidden rounded-2xl">
        {/* ==================== STEP 1: MINIMAL VAULT NAMING ==================== */}
        {step === 1 && (
          <form onSubmit={handleStep1Submit} className="tl-fade-up mx-auto max-w-xl space-y-6 px-6 py-10 sm:px-10 sm:py-12">
            <div className="text-center">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]">
                Step 01 · Initialize Vault
              </span>
              <h1 className="mt-3 text-2xl font-bold tracking-tight text-[var(--ink-strong)]">
                给你的第一个复盘库起个名字
              </h1>
            </div>

            <div className="space-y-3">
              <input
                value={vaultName}
                onChange={(e) => setVaultName(e.target.value)}
                placeholder="例如：我的复盘库"
                autoFocus
                className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-deep)] px-4 py-3 text-center text-base font-semibold text-[var(--ink-strong)] placeholder:text-[var(--ink-dim)] focus:border-[var(--accent)] focus:bg-[var(--surface)] focus:outline-none"
              />

              {/* Optional Collapsible Mount Folder */}
              <div className="pt-1 text-center">
                <button
                  type="button"
                  onClick={() => setShowMountOption((v) => !v)}
                  className="inline-flex items-center gap-1 text-[11px] text-[var(--ink-dim)] transition hover:text-[var(--ink-strong)]"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  <span>我有本地 Obsidian / 复盘目录，直接挂载（可选）</span>
                  {showMountOption ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
                {showMountOption && (
                  <div className="mt-2.5 text-left">
                    <input
                      value={externalDir}
                      onChange={(e) => setExternalDir(e.target.value)}
                      placeholder="例如：D:\我的笔记\交易复盘（留空则由软件内导入管理）"
                      className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono text-xs text-[var(--ink)] placeholder:text-[var(--ink-dim)] focus:border-[var(--accent)] focus:outline-none"
                    />
                  </div>
                )}
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-[var(--rose)]/35 bg-[var(--rose-soft)] px-3 py-2 text-center text-xs text-[var(--rose)]">
                {error}
              </div>
            )}

            <div className="pt-1">
              <button
                type="submit"
                disabled={savingVault}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent-strong)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent)] disabled:opacity-50"
              >
                {savingVault ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {savingVault ? "正在就绪…" : "下一步：导入复盘文件"}
              </button>
            </div>
          </form>
        )}

        {/* ==================== STEP 2: MULTI-CHANNEL INGEST + GLOBAL WEAVE BAR ==================== */}
        {step === 2 && (
          <div key="step-2-import" className="tl-fade-up p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
              <div>
                <div className="flex items-center gap-2 text-[11px] font-medium text-[var(--accent)]">
                  <span>{vaultName}</span>
                  <span>·</span>
                  <span>支持多渠道连续导入，凑齐后再统一织脉</span>
                </div>
                <h2 className="mt-1 text-xl font-bold tracking-tight text-[var(--ink-strong)]">
                  导入你的第一批复盘笔记
                </h2>
              </div>

              {/* Channel Switcher Tabs */}
              <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] p-1 text-xs">
                {[
                  { id: "file" as ImportMode, label: "上传 / 拖入文件", icon: FileUp },
                  { id: "paste" as ImportMode, label: "粘贴正文", icon: ClipboardPaste },
                  { id: "url" as ImportMode, label: "网页链接", icon: Globe },
                ].map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setError("");
                      setImportMode(id);
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition ${
                      importMode === id
                        ? "bg-[var(--surface)] text-[var(--ink-strong)] shadow-2xs"
                        : "text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5">
              {importMode === "file" && (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    handleUploadFiles(e.dataTransfer.files);
                  }}
                  className={`tl-hero-canvas flex min-h-[240px] flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-9 text-center transition ${
                    dragging
                      ? "scale-[1.005] border-[var(--accent)] bg-[var(--accent-soft)]/50"
                      : "border-[var(--border-strong)] hover:border-[var(--accent)]/60"
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".md,.markdown,.txt,.docx,.pdf,.html,.htm"
                    className="hidden"
                    onChange={(e) => handleUploadFiles(e.target.files)}
                  />
                  <input
                    ref={folderInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => handleUploadFiles(e.target.files)}
                  />

                  <div className="flex h-13 w-13 items-center justify-center rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent)]">
                    {importing ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
                  </div>

                  <h3 className="mt-3.5 text-base font-semibold text-[var(--ink-strong)]">
                    {importing ? importStatus || "正在导入…" : "把复盘文件直接拖到这里（可分多次追加）"}
                  </h3>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    支持 Markdown / TXT / Word (.docx) / PDF / HTML，支持多次补充上传
                  </p>

                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                    <button
                      type="button"
                      disabled={importing}
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent)]/50 bg-[var(--surface)] px-4 py-2 text-xs font-semibold text-[var(--accent)] transition hover:bg-[var(--accent-soft)] disabled:opacity-50"
                    >
                      <FileUp className="h-4 w-4" />
                      选择多个文件入库
                    </button>
                    <button
                      type="button"
                      disabled={importing}
                      onClick={() => folderInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-xs font-medium text-[var(--ink-strong)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
                    >
                      <FolderOpen className="h-4 w-4" />
                      选择整个文件夹入库
                    </button>
                  </div>
                </div>
              )}

              {importMode === "paste" && (
                <form onSubmit={handlePasteSubmit} className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-deep)]/65 p-5">
                  <input
                    value={pasteTitle}
                    onChange={(e) => setPasteTitle(e.target.value)}
                    placeholder="标题（可选，如：2026-11-24 收盘复盘）"
                    className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--ink-strong)] placeholder:text-[var(--ink-dim)] focus:border-[var(--accent)] focus:outline-none"
                  />
                  <textarea
                    rows={7}
                    value={pasteBody}
                    onChange={(e) => setPasteBody(e.target.value)}
                    placeholder="直接粘贴你写好的复盘笔记、盘后总结或微信聊天记录…"
                    className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2.5 text-xs leading-6 text-[var(--ink-strong)] placeholder:text-[var(--ink-dim)] focus:border-[var(--accent)] focus:outline-none"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-[var(--ink-dim)]">存入后可继续切换文件或链接渠道追加</span>
                    <button
                      type="submit"
                      disabled={importing}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent)]/50 bg-[var(--surface)] px-4 py-2 text-xs font-semibold text-[var(--accent)] transition hover:bg-[var(--accent-soft)] disabled:opacity-50"
                    >
                      {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardPaste className="h-4 w-4" />}
                      {importing ? "正在存入…" : "存入知识库"}
                    </button>
                  </div>
                </form>
              )}

              {importMode === "url" && (
                <form onSubmit={handleUrlSubmit} className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-deep)]/65 p-5">
                  <textarea
                    rows={6}
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder={"粘贴雪球专栏、微信公众号等文章链接（一行一条，支持批量抓取）\nhttps://mp.weixin.qq.com/s/..."}
                    className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2.5 font-mono text-xs leading-6 text-[var(--ink-strong)] placeholder:text-[var(--ink-dim)] focus:border-[var(--accent)] focus:outline-none"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-[var(--ink-dim)]">抓取后可继续从本地文件或云端平台补充</span>
                    <button
                      type="submit"
                      disabled={importing}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent)]/50 bg-[var(--surface)] px-4 py-2 text-xs font-semibold text-[var(--accent)] transition hover:bg-[var(--accent-soft)] disabled:opacity-50"
                    >
                      {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
                      {importing ? "正在抓取…" : "抓取并存入"}
                    </button>
                  </div>
                </form>
              )}
            </div>

            {error && (
              <div className="mt-4 rounded-lg border border-[var(--rose)]/35 bg-[var(--rose-soft)] px-3.5 py-2 text-xs text-[var(--rose)]">
                {error}
              </div>
            )}

            {/* Cloud Sync Strip */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)]/70 px-4 py-2.5 text-xs">
              <div className="flex items-center gap-2 text-[var(--ink-muted)]">
                <Cloud className="h-4 w-4 shrink-0 text-[var(--cyan)]" />
                <span>笔记在飞书、Notion、语雀、腾讯文档、ima、有道或印象笔记？</span>
              </div>
              <Link
                href="/sync?from=onboarding"
                onClick={beforeLeaveToSync}
                className="inline-flex items-center gap-1 font-medium text-[var(--cyan)] hover:underline"
              >
                前往云端同步中心拉取 →
              </Link>
            </div>

            {/* GLOBAL INGEST COUNTER & UNIFIED WEAVE BAR */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-2)]/85 px-5 py-4">
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--ink-strong)]">
                    <FileText className="h-4 w-4 text-[var(--accent)]" />
                    当前库内已备好：
                    <span className="font-mono text-base text-[var(--accent)]">{totalDocs}</span> 篇复盘
                  </span>

                  {lastBatch && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--emerald-soft)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--emerald)]">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      本次新增 +{lastBatch.count} 篇（{lastBatch.source}）
                    </span>
                  )}
                </div>

                {batchLogs.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--ink-muted)]">
                    <span>已抓取记录：</span>
                    {batchLogs.slice(-4).map((b) => (
                      <span
                        key={b.id}
                        className="rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[10px]"
                      >
                        {b.source} +{b.count}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-[var(--ink-dim)]">
                    可随时在文件、正文粘贴、网页链接和云同步之间切换追加；准备充分后再点右侧「开始织脉」。
                  </p>
                )}
              </div>

              <button
                type="button"
                disabled={totalDocs === 0 || importing}
                onClick={startGlobalWeave}
                className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition ${
                  totalDocs > 0 && !importing
                    ? "bg-[var(--accent-strong)] text-white shadow-sm hover:bg-[var(--accent)]"
                    : "cursor-not-allowed border border-[var(--border)] bg-[var(--surface)] text-[var(--ink-dim)]"
                }`}
              >
                <Sparkles className="h-4 w-4" />
                {totalDocs > 0 ? `开始织脉（${totalDocs} 篇）` : "请先入库至少 1 篇"}
                {totalDocs > 0 && <ArrowRight className="h-4 w-4" />}
              </button>
            </div>

            {/* Footer Navigation */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="inline-flex items-center gap-1 text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                改一下库名
              </button>
              <button
                type="button"
                onClick={handleSkip}
                className="text-[11px] text-[var(--ink-dim)] transition hover:text-[var(--ink-strong)]"
              >
                暂时手头没有文件，先进入工作台 →
              </button>
            </div>
          </div>
        )}

        {/* ==================== STEP 3: WEAVING TRANSITION -> REAL RESULT ==================== */}
        {step === 3 && (
          <div className="tl-hero-canvas relative overflow-hidden p-8 text-center sm:p-12">
            <div className="pointer-events-none absolute top-1/2 left-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--hero-glow)] blur-3xl" />

            {step3Phase === "weaving" ? (
              <div key="weaving-anim" className="relative mx-auto max-w-md py-6">
                <svg viewBox="0 0 280 180" className="mx-auto h-44 w-full" aria-hidden="true">
                  <circle cx="140" cy="90" r="68" fill="none" stroke="var(--graph-ring)" strokeDasharray="3 4" />
                  <circle cx="140" cy="90" r="38" fill="none" stroke="var(--graph-ring)" strokeDasharray="2 3" />
                  {[0, 1, 2, 3, 4, 5].map((idx) => {
                    const ang = -Math.PI / 2 + (idx / 6) * Math.PI * 2;
                    const dist = idx % 2 === 0 ? 68 : 44;
                    const nx = 140 + Math.cos(ang) * dist;
                    const ny = 90 + Math.sin(ang) * dist;
                    return (
                      <g key={idx}>
                        <line
                          x1="140"
                          y1="90"
                          x2={nx}
                          y2={ny}
                          stroke="var(--accent)"
                          strokeWidth="1.6"
                          style={{ ["--dash-len" as string]: "90", animationDelay: `${idx * 110}ms` }}
                          className="tl-draw-stroke"
                        />
                        <circle
                          cx={nx}
                          cy={ny}
                          r="6"
                          fill="var(--surface)"
                          stroke="var(--accent)"
                          strokeWidth="2"
                          style={{ animationDelay: `${180 + idx * 120}ms` }}
                          className="tl-node-pop"
                        />
                      </g>
                    );
                  })}
                  <circle cx="140" cy="90" r="14" fill="var(--accent)" className="tl-pulse-ring" />
                </svg>
                <div className="mt-2 text-base font-bold text-[var(--ink-strong)]">
                  正在为你编织「{vaultName}」的 {totalDocs} 篇复盘脉络
                </div>
                <p className="mt-1.5 font-mono text-xs text-[var(--accent)]">{weavingStageText}</p>
              </div>
            ) : (
              <div key="weaving-result" className="tl-fade-up relative mx-auto max-w-2xl space-y-6">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--emerald-soft)] px-3 py-1 text-xs font-semibold text-[var(--emerald)]">
                    <Sparkles className="h-3.5 w-3.5" />
                    已完成 {totalDocs} 篇复盘织脉
                  </span>
                  <h2 className="mt-3 text-2xl font-bold tracking-tight text-[var(--ink-strong)]">
                    「{vaultName}」的双链星图已经点亮
                  </h2>
                </div>

                {/* Real Harvest Metrics */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="tl-surface-elevated rounded-xl p-3.5">
                    <div className="font-mono text-2xl font-bold text-[var(--ink-strong)]">
                      {liveIndex?.counts.total ?? 0}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--ink-muted)]">篇复盘入库</div>
                  </div>
                  <div className="tl-surface-elevated rounded-xl p-3.5">
                    <div className="font-mono text-2xl font-bold text-[var(--ink-strong)]">
                      {liveIndex?.counts.years ?? 0}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--ink-muted)]">个年份节点</div>
                  </div>
                  <div className="tl-surface-elevated rounded-xl p-3.5">
                    <div className="font-mono text-2xl font-bold text-[var(--cyan)]">
                      {liveIndex?.counts.topics ?? 0}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--ink-muted)]">个交易概念</div>
                  </div>
                  <div className="tl-surface-elevated rounded-xl p-3.5">
                    <div className="font-mono text-2xl font-bold text-[var(--accent)]">
                      {liveIndex?.counts.links ?? 0}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--ink-muted)]">条双向连线</div>
                  </div>
                </div>

                {/* Extracted Concepts & Docs Preview */}
                {liveIndex && (liveIndex.topics.length > 0 || liveIndex.documents.length > 0) && (
                  <div className="tl-surface-elevated space-y-3 rounded-xl p-4 text-left">
                    {liveIndex.topics.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--ink-muted)]">
                          <Hash className="h-3.5 w-3.5 text-[var(--cyan)]" />
                          已识别概念：
                        </span>
                        {liveIndex.topics.slice(0, 8).map((t) => (
                          <span
                            key={t}
                            className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--ink-strong)]"
                          >
                            #{t}
                          </span>
                        ))}
                      </div>
                    )}
                    {liveIndex.documents.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {liveIndex.documents.slice(0, 3).map((d) => (
                          <span
                            key={d.doc_id}
                            className="inline-flex max-w-[220px] items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] text-[var(--ink-muted)]"
                          >
                            <FileText className="h-3 w-3 shrink-0 text-[var(--accent)]" />
                            <span className="truncate">{d.title}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={goToGraph}
                    className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent-strong)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent)]"
                  >
                    <Network className="h-4 w-4" />
                    进入双链星图查看成品
                    <ArrowRight className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-3 text-xs font-medium text-[var(--ink-strong)] transition hover:border-[var(--accent)]"
                  >
                    继续补充导入
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
