"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cloud,
  Download,
  FolderKanban,
  Hash,
  Layers,
  Loader2,
  Network,
  Plus,
  RotateCcw,
  Settings,
  Sparkles,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import BrandSplashIntro from "@/components/BrandSplashIntro";
import CreateVaultModal, { dispatchVaultChanged } from "@/components/CreateVaultModal";
import LoomHeroCanvas, { type HeroLedgerLite } from "@/components/LoomHeroCanvas";
import OnboardingWizard, { ONBOARDING_STEP_KEY } from "@/components/OnboardingWizard";
import { isTourDismissed, startGuidedTour, TOUR_EVENT } from "@/lib/onboarding-tour";
import type { SynthesisReport } from "@/lib/synthesis";
import type { VaultIndex } from "@/lib/vault-builder";
import type { VaultOnboardingSteps, VaultsOverview } from "@/lib/vault-types";

function nextOnboardingHint(steps: VaultOnboardingSteps): { label: string; href: string } {
  if (!steps.hasReviews) return { label: "导入第 1 批复盘", href: "/vault" };
  if (!steps.hasLedgerOrSkipped) return { label: "绑定实盘账本或跳过", href: "/ledger" };
  if (!steps.hasLlm) return { label: "选择 AI / Agent 引擎", href: "/settings" };
  return { label: "提炼 v1.0 交易手册", href: "/synthesize" };
}

export default function HomeWorkspace() {
  const router = useRouter();
  const [overview, setOverview] = useState<VaultsOverview | null>(null);
  const [vault, setVault] = useState<VaultIndex | null>(null);
  const [ledgerLite, setLedgerLite] = useState<HeroLedgerLite | null>(null);
  const [manuals, setManuals] = useState<SynthesisReport[]>([]);
  const [vaultDir, setVaultDir] = useState("");
  const [loading, setLoading] = useState(true);
  const [skippingLedger, setSkippingLedger] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [onboardingExpanded, setOnboardingExpanded] = useState(false);
  const [wizardActive, setWizardActive] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [wizardDismissed, setWizardDismissed] = useState(false);
  const [introReplaySignal, setIntroReplaySignal] = useState(0);

  useEffect(() => {
    try {
      if (isTourDismissed()) {
        setWizardDismissed(true);
        setWizardActive(false);
      } else if (sessionStorage.getItem(ONBOARDING_STEP_KEY) === "2") {
        setWizardActive(true);
        setWizardStep(2);
      }
    } catch {
      /* ignore */
    }
    const onTourChanged = (e: Event) => {
      const custom = e as CustomEvent<{ dismissed?: boolean }>;
      if (custom.detail?.dismissed) {
        setWizardDismissed(true);
        setWizardActive(false);
      }
    };
    window.addEventListener(TOUR_EVENT, onTourChanged);
    return () => window.removeEventListener(TOUR_EVENT, onTourChanged);
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [ovRes, vRes, lRes, mRes] = await Promise.all([
        fetch("/api/vaults", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ ok: false })),
        fetch("/api/vault", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ ok: false })),
        fetch("/api/ledger?mode=lite", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ ok: false })),
        fetch("/api/manuals", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ ok: false })),
      ]);
      if (ovRes.ok) {
        setOverview(ovRes);
        const epoch = String(ovRes.activeVault?.createdAt ?? "");
        if (ovRes.onboarding?.isFreshInstall) {
          try {
            const prevEpoch = sessionStorage.getItem("tradeloom-install-epoch");
            if (epoch && prevEpoch !== epoch) {
              sessionStorage.removeItem(ONBOARDING_STEP_KEY);
              sessionStorage.removeItem("tradeloom-intro-seen");
              sessionStorage.setItem("tradeloom-install-epoch", epoch);
              startGuidedTour();
              setWizardActive(true);
              setWizardStep(1);
              setWizardDismissed(false);
              setIntroReplaySignal((s) => s + 1);
            } else if (!isTourDismissed()) {
              setWizardActive(true);
              startGuidedTour();
            }
          } catch {
            /* ignore */
          }
        } else if (epoch) {
          try {
            sessionStorage.setItem("tradeloom-install-epoch", epoch);
          } catch {
            /* ignore */
          }
        }
      }
      if (vRes.ok) {
        setVault(vRes.index);
        setVaultDir(vRes.vaultDir || "");
      }
      if (lRes.ok) {
        setLedgerLite({
          hasData: Boolean(lRes.hasData),
          benchmarkName: lRes.benchmarkName,
          monthly: lRes.monthly,
          dailyByDate: lRes.dailyByDate,
        });
      }
      if (mRes.ok && Array.isArray(mRes.manuals)) {
        setManuals(mRes.manuals);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const monthlyCadence = useMemo(() => {
    const months = (vault?.timelineTree ?? []).flatMap((y) => y.months);
    const tail = months.slice(0, 12).reverse();
    const maxCnt = Math.max(1, ...tail.map((m) => m.count));
    return tail.map((m) => ({
      month: m.month,
      count: m.count,
      heightPct: Math.max(18, Math.round((m.count / maxCnt) * 100)),
    }));
  }, [vault]);

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
      <>
        <BrandSplashIntro replaySignal={introReplaySignal} />
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-xs text-[var(--ink-muted)]">
            <Loader2 className="h-[17px] w-[17px] animate-spin text-[var(--cyan)]" />
            正在载入本地复盘知识库...
          </div>
        </div>
      </>
    );
  }

  const activeVault = overview?.activeVault;
  const activeColor = activeVault?.color || "#2d5f8b";
  const onboarding = overview?.onboarding;
  const isFresh = Boolean(onboarding?.isFreshInstall);

  if (!wizardDismissed && (isFresh || wizardActive)) {
    return (
      <>
        <BrandSplashIntro replaySignal={introReplaySignal} />
        <OnboardingWizard
          initialVaultName={activeVault?.name}
          initialStep={wizardStep}
          onReplayIntro={() => setIntroReplaySignal((s) => s + 1)}
          onSkipToDashboard={() => {
            setWizardDismissed(true);
            setWizardActive(false);
            loadAll();
          }}
        />
      </>
    );
  }

  const steps = onboarding?.activeVaultSteps;
  const stats = activeVault?.stats;
  const hasDocs = (stats?.docsCount ?? 0) > 0;
  const hasManuals = (stats?.manualsCount ?? 0) > 0;
  const latestManual = manuals[0] ?? null;

  const primaryCta = !hasDocs
    ? { href: "/vault", label: "导入复盘素材", icon: Upload }
    : !hasManuals
      ? { href: "/synthesize", label: "提炼交易手册", icon: Layers }
      : { href: "/manuals", label: "查看交易手册", icon: BookOpen };

  const secondaryCta = !hasDocs
    ? { href: "/sync", label: "云端同步", icon: Cloud }
    : { href: "/vault?view=graph", label: "全屏星图", icon: Network };

  const PrimaryIcon = primaryCta.icon;
  const SecondaryIcon = secondaryCta.icon;
  const hint = steps ? nextOnboardingHint(steps) : null;

  const ledgerDailyValues = Object.values(ledgerLite?.dailyByDate ?? {});
  const latestLedgerSnap =
    ledgerDailyValues.length > 0
      ? ledgerDailyValues.reduce((a, b) => (a.date >= b.date ? a : b))
      : null;

  return (
    <div className="tl-fade-up space-y-4">
      <BrandSplashIntro replaySignal={introReplaySignal} />
      {/* 1. Compact Header Row: Identity + Crisp CTAs */}
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: activeColor }} />
            <h1 className="truncate text-xl font-bold tracking-tight text-[var(--ink-strong)] sm:text-2xl">
              {activeVault?.name ?? "我的主复盘库"}
            </h1>
            {activeVault?.paths.isExternal && (
              <span className="rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-0.5 text-[10px] font-medium text-[var(--ink-muted)]">
                外部目录
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-xs text-[var(--ink-muted)]" title={vaultDir || undefined}>
            {activeVault?.description || "本地 Obsidian 双链复盘、实盘账本与个人交易手册"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIntroReplaySignal((s) => s + 1)}
            title="重播开场动效"
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-xs text-[var(--ink-dim)] transition hover:border-[var(--border-strong)] hover:text-[var(--ink-strong)]"
          >
            <RotateCcw className="h-[14px] w-[14px]" />
          </button>
          <Link
            href={primaryCta.href}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-strong)] px-3.5 py-2 text-xs font-semibold text-white transition hover:brightness-110"
          >
            <PrimaryIcon className="h-[15px] w-[15px]" />
            {primaryCta.label}
          </Link>
          <Link
            href={secondaryCta.href}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-xs font-medium text-[var(--ink-strong)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            <SecondaryIcon className="h-[15px] w-[15px]" />
            {secondaryCta.label}
          </Link>
          <a
            href={`/api/vault/export?vaultId=${encodeURIComponent(activeVault?.id ?? "default")}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-xs text-[var(--ink-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--ink-strong)]"
            title={vaultDir ? `导出本库 Obsidian (.zip) · 本地目录：${vaultDir}` : "导出本库 Obsidian (.zip)"}
          >
            <Download className="h-[15px] w-[15px]" />
            <span className="hidden sm:inline">导出</span>
          </a>
        </div>
      </section>

      {/* 2. Collapsible Onboarding Pill (leaves above-the-fold clean for the Hero Canvas) */}
      {steps && steps.completedCount < steps.totalCount && (
        <section className="scifi-card rounded-xl px-4 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2.5 text-xs">
              <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--ink-strong)]">
                <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
                上手进度 {steps.completedCount}/{steps.totalCount}
              </span>
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--bg-deep)]">
                <div
                  className="h-full rounded-full bg-[var(--accent)] transition-all"
                  style={{ width: `${(steps.completedCount / steps.totalCount) * 100}%` }}
                />
              </div>
              {hint && (
                <Link href={hint.href} className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent)] hover:underline">
                  下一步：{hint.label}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </div>

            <button
              type="button"
              onClick={() => setOnboardingExpanded((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[var(--ink-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink-strong)]"
            >
              {onboardingExpanded ? "收起清单" : "展开 4 步清单"}
              {onboardingExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>

          {onboardingExpanded && (
            <div className="mt-3 grid gap-2.5 border-t border-[var(--border)] pt-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/70 p-3">
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-[var(--cyan)]">STEP 1</span>
                  {steps.hasReviews && <CheckCircle2 className="h-3.5 w-3.5 text-[var(--emerald)]" />}
                </div>
                <div className="mt-1 text-xs font-semibold text-[var(--ink-strong)]">导入复盘素材</div>
                <div className="mt-2 flex items-center gap-2 text-[11px]">
                  <Link href="/vault" className="text-[var(--accent)] hover:underline">去导入</Link>
                  <Link href="/sync" className="text-[var(--ink-muted)] hover:underline">云同步</Link>
                </div>
              </div>

              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/70 p-3">
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-[var(--ink-muted)]">STEP 2 · 可选</span>
                  {steps.hasLedgerOrSkipped && <CheckCircle2 className="h-3.5 w-3.5 text-[var(--emerald)]" />}
                </div>
                <div className="mt-1 text-xs font-semibold text-[var(--ink-strong)]">绑定实盘账本</div>
                <div className="mt-2 flex items-center gap-2 text-[11px]">
                  <Link href="/ledger" className="text-[var(--accent)] hover:underline">去导入</Link>
                  {!steps.hasLedgerOrSkipped && (
                    <button
                      type="button"
                      disabled={skippingLedger}
                      onClick={handleSkipLedger}
                      className="text-[var(--ink-dim)] hover:text-[var(--ink)]"
                    >
                      {skippingLedger ? "处理中..." : "纯学习跳过"}
                    </button>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/70 p-3">
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-[var(--accent)]">STEP 3 · 全局</span>
                  {steps.hasLlm && <CheckCircle2 className="h-3.5 w-3.5 text-[var(--emerald)]" />}
                </div>
                <div className="mt-1 text-xs font-semibold text-[var(--ink-strong)]">接入 AI 大模型</div>
                <div className="mt-2 text-[11px]">
                  <Link href="/settings" className="inline-flex items-center gap-1 text-[var(--accent)] hover:underline">
                    <Settings className="h-3 w-3" />
                    {steps.hasLlm ? "查看配置" : "去配置 API"}
                  </Link>
                </div>
              </div>

              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/70 p-3">
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-[var(--ink-strong)]">STEP 4</span>
                  {steps.hasManual && <CheckCircle2 className="h-3.5 w-3.5 text-[var(--emerald)]" />}
                </div>
                <div className="mt-1 text-xs font-semibold text-[var(--ink-strong)]">提炼交易手册</div>
                <div className="mt-2 text-[11px]">
                  <Link href={steps.hasManual ? "/manuals" : "/synthesize"} className="text-[var(--accent)] hover:underline">
                    {steps.hasManual ? "查看手册 →" : "去提炼 v1.0 →"}
                  </Link>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* 3. Signature Hero Visual Canvas */}
      <LoomHeroCanvas
        vault={vault}
        ledger={ledgerLite}
        latestManual={latestManual}
        accentColor={activeColor}
        skipLedgerStep={activeVault?.skipLedgerStep}
      />

      {/* 4. 4 Compact Signal Cards with Micro-Visuals & 4-Channel Semantic Accents */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/vault"
          className="tl-card-interactive group flex flex-col justify-between rounded-xl p-4"
        >
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--ink-muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
              复盘沉淀
            </span>
            <span className="font-mono text-[10px] text-[var(--ink-dim)]">{stats?.yearsCount ?? 0} 年</span>
          </div>
          <div className="mt-2.5 flex items-end justify-between gap-2">
            <div className="font-mono text-2xl font-bold tracking-tight text-[var(--ink-strong)]">
              {stats?.docsCount ?? 0}
              <span className="ml-1 text-xs font-normal text-[var(--ink-dim)]">篇</span>
            </div>
            {monthlyCadence.length > 0 && (
              <div className="flex h-7 items-end gap-0.5" aria-hidden="true">
                {monthlyCadence.map((m) => (
                  <span
                    key={m.month}
                    title={`${m.month}: ${m.count} 篇`}
                    className="w-1.5 rounded-t bg-[var(--accent)]/60 transition group-hover:bg-[var(--accent)]"
                    style={{ height: `${m.heightPct}%` }}
                  />
                ))}
              </div>
            )}
          </div>
        </Link>

        <Link
          href="/vault?view=graph"
          className="tl-card-interactive group flex flex-col justify-between rounded-xl p-4"
        >
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--ink-muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--cyan)]" />
              双链脉络
            </span>
            <span className="font-mono text-[10px] text-[var(--cyan)]">{stats?.topicsCount ?? 0} 主题</span>
          </div>
          <div className="mt-2.5 flex items-end justify-between gap-2">
            <div className="font-mono text-2xl font-bold tracking-tight text-[var(--ink-strong)]">
              {stats?.linksCount ?? 0}
              <span className="ml-1 text-xs font-normal text-[var(--ink-dim)]">连线</span>
            </div>
            <div className="flex flex-wrap justify-end gap-1">
              {(vault?.topics ?? []).slice(0, 2).map((t) => (
                <span key={t} className="rounded border border-[var(--cyan)]/25 bg-[var(--cyan-soft)] px-1.5 py-0.5 text-[10px] text-[var(--cyan)]">
                  #{t}
                </span>
              ))}
            </div>
          </div>
        </Link>

        <Link
          href="/ledger"
          className="tl-card-interactive group flex flex-col justify-between rounded-xl p-4"
        >
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--ink-muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--amber)]" />
              实盘账本
            </span>
            <span className="font-mono text-[10px] text-[var(--ink-dim)]">
              {activeVault?.skipLedgerStep ? "纯学习库" : `${stats?.dailyRecordsCount ?? 0} 交易日`}
            </span>
          </div>
          <div className="mt-2.5 flex items-baseline justify-between gap-2">
            <div className="font-mono text-2xl font-bold tracking-tight text-[var(--ink-strong)]">
              {stats?.tradesCount ?? 0}
              <span className="ml-1 text-xs font-normal text-[var(--ink-dim)]">笔</span>
            </div>
            {latestLedgerSnap && (
              <span
                className={`font-mono text-xs font-semibold ${
                  latestLedgerSnap.cumReturnPct >= 0 ? "text-[var(--rose)]" : "text-[var(--emerald)]"
                }`}
              >
                {latestLedgerSnap.cumReturnPct >= 0 ? "+" : ""}
                {latestLedgerSnap.cumReturnPct.toFixed(1)}%
              </span>
            )}
          </div>
        </Link>

        <Link
          href={hasManuals ? "/manuals" : "/synthesize"}
          className="tl-card-interactive group flex flex-col justify-between rounded-xl p-4"
        >
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--ink-muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--emerald)]" />
              交易手册
            </span>
            <span className="text-[11px] font-medium text-[var(--emerald)] group-hover:underline">
              {hasManuals ? "阅读溯源 →" : "去提炼 →"}
            </span>
          </div>
          <div className="mt-2.5 flex items-baseline justify-between gap-2">
            <div className="font-mono text-2xl font-bold tracking-tight text-[var(--ink-strong)]">
              {stats?.manualsCount ?? 0}
              <span className="ml-1 text-xs font-normal text-[var(--ink-dim)]">份</span>
            </div>
            {stats?.latestManualTitle && (
              <span className="max-w-[140px] truncate text-[11px] text-[var(--ink-muted)]">
                {stats.latestManualTitle}
              </span>
            )}
          </div>
        </Link>
      </section>

      {/* 5. Compact Workspace Dock: Timeline + Topics + Parallel Vaults */}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
        {/* Compact Timeline & Topics */}
        {vault && (vault.timelineTree.length > 0 || vault.topics.length > 0) && (
          <div className="scifi-card rounded-xl p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ink-strong)]">
                <Calendar className="h-4 w-4 text-[var(--ink-muted)]" />
                时间轴与高频概念
              </div>
              <Link href="/synthesize" className="text-[11px] text-[var(--accent)] hover:underline">
                框选阶段提炼 →
              </Link>
            </div>

            {vault.timelineTree.length > 0 && (
              <div className="mt-3 max-h-48 space-y-2 overflow-y-auto pr-1">
                {vault.timelineTree.map((yr) => (
                  <div
                    key={yr.year}
                    className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/60 px-2.5 py-2"
                  >
                    <Link
                      href={`/vault?card=${encodeURIComponent(`10-时间轴/${yr.year}年.md`)}`}
                      className="mr-1 font-mono text-xs font-semibold text-[var(--ink-strong)] hover:text-[var(--accent)]"
                    >
                      {yr.year} ({yr.count})
                    </Link>
                    {yr.months.map((m) => (
                      <Link
                        key={m.month}
                        href={`/vault?card=${encodeURIComponent(`10-时间轴/${m.month}.md`)}`}
                        className="rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                      >
                        {m.month.slice(5)}月·{m.count}
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {vault.topics.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] pt-3">
                <Hash className="mr-0.5 h-3.5 w-3.5 text-[var(--cyan)]" />
                {vault.topics.slice(0, 14).map((topic) => (
                  <Link
                    key={topic}
                    href={`/vault?card=${encodeURIComponent(`30-主题/${topic}.md`)}`}
                    className="rounded-full border border-[var(--border)] bg-[var(--bg-deep)] px-2 py-0.5 text-[11px] text-[var(--ink-muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  >
                    #{topic}
                  </Link>
                ))}
                <Link href="/vault?concepts=1" className="ml-auto text-[11px] text-[var(--ink-dim)] hover:text-[var(--accent)]">
                  词典 →
                </Link>
              </div>
            )}
          </div>
        )}

        {/* Parallel Vaults Switcher */}
        <div className="scifi-card rounded-xl p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ink-strong)]">
              <FolderKanban className="h-4 w-4 text-[var(--accent)]" />
              并行知识库（{overview?.vaults.length ?? 1}）
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-2 py-1 text-[11px] font-medium text-[var(--ink-strong)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                <Plus className="h-3.5 w-3.5" />
                新建
              </button>
              <Link href="/vaults" className="text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink-strong)]">
                全部 →
              </Link>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {(overview?.vaults ?? []).map((v) => {
              const isCur = v.id === overview?.activeVaultId;
              return (
                <button
                  key={v.id}
                  type="button"
                  disabled={isCur || Boolean(switchingId)}
                  onClick={() => handleSwitchVault(v.id)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                    isCur
                      ? "border-[var(--accent)]/45 bg-[var(--accent-soft)]/50"
                      : "border-[var(--border)] bg-[var(--bg-deep)]/60 hover:border-[var(--border-strong)] hover:bg-[var(--surface)]"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: v.color }} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-semibold text-[var(--ink-strong)]">{v.name}</span>
                        {isCur && (
                          <span className="rounded bg-[var(--emerald-soft)] px-1.5 py-0.2 text-[9px] text-[var(--emerald)]">
                            当前
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] text-[var(--ink-dim)]">
                        {v.stats.docsCount} 篇 · {v.stats.tradesCount} 笔 · {v.stats.manualsCount} 手册
                      </div>
                    </div>
                  </div>
                  {switchingId === v.id ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--accent)]" />
                  ) : !isCur ? (
                    <span className="shrink-0 text-[11px] text-[var(--accent)]">切换 →</span>
                  ) : null}
                </button>
              );
            })}
          </div>
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
