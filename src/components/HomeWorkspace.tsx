"use client";

import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Calendar,
  CheckCircle2,
  FolderGit2,
  Hash,
  Layers,
  Network,
  Settings,
  Sparkles,
  Upload,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { MaskedProviderStatus } from "@/lib/provider";
import type { VaultIndex } from "@/lib/vault-builder";

export default function HomeWorkspace() {
  const [vault, setVault] = useState<VaultIndex | null>(null);
  const [vaultDir, setVaultDir] = useState<string>("");
  const [provider, setProvider] = useState<MaskedProviderStatus | null>(null);
  const [manualsCount, setManualsCount] = useState<number>(0);
  const [loadingSample, setLoadingSample] = useState(false);
  const [notice, setNotice] = useState("");

  async function refresh() {
    const [vRes, pRes, mRes] = await Promise.all([
      fetch("/api/vault", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/provider", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/manuals", { cache: "no-store" }).then((r) => r.json()),
    ]);
    if (vRes.ok) {
      setVault(vRes.index);
      setVaultDir(vRes.vaultDir || "");
    }
    if (pRes.ok) setProvider(pRes.status);
    if (mRes.ok) setManualsCount(Array.isArray(mRes.manuals) ? mRes.manuals.length : 0);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleLoadSamples() {
    setLoadingSample(true);
    setNotice("");
    try {
      const res = await fetch("/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "load-samples" }),
      });
      const data = await res.json();
      if (data.ok) {
        setVault(data.index);
        setNotice(`已导入 ${data.copied} 篇脱敏示例复盘笔记，并自动构建多年时间轴与 Obsidian 双链图谱。`);
      }
    } finally {
      setLoadingSample(false);
    }
  }

  const steps = [
    {
      num: "01",
      title: "导入常年零散复盘笔记",
      desc: "支持 .md / .txt / .docx / .html / .pdf 批量入库；即使旧笔记没有标签，也会自动识别交易概念并生成年/月/日层级与双向链接。",
      href: "/vault",
      cta: "进入双链知识库",
      icon: FolderGit2,
      done: (vault?.counts.total ?? 0) > 0,
    },
    {
      num: "02",
      title: "配置你的大模型 API",
      desc: "纯本地 BYOK 架构，支持 DeepSeek、OpenAI、硅基流动或本机 Ollama，Key 与复盘原文完全留存在本地磁盘。",
      href: "/settings",
      cta: provider?.configured ? `已连接 ${provider.model}` : "配置模型 API",
      icon: Settings,
      done: Boolean(provider?.configured),
    },
    {
      num: "03",
      title: "按时间线框选 + Skill 提炼",
      desc: "按年份或阶段一键框选复盘样本，配合内置「短线博弈 / 基本面分析 Skill」，强制绑定逐字原文证据 ID 杜绝幻觉。",
      href: "/synthesize",
      cta: "开始阶段提炼",
      icon: Layers,
      done: manualsCount > 0,
    },
    {
      num: "04",
      title: "沉淀时间轴与个人交易手册",
      desc: "生成的个人交易手册自动回写至 Obsidian `40-交易手册/` 目录，每条规则自带反向链接直指历史复盘原件。",
      href: "/manuals",
      cta: `查看交易手册（${manualsCount}）`,
      icon: BookOpen,
      done: manualsCount > 0,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Sci-Fi Holographic Obsidian Hero */}
      <section className="scifi-card relative overflow-hidden rounded-xl p-6 sm:p-7">
        <div className="pointer-events-none absolute -top-24 -right-20 h-56 w-56 rounded-full bg-[var(--accent)]/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-44 w-56 rounded-full bg-[var(--cyan)]/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-[var(--cyan)]/35 bg-[var(--cyan-soft)] px-3 py-1 font-mono text-[11px] font-medium tracking-wide text-[var(--cyan)] shadow-[0_0_16px_rgba(34,211,238,0.16)]">
              <Sparkles className="h-3.5 w-3.5" />
              OBSIDIAN NEURAL VAULT · MULTI-YEAR TIMELINE · BYOK LLM
            </div>
            <h1 className="mt-4 bg-gradient-to-r from-[#f8fafc] via-[#e2d9ff] to-[#a5f3fc] bg-clip-text text-2xl font-bold tracking-tight text-transparent sm:text-[29px]">
              把常年累月零散的复盘笔记，织成你的个人交易手册
            </h1>
            <p className="mt-3 text-sm leading-7 text-[var(--ink-muted)]">
              将 <code className="rounded border border-[var(--amber)]/25 bg-[var(--surface-2)] px-1.5 py-0.5 text-xs text-[var(--amber)]">.md / .txt / .docx / .html / .pdf</code>{" "}
              自动构建为标准 <strong className="text-[var(--ink)]">Obsidian 双向链接知识库</strong>（年/月/日 MOC + 可自定义主题词典 + 全息力导向星图）；
              按时间线阶段框选样本，通过内置 <strong className="text-[var(--accent)]">短线博弈 / 基本面分析 Skill</strong> 与自配大模型 API，沉淀可逐字溯源的方法演变时间轴与交易手册。
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <Link
                href="/vault"
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#7c4dff] to-[#9b6bff] px-4 py-2 text-xs font-semibold text-white shadow-[0_0_20px_rgba(124,77,255,0.45)] transition hover:brightness-110"
              >
                <Upload className="h-3.5 w-3.5" />
                打开双链知识库
              </Link>
              <Link
                href="/vault?view=graph"
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--cyan)]/45 bg-[var(--cyan-soft)] px-4 py-2 text-xs font-medium text-[var(--cyan)] shadow-[0_0_16px_rgba(34,211,238,0.16)] transition hover:border-[var(--cyan)] hover:bg-[var(--cyan)]/20"
              >
                <Network className="h-3.5 w-3.5" />
                进入全息星图
              </Link>
              <button
                type="button"
                onClick={handleLoadSamples}
                disabled={loadingSample}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)]/85 px-3.5 py-2 text-xs font-medium text-[var(--ink-muted)] transition hover:border-[var(--accent)]/60 hover:text-[var(--ink)] disabled:opacity-50"
              >
                {loadingSample ? "正在构建示例库..." : "一键加载示例复盘库（6 篇）"}
              </button>
            </div>
            {notice && <p className="mt-3 text-xs text-[var(--emerald)]">{notice}</p>}
          </div>

          {/* 2x2 Holographic Telemetry Tiles */}
          <div className="grid min-w-[270px] grid-cols-2 gap-2.5">
            <div className="rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)]/85 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--ink-dim)]">复盘笔记 / 跨度</div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="font-mono text-2xl font-bold text-[#f8fafc]">{vault?.counts.total ?? 0}</span>
                <span className="font-mono text-xs text-[var(--amber)]">{vault?.counts.years ?? 0} 年</span>
              </div>
            </div>
            <div className="rounded-lg border border-[var(--accent)]/25 bg-[var(--bg-deep)]/85 p-3.5 shadow-[inset_0_1px_0_rgba(179,136,255,0.12)]">
              <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--ink-dim)]">双向链接数</div>
              <div className="mt-1 font-mono text-2xl font-bold text-[var(--accent)] drop-shadow-[0_0_10px_rgba(179,136,255,0.45)]">
                {vault?.counts.links ?? 0}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--cyan)]/25 bg-[var(--bg-deep)]/85 p-3.5 shadow-[inset_0_1px_0_rgba(34,211,238,0.12)]">
              <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--ink-dim)]">主题 & 概念节点</div>
              <div className="mt-1 font-mono text-2xl font-bold text-[var(--cyan)] drop-shadow-[0_0_10px_rgba(34,211,238,0.4)]">
                {vault?.counts.topics ?? 0}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--emerald)]/25 bg-[var(--bg-deep)]/85 p-3.5 shadow-[inset_0_1px_0_rgba(52,211,153,0.12)]">
              <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--ink-dim)]">个人交易手册</div>
              <div className="mt-1 font-mono text-2xl font-bold text-[var(--emerald)] drop-shadow-[0_0_10px_rgba(52,211,153,0.4)]">
                {manualsCount}
              </div>
            </div>
          </div>
        </div>

        {vaultDir && (
          <div className="relative mt-5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/85 px-3.5 py-2 text-xs text-[var(--ink-muted)]">
            <div className="truncate">
              本地 Obsidian Vault 目录：<code className="text-[var(--cyan)]">{vaultDir}</code>
            </div>
            <span className="text-[11px] text-[var(--ink-dim)]">
              可直接用 Obsidian 桌面客户端 Open folder as vault 打开 · 按 Ctrl+K 快速跳转
            </span>
          </div>
        )}
      </section>

      {/* Multi-Year Timeline Distribution & Topic Hub Quick Access */}
      {vault && (vault.timelineTree.length > 0 || vault.topics.length > 0) && (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
          {/* Multi-year Archive Timeline */}
          <div className="scifi-card rounded-xl p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ink)]">
                <Calendar className="h-4 w-4 text-[var(--amber)]" />
                多年复盘时间轴分布（点击直达 Obsidian 年/月总览）
              </div>
              <Link href="/synthesize" className="text-[11px] text-[var(--cyan)] hover:underline">
                按阶段框选提炼 →
              </Link>
            </div>

            <div className="mt-4 space-y-3">
              {vault.timelineTree.map((yr) => (
                <div key={yr.year} className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/85 p-3">
                  <div className="flex items-center justify-between">
                    <Link
                      href={`/vault?card=${encodeURIComponent(`10-时间轴/${yr.year}年.md`)}`}
                      className="font-mono text-xs font-semibold text-[var(--amber)] hover:underline"
                    >
                      [[{yr.year}年复盘总览]]
                    </Link>
                    <span className="text-[11px] text-[var(--ink-dim)]">
                      {yr.count} 篇 · {yr.months.length} 个活跃月份
                    </span>
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {yr.months.map((m) => (
                      <Link
                        key={m.month}
                        href={`/vault?card=${encodeURIComponent(`10-时间轴/${m.month}.md`)}`}
                        className="inline-flex items-center gap-1.5 rounded border border-[var(--border-strong)] bg-[var(--surface)]/85 px-2 py-1 font-mono text-[11px] text-[var(--ink-muted)] transition hover:border-[var(--cyan)]/60 hover:text-[var(--cyan)]"
                      >
                        <span>{m.month}</span>
                        <span className="rounded bg-[var(--accent-soft)] px-1 text-[10px] text-[var(--accent)]">
                          {m.count}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Core Concept / Topic Hubs */}
          <div className="scifi-card rounded-xl p-5">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ink)]">
              <Hash className="h-4 w-4 text-[var(--cyan)]" />
              高频交易概念与主题枢纽（30-主题）
            </div>
            <p className="mt-1.5 text-[11px] leading-5 text-[var(--ink-dim)]">
              合并手工 #标签、[[双链]] 与自定义概念词典，跨越多年自动聚合同类经验与教训：
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {vault.topics.slice(0, 24).map((topic) => (
                <Link
                  key={topic}
                  href={`/vault?card=${encodeURIComponent(`30-主题/${topic}.md`)}`}
                  className="inline-flex items-center rounded-full border border-[var(--cyan)]/30 bg-[var(--bg-deep)]/85 px-2.5 py-1 text-xs text-[var(--cyan)] transition hover:border-[var(--cyan)] hover:bg-[var(--cyan-soft)] hover:shadow-[0_0_12px_rgba(34,211,238,0.22)]"
                >
                  #{topic}
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 4-Step Obsidian Workflow */}
      <section className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-4">
        {steps.map(({ num, title, desc, href, cta, icon: Icon, done }) => (
          <div
            key={num}
            className="scifi-card flex flex-col justify-between rounded-xl p-5 transition hover:border-[var(--cyan)]/40 hover:shadow-[0_12px_36px_rgba(0,0,0,0.5),0_0_24px_rgba(34,211,238,0.1)]"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-semibold tracking-wider text-[var(--cyan)]">
                  STEP {num}
                </span>
                {done ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[var(--emerald)]/30 bg-[var(--emerald-soft)] px-2 py-0.5 text-[10px] text-[var(--emerald)]">
                    <CheckCircle2 className="h-3 w-3" />
                    已就绪
                  </span>
                ) : (
                  <Icon className="h-4 w-4 text-[var(--ink-dim)]" />
                )}
              </div>
              <h2 className="mt-3 text-sm font-semibold text-[#f8fafc]">{title}</h2>
              <p className="mt-2 text-xs leading-6 text-[var(--ink-muted)]">{desc}</p>
            </div>
            <Link
              href={href}
              className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] transition hover:text-[var(--cyan)] hover:underline"
            >
              {cta}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        ))}
      </section>
    </div>
  );
}
