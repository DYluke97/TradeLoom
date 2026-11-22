"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BookOpen,
  Calendar,
  CandlestickChart,
  CheckCircle2,
  Cloud,
  Download,
  FolderGit2,
  FolderKanban,
  Hash,
  Layers,
  Loader2,
  Network,
  Play,
  Plus,
  Settings,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import CreateVaultModal, { dispatchVaultChanged } from "@/components/CreateVaultModal";
import type { VaultIndex } from "@/lib/vault-builder";
import type { VaultsOverview } from "@/lib/vault-types";

export default function HomeWorkspace() {
  const router = useRouter();
  const [overview, setOverview] = useState<VaultsOverview | null>(null);
  const [vault, setVault] = useState<VaultIndex | null>(null);
  const [vaultDir, setVaultDir] = useState("");
  const [loading, setLoading] = useState(true);
  const [creatingDemo, setCreatingDemo] = useState(false);
  const [skippingLedger, setSkippingLedger] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const loadAll = useCallback(async () => {
    try {
      const [ovRes, vRes] = await Promise.all([
        fetch("/api/vaults", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/vault", { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (ovRes.ok) setOverview(ovRes);
      if (vRes.ok) {
        setVault(vRes.index);
        setVaultDir(vRes.vaultDir || "");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function handleEnterDemo() {
    setCreatingDemo(true);
    setNotice("");
    try {
      const res = await fetch("/api/vaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create-demo", activate: true }),
      });
      const data = await res.json();
      if (data.ok) {
        setOverview(data);
        dispatchVaultChanged(data.activeVaultId);
        await loadAll();
        setNotice("体验示范库已就绪！你可以直接点看「双链星图」「本库账本」或「交易手册」预览最终效果。");
      } else {
        setNotice(data.error || "生成体验示范库失败");
      }
    } finally {
      setCreatingDemo(false);
    }
  }

  async function handleSkipLedger() {
    if (!overview) return;
    setSkippingLedger(true);
    try {
      const res = await fetch("/api/vaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          id: overview.activeVaultId,
          skipLedgerStep: true,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setOverview(data);
      }
    } finally {
      setSkippingLedger(false);
    }
  }

  async function handleSwitchVault(id: string) {
    setSwitchingId(id);
    try {
      const res = await fetch("/api/vaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "switch", id }),
      });
      const data = await res.json();
      if (data.ok) {
        setOverview(data);
        dispatchVaultChanged(data.activeVaultId);
        router.refresh();
      }
    } finally {
      setSwitchingId(null);
    }
  }

  if (loading && !overview) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-xs text-[var(--ink-muted)]">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--cyan)]" />
          正在载入本地复盘知识库...
        </div>
      </div>
    );
  }

  const activeVault = overview?.activeVault;
  const activeColor = activeVault?.color || "#7c4dff";
  const onboarding = overview?.onboarding;
  const isFresh = Boolean(onboarding?.isFreshInstall);

  /* ==================== STAGE 0: BRAND-NEW EMPTY INSTALL WELCOME SCREEN ==================== */
  if (isFresh) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 py-4">
        {/* Hero Value Prop */}
        <section className="scifi-card relative overflow-hidden rounded-2xl p-7 text-center sm:p-9">
          <div className="pointer-events-none absolute -top-24 left-1/2 h-56 w-96 -translate-x-1/2 rounded-full bg-[var(--accent)]/15 blur-3xl" />
          <div className="relative">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-[var(--cyan)]/35 bg-[var(--cyan-soft)] px-3 py-1 text-[11px] font-medium text-[var(--cyan)]">
              <ShieldCheck className="h-3.5 w-3.5" />
              本地离线优先 · 数据 100% 留在你自己的电脑
            </div>
            <h1 className="mt-4 bg-gradient-to-r from-[#f8fafc] via-[#e2d9ff] to-[#a5f3fc] bg-clip-text text-2xl font-bold tracking-tight text-transparent sm:text-3xl">
              把零散的交易复盘，沉淀成经得起检验的个人交易手册
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-[var(--ink-muted)]">
              支持把本地文档与 9 大笔记平台的复盘自动织成 <strong className="text-[var(--ink)]">Obsidian 双向链接星图</strong>，
              用独立交割账本防止「复盘嘴盘」，再让 AI 按时间阶段提炼出可执行的交易规则手册。
            </p>

            {/* 3 Concise Visual Pillars */}
            <div className="mx-auto mt-5 grid max-w-2xl gap-2.5 text-left sm:grid-cols-3">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-deep)]/85 p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--cyan)]">
                  <Network className="h-3.5 w-3.5" />
                  1. 复盘自动成网
                </div>
                <p className="mt-1 text-[11px] leading-5 text-[var(--ink-dim)]">
                  按年/月/日和交易关键词自动连线，再多老复盘也不再吃灰。
                </p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-deep)]/85 p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--amber)]">
                  <CandlestickChart className="h-3.5 w-3.5" />
                  2. 实盘账本防嘴盘
                </div>
                <p className="mt-1 text-[11px] leading-5 text-[var(--ink-dim)]">
                  独立导入交割单与净值，K 线标出买卖点，照出知行偏离。
                </p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-deep)]/85 p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--emerald)]">
                  <BookOpen className="h-3.5 w-3.5" />
                  3. 多库并行提炼
                </div>
                <p className="mt-1 text-[11px] leading-5 text-[var(--ink-dim)]">
                  短线、基本面、期货或大师体系各自建库，互不串味独立演进。
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ONLY 2 Clear Entry Paths */}
        <section className="grid gap-4 md:grid-cols-2">
          {/* Path A: 1-Min Demo Sandbox */}
          <div className="scifi-card relative flex flex-col justify-between rounded-2xl border-[var(--cyan)]/45 p-6 shadow-[0_0_28px_rgba(34,211,238,0.1)]">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--cyan-soft)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--cyan)]">
                  <Sparkles className="h-3 w-3" />
                  推荐新用户 · 零配置体验
                </span>
                <span className="font-mono text-[10px] text-[var(--ink-dim)]">约 1 分钟</span>
              </div>
              <h2 className="mt-3 text-lg font-bold text-[#f8fafc]">先看一眼最终成品长什么样</h2>
              <p className="mt-2 text-xs leading-6 text-[var(--ink-muted)]">
                一键创建独立的<strong className="text-[var(--ink)]">「体验示范库」</strong>，内含：
              </p>
              <ul className="mt-2.5 space-y-1.5 text-xs text-[var(--ink-muted)]">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--cyan)]" />
                  <span>6 篇完整 A 股复盘样本 + 已织好的双链知识星图</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--cyan)]" />
                  <span>配套示例交割单与净值曲线（含个股买卖点回放）</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--cyan)]" />
                  <span>1 份免配大模型即可预览的《双轨实盘交易手册 v1.0》</span>
                </li>
              </ul>
            </div>

            <div className="mt-6 space-y-2">
              <button
                type="button"
                disabled={creatingDemo}
                onClick={handleEnterDemo}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#0891b2] to-[#22d3ee] px-4 py-2.5 text-xs font-bold text-[#041019] shadow-[0_0_20px_rgba(34,211,238,0.3)] transition hover:brightness-110 disabled:opacity-50"
              >
                {creatingDemo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {creatingDemo ? "正在构建独立体验示范库（含账本与手册）..." : "一键进入体验示范库"}
              </button>
              <p className="text-center text-[11px] text-[var(--ink-dim)]">
                示范库完全独立沙盒运行，看完可随时一键删除，绝不污染正式库
              </p>
            </div>
          </div>

          {/* Path B: Create First Real Vault */}
          <div className="scifi-card flex flex-col justify-between rounded-2xl p-6">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--accent)]">
                  <FolderGit2 className="h-3 w-3" />
                  直接开始使用
                </span>
                <span className="font-mono text-[10px] text-[var(--ink-dim)]">30 秒建库</span>
              </div>
              <h2 className="mt-3 text-lg font-bold text-[#f8fafc]">创建我的第 1 个方法论知识库</h2>
              <p className="mt-2 text-xs leading-6 text-[var(--ink-muted)]">
                直接为你的某一套交易体系建一个专属知识库，系统自动配好对应关键词词典与默认提炼规则：
              </p>
              <ul className="mt-2.5 space-y-1.5 text-xs text-[var(--ink-muted)]">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
                  <span>4 套开箱模板：短线情绪 / 价值基本面 / 趋势波段 / 通用空白</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
                  <span>支持直接拖入 Word/PDF/MD/HTML，或挂载本机已有 Obsidian 目录</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
                  <span>支持飞书、Notion、语雀、滴答、腾讯文档、ima、有道、OneNote、印象笔记</span>
                </li>
              </ul>
            </div>

            <div className="mt-6 space-y-2">
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#7c4dff] to-[#9b6bff] px-4 py-2.5 text-xs font-bold text-white shadow-[0_0_20px_rgba(124,77,255,0.35)] transition hover:brightness-110"
              >
                <Plus className="h-4 w-4" />
                创建我的第 1 个知识库
              </button>
              <p className="text-center text-[11px] text-[var(--ink-dim)]">
                也可直接使用默认主库，随时在顶部一键新建第 2、第 3 个并行库
              </p>
            </div>
          </div>
        </section>

        {notice && (
          <div className="rounded-xl border border-[var(--cyan)]/35 bg-[var(--cyan-soft)]/50 px-4 py-2.5 text-center text-xs text-[var(--cyan)]">
            {notice}
          </div>
        )}

        <CreateVaultModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          templates={overview?.templates}
          existingVaults={overview?.vaults}
          onCreated={(_v, nextOverview) => {
            setOverview(nextOverview);
            loadAll();
          }}
        />
      </div>
    );
  }

  /* ==================== ACTIVE VAULT WORKSPACE DASHBOARD ==================== */
  const steps = onboarding?.activeVaultSteps;
  const stats = activeVault?.stats;
  const hasDocs = (stats?.docsCount ?? 0) > 0;
  const hasManuals = (stats?.manualsCount ?? 0) > 0;

  const primaryCta = !hasDocs
    ? { href: "/vault", label: "导入复盘素材", icon: Upload }
    : !hasManuals
      ? { href: "/synthesize", label: "开始提炼交易手册", icon: Layers }
      : { href: "/manuals", label: "查看交易手册", icon: BookOpen };

  const secondaryCta = !hasDocs
    ? { href: "/sync", label: "从 9 大云端平台同步", icon: Cloud }
    : { href: "/vault?view=graph", label: "打开双链星图", icon: Network };

  const PrimaryIcon = primaryCta.icon;
  const SecondaryIcon = secondaryCta.icon;

  return (
    <div className="space-y-5">
      {/* Compact Active Vault Header */}
      <section className="scifi-card relative overflow-hidden rounded-xl p-5 sm:p-6">
        <div
          className="pointer-events-none absolute -top-20 right-16 h-48 w-64 rounded-full opacity-15 blur-3xl"
          style={{ backgroundColor: activeColor }}
        />

        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
                style={{
                  borderColor: `${activeColor}66`,
                  backgroundColor: `${activeColor}1a`,
                  color: "#f8fafc",
                }}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: activeColor }} />
                当前知识库
              </span>
              {activeVault?.isDemo && (
                <span className="rounded-full border border-[var(--cyan)]/40 bg-[var(--cyan-soft)] px-2.5 py-0.5 text-[10px] font-medium text-[var(--cyan)]">
                  独立示范沙盒
                </span>
              )}
              {activeVault?.paths.isExternal && (
                <span className="rounded-full border border-[var(--amber)]/40 bg-[var(--amber-soft)] px-2.5 py-0.5 text-[10px] font-medium text-[var(--amber)]">
                  挂载外部目录
                </span>
              )}
            </div>

            <h1 className="mt-3 text-xl font-bold tracking-tight text-[#f8fafc] sm:text-2xl">
              {activeVault?.name ?? "我的主复盘库"}
            </h1>
            <p className="mt-1.5 text-xs leading-6 text-[var(--ink-muted)]">
              {activeVault?.description || "独立 Obsidian 双链复盘空间：拥有专属复盘原稿、关键词词典、实盘账本与方法论手册演进线。"}
            </p>

            {/* Clean 2-button focus */}
            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <Link
                href={primaryCta.href}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#7c4dff] to-[#22d3ee] px-4 py-2 text-xs font-semibold text-white shadow-[0_0_18px_rgba(34,211,238,0.28)] transition hover:brightness-110"
              >
                <PrimaryIcon className="h-3.5 w-3.5" />
                {primaryCta.label}
              </Link>
              <Link
                href={secondaryCta.href}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)]/90 px-4 py-2 text-xs font-medium text-[var(--ink)] transition hover:border-[var(--cyan)] hover:text-[var(--cyan)]"
              >
                <SecondaryIcon className="h-3.5 w-3.5" />
                {secondaryCta.label}
              </Link>
              <a
                href={`/api/vault/export?vaultId=${encodeURIComponent(activeVault?.id ?? "default")}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/60 px-3 py-2 text-xs text-[var(--ink-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--ink)]"
                title="打包下载本库的独立标准 Obsidian 知识库 (.zip)"
              >
                <Download className="h-3.5 w-3.5" />
                导出本库 Obsidian
              </a>
            </div>
            {notice && <p className="mt-3 text-xs text-[var(--emerald)]">{notice}</p>}
          </div>

          {/* 2x2 Clean Active Vault Stats */}
          <div className="grid min-w-[260px] grid-cols-2 gap-2.5">
            <Link
              href="/vault"
              className="rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)]/85 p-3 transition hover:border-[var(--cyan)]/50"
            >
              <div className="text-[11px] text-[var(--ink-dim)]">本库复盘笔记</div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="font-mono text-2xl font-bold text-[#f8fafc]">{stats?.docsCount ?? 0}</span>
                <span className="font-mono text-xs text-[var(--amber)]">{stats?.yearsCount ?? 0} 年</span>
              </div>
            </Link>
            <Link
              href="/vault?view=graph"
              className="rounded-lg border border-[var(--accent)]/25 bg-[var(--bg-deep)]/85 p-3 transition hover:border-[var(--accent)]/60"
            >
              <div className="text-[11px] text-[var(--ink-dim)]">双链连线数</div>
              <div className="mt-1 font-mono text-2xl font-bold text-[var(--accent)]">
                {stats?.linksCount ?? 0}
              </div>
            </Link>
            <Link
              href="/ledger"
              className="rounded-lg border border-[var(--amber)]/25 bg-[var(--bg-deep)]/85 p-3 transition hover:border-[var(--amber)]/60"
            >
              <div className="text-[11px] text-[var(--ink-dim)]">本库实盘交割</div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="font-mono text-2xl font-bold text-[var(--amber)]">{stats?.tradesCount ?? 0}</span>
                <span className="text-[10px] text-[var(--ink-dim)]">笔</span>
              </div>
            </Link>
            <Link
              href="/manuals"
              className="rounded-lg border border-[var(--emerald)]/25 bg-[var(--bg-deep)]/85 p-3 transition hover:border-[var(--emerald)]/60"
            >
              <div className="text-[11px] text-[var(--ink-dim)]">本库交易手册</div>
              <div className="mt-1 font-mono text-2xl font-bold text-[var(--emerald)]">
                {stats?.manualsCount ?? 0}
              </div>
            </Link>
          </div>
        </div>

        {vaultDir && (
          <div className="relative mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/80 px-3 py-1.5 text-[11px] text-[var(--ink-dim)]">
            <div className="truncate">
              本库 Obsidian 目录：<code className="text-[var(--cyan)]">{vaultDir}</code>
            </div>
            <span>可直接用 Obsidian 打开此目录 · 按 Ctrl+K 搜库或搜笔记</span>
          </div>
        )}
      </section>

      {/* 4-Step Guided Onboarding Progress Bar (auto-hides once all 4 steps complete) */}
      {steps && steps.completedCount < steps.totalCount && (
        <section className="scifi-card rounded-xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-[#f8fafc]">
                <Sparkles className="h-4 w-4 text-[var(--cyan)]" />
                新手上手路线（已完成 {steps.completedCount} / {steps.totalCount} 步）
              </div>
              <p className="mt-0.5 text-[11px] text-[var(--ink-dim)]">
                跟着下面 4 步走一遍，即可从零沉淀出「{activeVault?.name}」的第 1 版个人交易手册；完成后此引导条会自动收起。
              </p>
            </div>
            <div className="h-2 w-36 overflow-hidden rounded-full bg-[var(--bg-deep)]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#7c4dff] to-[#22d3ee] transition-all"
                style={{ width: `${(steps.completedCount / steps.totalCount) * 100}%` }}
              />
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* Step 1 */}
            <div
              className={`flex flex-col justify-between rounded-xl border p-3.5 ${
                steps.hasReviews
                  ? "border-[var(--emerald)]/35 bg-[var(--emerald-soft)]/25"
                  : "border-[var(--cyan)]/45 bg-[var(--bg-deep)]/90"
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-semibold text-[var(--cyan)]">STEP 1</span>
                  {steps.hasReviews && <CheckCircle2 className="h-4 w-4 text-[var(--emerald)]" />}
                </div>
                <div className="mt-1.5 text-xs font-semibold text-[#f8fafc]">导入你的复盘素材</div>
                <p className="mt-1 text-[11px] leading-5 text-[var(--ink-muted)]">
                  {steps.hasReviews
                    ? `已入库 ${stats?.docsCount ?? 0} 篇，自动织成 ${stats?.linksCount ?? 0} 条双链。`
                    : "拖入本地 Word/PDF/MD/HTML，或从 9 大云端平台同步。"}
                </p>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Link
                  href="/vault"
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--ink)] hover:border-[var(--cyan)] hover:text-[var(--cyan)]"
                >
                  {steps.hasReviews ? "继续导入" : "去导入文件"}
                </Link>
                <Link
                  href="/sync"
                  className="inline-flex items-center gap-1 text-[11px] text-[var(--cyan)] hover:underline"
                >
                  云端同步 →
                </Link>
              </div>
            </div>

            {/* Step 2 */}
            <div
              className={`flex flex-col justify-between rounded-xl border p-3.5 ${
                steps.hasLedgerOrSkipped
                  ? "border-[var(--emerald)]/35 bg-[var(--emerald-soft)]/25"
                  : "border-[var(--border-strong)] bg-[var(--bg-deep)]/90"
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-semibold text-[var(--amber)]">STEP 2 · 可选</span>
                  {steps.hasLedgerOrSkipped && <CheckCircle2 className="h-4 w-4 text-[var(--emerald)]" />}
                </div>
                <div className="mt-1.5 text-xs font-semibold text-[#f8fafc]">绑定本库实盘交割账本</div>
                <p className="mt-1 text-[11px] leading-5 text-[var(--ink-muted)]">
                  {activeVault?.skipLedgerStep
                    ? "已标记为纯学习/非实盘库，提炼时不会混入无关交割单。"
                    : (stats?.tradesCount ?? 0) > 0 || (stats?.dailyRecordsCount ?? 0) > 0
                      ? `本库已记录 ${stats?.tradesCount ?? 0} 笔成交与 ${stats?.dailyRecordsCount ?? 0} 日净值。`
                      : "仅作用于当前库，用于实盘证伪防嘴盘；纯学习库可跳过。"}
                </p>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Link
                  href="/ledger"
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--ink)] hover:border-[var(--amber)] hover:text-[var(--amber)]"
                >
                  去导入账本
                </Link>
                {!steps.hasLedgerOrSkipped && (
                  <button
                    type="button"
                    disabled={skippingLedger}
                    onClick={handleSkipLedger}
                    className="text-[11px] text-[var(--ink-dim)] hover:text-[var(--ink)]"
                  >
                    {skippingLedger ? "处理中..." : "纯学习库，跳过"}
                  </button>
                )}
              </div>
            </div>

            {/* Step 3 */}
            <div
              className={`flex flex-col justify-between rounded-xl border p-3.5 ${
                steps.hasLlm
                  ? "border-[var(--emerald)]/35 bg-[var(--emerald-soft)]/25"
                  : "border-[var(--border-strong)] bg-[var(--bg-deep)]/90"
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-semibold text-[var(--accent)]">STEP 3 · 全库通用</span>
                  {steps.hasLlm && <CheckCircle2 className="h-4 w-4 text-[var(--emerald)]" />}
                </div>
                <div className="mt-1.5 text-xs font-semibold text-[#f8fafc]">接入你的 AI 大模型</div>
                <p className="mt-1 text-[11px] leading-5 text-[var(--ink-muted)]">
                  {steps.hasLlm
                    ? "全局 AI 大模型已接通，所有并行知识库共享无需重配。"
                    : "支持 DeepSeek / 硅基流动 / OpenAI / 本地 Ollama，配一次全库通用。"}
                </p>
              </div>
              <div className="mt-3">
                <Link
                  href="/settings"
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--ink)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  <Settings className="h-3 w-3" />
                  {steps.hasLlm ? "查看模型设置" : "去配置 AI 模型"}
                </Link>
              </div>
            </div>

            {/* Step 4 */}
            <div
              className={`flex flex-col justify-between rounded-xl border p-3.5 ${
                steps.hasManual
                  ? "border-[var(--emerald)]/35 bg-[var(--emerald-soft)]/25"
                  : "border-[var(--border-strong)] bg-[var(--bg-deep)]/90"
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-semibold text-[var(--emerald)]">STEP 4</span>
                  {steps.hasManual && <CheckCircle2 className="h-4 w-4 text-[var(--emerald)]" />}
                </div>
                <div className="mt-1.5 text-xs font-semibold text-[#f8fafc]">生成本库交易手册</div>
                <p className="mt-1 text-[11px] leading-5 text-[var(--ink-muted)]">
                  {steps.hasManual
                    ? `已沉淀 ${stats?.manualsCount ?? 0} 份手册，支持持续叠加演进。`
                    : "框选一段时间复盘，提炼可逐字溯源的方法演变轴与执行规则。"}
                </p>
              </div>
              <div className="mt-3">
                <Link
                  href={steps.hasManual ? "/manuals" : "/synthesize"}
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--ink)] hover:border-[var(--emerald)] hover:text-[var(--emerald)]"
                >
                  {steps.hasManual ? "查看手册列表" : "去提炼 v1.0 手册"}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Multi-Year Timeline & Topic Hub (for Active Vault) */}
      {vault && (vault.timelineTree.length > 0 || vault.topics.length > 0) && (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
          {/* Timeline */}
          <div className="scifi-card rounded-xl p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ink)]">
                <Calendar className="h-4 w-4 text-[var(--amber)]" />
                本库复盘时间轴（点击直达年/月整理目录）
              </div>
              <Link href="/synthesize" className="text-[11px] text-[var(--cyan)] hover:underline">
                按阶段框选提炼 →
              </Link>
            </div>

            <div className="mt-4 space-y-3">
              {vault.timelineTree.map((yr) => (
                <div key={yr.year} className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/75 p-3">
                  <div className="flex items-center justify-between">
                    <Link
                      href={`/vault?card=${encodeURIComponent(`10-时间轴/${yr.year}年.md`)}`} 
                      className="font-mono text-xs font-semibold text-[var(--amber)] hover:underline"
                    >
                      {yr.year} 年（{yr.count} 篇）
                    </Link>
                    <span className="text-[10px] text-[var(--ink-dim)]">{yr.months.length} 个活跃月份</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {yr.months.map((m) => (
                      <Link
                        key={m.month}
                        href={`/vault?card=${encodeURIComponent(`10-时间轴/${m.month}.md`)}`} 
                        className="rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-0.5 font-mono text-[11px] text-[var(--ink-muted)] transition hover:border-[var(--cyan)] hover:text-[var(--cyan)]"
                      >
                        {m.month.slice(5)}月 · {m.count}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Topic Hub + Latest Manual */}
          <div className="space-y-4">
            {stats?.latestManualTitle && (
              <div className="scifi-card rounded-xl border-[var(--emerald)]/30 p-5">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--emerald)]">
                    <BookOpen className="h-4 w-4" />
                    本库最新交易手册
                  </span>
                  <Link href="/manuals" className="text-[11px] text-[var(--cyan)] hover:underline">
                    全部版本 →
                  </Link>
                </div>
                <div className="mt-2.5 text-sm font-semibold text-[#f8fafc]">{stats.latestManualTitle}</div>
                {stats.latestManualAt && (
                  <div className="mt-1 font-mono text-[10px] text-[var(--ink-dim)]">
                    生成于 {stats.latestManualAt.slice(0, 16).replace("T", " ")}
                  </div>
                )}
                <Link
                  href="/manuals"
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[var(--emerald)]/45 bg-[var(--emerald-soft)]/50 px-3 py-1.5 text-xs font-medium text-[var(--emerald)] transition hover:bg-[var(--emerald)]/20"
                >
                  打开阅读与溯源
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            )}

            <div className="scifi-card rounded-xl p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ink)]">
                  <Hash className="h-4 w-4 text-[var(--cyan)]" />
                  本库高频关键词节点
                </div>
                <Link href="/vault?concepts=1" className="text-[11px] text-[var(--cyan)] hover:underline">
                  管理本库词典 →
                </Link>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {vault.topics.slice(0, 20).map((topic) => {
                  const cnt = vault.documents.filter((d) => d.tags.includes(topic) || d.auto_concepts.includes(topic)).length;
                  return (
                    <Link
                      key={topic}
                      href={`/vault?card=${encodeURIComponent(`30-主题/${topic}.md`)}`}
                      className="inline-flex items-center gap-1 rounded-full border border-[var(--border-strong)] bg-[var(--bg-deep)] px-2.5 py-1 text-[11px] text-[var(--ink-muted)] transition hover:border-[var(--cyan)] hover:text-[var(--cyan)]"
                    >
                      <span>#{topic}</span>
                      {cnt > 0 && <span className="font-mono text-[10px] text-[var(--ink-dim)]">{cnt}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Parallel Vaults Quick Strip */}
      <section className="scifi-card rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#f8fafc]">
            <FolderKanban className="h-4 w-4 text-[var(--accent)]" />
            多知识库并行工作台（共 {overview?.vaults.length ?? 1} 个独立双链库）
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--cyan)]/45 bg-[var(--cyan-soft)]/50 px-2.5 py-1 text-[11px] font-medium text-[var(--cyan)] transition hover:bg-[var(--cyan)]/20"
            >
              <Plus className="h-3 w-3" />
              新建并行知识库
            </button>
            <Link href="/vaults" className="text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink)]">
              全部大厅 →
            </Link>
          </div>
        </div>

        <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {(overview?.vaults ?? []).map((v) => {
            const isCur = v.id === overview?.activeVaultId;
            return (
              <button
                key={v.id}
                type="button"
                disabled={isCur || Boolean(switchingId)}
                onClick={() => handleSwitchVault(v.id)}
                className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-left transition ${
                  isCur
                    ? "border-[var(--cyan)]/50 bg-[var(--surface-2)]"
                    : "border-[var(--border)] bg-[var(--bg-deep)]/80 hover:border-[var(--border-strong)] hover:bg-[var(--surface)]"
                }`}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: v.color }} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-semibold text-[#f8fafc]">{v.name}</span>
                      {isCur && (
                        <span className="rounded bg-[var(--emerald-soft)] px-1.5 py-0.2 text-[9px] text-[var(--emerald)]">
                          当前
                        </span>
                      )}
                      {v.isDemo && (
                        <span className="rounded bg-[var(--cyan-soft)] px-1.5 py-0.2 text-[9px] text-[var(--cyan)]">
                          示范
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-[var(--ink-dim)]">
                      {v.stats.docsCount} 篇复盘 · {v.stats.tradesCount} 笔交割 · {v.stats.manualsCount} 本手册
                    </div>
                  </div>
                </div>
                {switchingId === v.id ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--cyan)]" />
                ) : !isCur ? (
                  <span className="shrink-0 text-[11px] text-[var(--cyan)]">切换 →</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </section>

      <CreateVaultModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        templates={overview?.templates}
        existingVaults={overview?.vaults}
        onCreated={(_v, nextOverview) => {
          setOverview(nextOverview);
          loadAll();
        }}
      />
    </div>
  );
}
