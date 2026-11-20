"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, CheckCircle2, FolderGit2, Layers, Settings, Sparkles, Upload } from "lucide-react";
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
        setNotice(`已导入 ${data.copied} 篇脱敏示例复盘笔记，并自动构建 Obsidian 双链知识库。`);
      }
    } finally {
      setLoadingSample(false);
    }
  }

  const steps = [
    {
      num: "01",
      title: "导入零散复盘笔记",
      desc: "支持 .md / .txt / .docx / .html / .pdf 批量入库，自动按日期、标签与 [[双链]] 生成 Obsidian 知识库。",
      href: "/vault",
      cta: "打开双链知识库",
      icon: FolderGit2,
      done: (vault?.counts.total ?? 0) > 0,
    },
    {
      num: "02",
      title: "配置你的大模型 API",
      desc: "纯本地 BYOK 架构，支持 DeepSeek、OpenAI、硅基流动或本机 Ollama，Key 仅保存在本地工作区。",
      href: "/settings",
      cta: provider?.configured ? `已配置 ${provider.model}` : "配置模型 API",
      icon: Settings,
      done: Boolean(provider?.configured),
    },
    {
      num: "03",
      title: "按时间线框选 + Skill 提炼",
      desc: "按阶段勾选复盘样本，切换内置「短线博弈 / 基本面分析 Skill」，强制原文逐字溯源防幻觉。",
      href: "/synthesize",
      cta: "进入阶段提炼",
      icon: Layers,
      done: manualsCount > 0,
    },
    {
      num: "04",
      title: "沉淀时间轴与个人交易手册",
      desc: "回看不同阶段的方法演进路径与反例边界，一键导出带 [[双链]] 引用的 Obsidian Markdown 手册。",
      href: "/manuals",
      cta: `查看交易手册（${manualsCount}）`,
      icon: BookOpen,
      done: manualsCount > 0,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--surface)] via-[var(--surface)] to-[#1a1f2d] p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)]/35 bg-[var(--accent-soft)] px-3 py-1 text-xs font-medium text-[var(--accent)]">
              <Sparkles className="h-3.5 w-3.5" />
              Local-First · Obsidian Bi-Directional Vault · BYOK LLM
            </div>
            <h1 className="mt-4 text-2xl font-bold tracking-tight text-[var(--ink)] sm:text-3xl">
              把常年累月零散的复盘笔记，织成你的个人交易手册
            </h1>
            <p className="mt-3 text-sm leading-7 text-[var(--ink-muted)]">
              将 <code className="text-[var(--ink)]">.md / .txt / .docx / .html / .pdf</code> 复盘资料自动整理为标准{" "}
              <strong className="text-[var(--ink)]">Obsidian 双向链接知识库</strong>；按时间线阶段框选样本，配合内置{" "}
              <strong className="text-[var(--accent)]">短线博弈 / 基本面分析 Skill</strong>{" "}
              与你自配的大模型 API，沉淀可回溯原文的方法演变时间轴与个人交易手册。
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Link
                href="/vault"
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[#111] hover:opacity-90"
              >
                <Upload className="h-4 w-4" />
                导入我的复盘笔记
              </Link>
              <button
                type="button"
                onClick={handleLoadSamples}
                disabled={loadingSample}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] px-4 py-2 text-sm font-medium text-[var(--ink)] hover:border-[var(--accent)]/60 disabled:opacity-50"
              >
                {loadingSample ? "正在构建示例库..." : "一键加载示例复盘库（6 篇）"}
              </button>
            </div>
            {notice && (
              <p className="mt-3 text-xs text-[var(--emerald)]">{notice}</p>
            )}
          </div>

          <div className="grid min-w-[260px] grid-cols-2 gap-3">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)]/80 p-3.5">
              <div className="text-xs text-[var(--ink-dim)]">复盘笔记</div>
              <div className="mt-1 text-2xl font-bold text-[var(--ink)]">{vault?.counts.total ?? 0}</div>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)]/80 p-3.5">
              <div className="text-xs text-[var(--ink-dim)]">双向链接数</div>
              <div className="mt-1 text-2xl font-bold text-[var(--accent)]">{vault?.counts.links ?? 0}</div>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)]/80 p-3.5">
              <div className="text-xs text-[var(--ink-dim)]">主题节点</div>
              <div className="mt-1 text-2xl font-bold text-[var(--ink)]">{vault?.counts.topics ?? 0}</div>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)]/80 p-3.5">
              <div className="text-xs text-[var(--ink-dim)]">交易手册</div>
              <div className="mt-1 text-2xl font-bold text-[var(--emerald)]">{manualsCount}</div>
            </div>
          </div>
        </div>

        {vaultDir && (
          <div className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--bg)]/70 px-3.5 py-2 text-xs text-[var(--ink-muted)]">
            Obsidian 知识库本地路径：<code className="text-[var(--ink)]">{vaultDir}</code>（可直接用 Obsidian 客户端打开该目录查看关系图谱）
          </div>
        )}
      </section>

      {/* 4-Step Workflow */}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {steps.map(({ num, title, desc, href, cta, icon: Icon, done }) => (
          <div
            key={num}
            className="flex flex-col justify-between rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 transition hover:border-[var(--border-strong)]"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-semibold text-[var(--accent)]">STEP {num}</span>
                {done ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--emerald-soft)] px-2 py-0.5 text-[11px] text-[var(--emerald)]">
                    <CheckCircle2 className="h-3 w-3" />
                    就绪
                  </span>
                ) : (
                  <Icon className="h-4 w-4 text-[var(--ink-dim)]" />
                )}
              </div>
              <h2 className="mt-3 text-base font-semibold text-[var(--ink)]">{title}</h2>
              <p className="mt-2 text-xs leading-6 text-[var(--ink-muted)]">{desc}</p>
            </div>
            <Link
              href={href}
              className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] hover:underline"
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
