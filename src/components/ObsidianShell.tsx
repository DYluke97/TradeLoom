"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpen,
  Calendar,
  Command,
  Compass,
  FileText,
  FolderGit2,
  Hash,
  Layers,
  Network,
  Search,
  Settings,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MaskedProviderStatus } from "@/lib/provider";
import type { VaultFileItem, VaultIndex } from "@/lib/vault-builder";

const WORKSPACE_TABS = [
  { href: "/", label: "总览工作台", shortLabel: "总览", icon: Compass },
  { href: "/vault", label: "双链知识库", shortLabel: "知识库", icon: FolderGit2 },
  { href: "/synthesize", label: "阶段提炼", shortLabel: "提炼", icon: Layers },
  { href: "/manuals", label: "个人交易手册", shortLabel: "手册", icon: BookOpen },
  { href: "/settings", label: "模型与 Skill", shortLabel: "设置", icon: Settings },
];

type SwitcherItem = {
  id: string;
  label: string;
  sublabel: string;
  href: string;
  kind: "command" | "overview" | "timeline" | "card" | "topic" | "manual";
};

function NodeIcon({ kind }: { kind: SwitcherItem["kind"] }) {
  switch (kind) {
    case "topic":
      return <Hash className="h-3.5 w-3.5 text-[var(--cyan)]" />;
    case "timeline":
      return <Calendar className="h-3.5 w-3.5 text-[var(--amber)]" />;
    case "manual":
      return <BookOpen className="h-3.5 w-3.5 text-[var(--emerald)]" />;
    case "command":
      return <Command className="h-3.5 w-3.5 text-[var(--accent)]" />;
    default:
      return <FileText className="h-3.5 w-3.5 text-[var(--ink-muted)]" />;
  }
}

export default function ObsidianShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const [vault, setVault] = useState<VaultIndex | null>(null);
  const [provider, setProvider] = useState<MaskedProviderStatus | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const loadMeta = useCallback(async () => {
    try {
      const [vRes, pRes] = await Promise.all([
        fetch("/api/vault", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/provider", { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (vRes.ok) setVault(vRes.index);
      if (pRes.ok) setProvider(pRes.status);
    } catch {
      /* ignore transient fetch errors */
    }
  }, []);

  useEffect(() => {
    loadMeta();
  }, [loadMeta, pathname]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSwitcherOpen((prev) => !prev);
      } else if (e.key === "Escape" && switcherOpen) {
        setSwitcherOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [switcherOpen]);

  useEffect(() => {
    if (switcherOpen) {
      setQuery("");
      setSelectedIdx(0);
      loadMeta();
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [switcherOpen, loadMeta]);

  const switcherItems = useMemo<SwitcherItem[]>(() => {
    const commands: SwitcherItem[] = [
      { id: "cmd-graph", label: "打开全局关系图谱 (Graph View)", sublabel: "查看全部复盘与主题的双链星图", href: "/vault?view=graph", kind: "command" },
      { id: "cmd-synth", label: "按时间线阶段提炼个人交易手册", sublabel: "选择复盘样本 + 内置短线/基本面 Skill", href: "/synthesize", kind: "command" },
      { id: "cmd-manuals", label: "查看已沉淀的个人交易手册", sublabel: "包含方法演变时间轴与逐字原文溯源", href: "/manuals", kind: "command" },
      { id: "cmd-settings", label: "配置大模型 API 与内置 Skill", sublabel: "DeepSeek / OpenAI / 硅基流动 / Ollama", href: "/settings", kind: "command" },
    ];

    const files: SwitcherItem[] = (vault?.files ?? []).map((f: VaultFileItem) => ({
      id: `file-${f.rel}`,
      label: f.title,
      sublabel: f.rel,
      href: `/vault?card=${encodeURIComponent(f.rel)}`,
      kind: f.nodeType,
    }));

    const q = query.trim().toLowerCase();
    const all = [...files, ...commands];
    if (!q) return [...commands.slice(0, 2), ...files.slice(0, 14)];

    return all
      .filter((item) => item.label.toLowerCase().includes(q) || item.sublabel.toLowerCase().includes(q))
      .slice(0, 18);
  }, [vault, query]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  function navigateSwitcher(item: SwitcherItem) {
    setSwitcherOpen(false);
    router.push(item.href);
  }

  function handleSwitcherKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, Math.max(switcherItems.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && switcherItems[selectedIdx]) {
      e.preventDefault();
      navigateSwitcher(switcherItems[selectedIdx]);
    }
  }

  const isVaultPage = pathname.startsWith("/vault");

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--bg)] text-[var(--ink)]">
      {/* Main Desktop Area: Left Ribbon + Workspace */}
      <div className="flex min-h-0 flex-1">
        {/* 44px Left Obsidian Ribbon Bar */}
        <aside className="flex w-11 shrink-0 flex-col items-center justify-between border-r border-[var(--border)] bg-[var(--bg-deep)] py-2.5 select-none">
          <div className="flex flex-col items-center gap-1.5">
            {/* Faceted Obsidian-inspired TradeLoom Prism Brand */}
            <Link
              href="/"
              title="TradeLoom · 交易复盘双链工作台"
              className="mb-2 flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-[#a882ff] to-[#6c5ce7] text-[11px] font-bold tracking-tight text-white shadow-[0_0_12px_rgba(168,130,255,0.35)]"
            >
              TL
            </Link>

            {WORKSPACE_TABS.slice(0, 4).map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  title={label}
                  className={`relative flex h-8 w-8 items-center justify-center rounded-md transition ${
                    active
                      ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "text-[var(--ink-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                  }`}
                >
                  {active && (
                    <span className="absolute -left-[6px] top-1.5 bottom-1.5 w-[2.5px] rounded-r bg-[var(--accent)]" />
                  )}
                  <Icon className="h-[17px] w-[17px]" />
                </Link>
              );
            })}

            <div className="my-1.5 h-px w-5 bg-[var(--border)]" />

            {/* Graph View Ribbon Shortcut */}
            <Link
              href="/vault?view=graph"
              title="打开全局关系图谱 (Graph View)"
              className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--ink-dim)] transition hover:bg-[var(--surface-2)] hover:text-[var(--accent)]"
            >
              <Network className="h-[17px] w-[17px]" />
            </Link>

            {/* Ctrl+K Quick Switcher Ribbon Shortcut */}
            <button
              type="button"
              onClick={() => setSwitcherOpen(true)}
              title="快速切换笔记与命令 (Ctrl+K)"
              className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--ink-dim)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
            >
              <Search className="h-[17px] w-[17px]" />
            </button>
          </div>

          {/* Bottom Settings Icon */}
          <div className="flex flex-col items-center gap-1.5">
            <Link
              href="/settings"
              title="模型 API 与 Skill 设置"
              className={`relative flex h-8 w-8 items-center justify-center rounded-md transition ${
                pathname.startsWith("/settings")
                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "text-[var(--ink-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
              }`}
            >
              {pathname.startsWith("/settings") && (
                <span className="absolute -left-[6px] top-1.5 bottom-1.5 w-[2.5px] rounded-r bg-[var(--accent)]" />
              )}
              <Settings className="h-[17px] w-[17px]" />
            </Link>
          </div>
        </aside>

        {/* Right Column: Top Obsidian Tab Bar + Viewport */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* 36px Obsidian Top Tab Bar */}
          <header className="flex h-9 shrink-0 items-end justify-between gap-2 border-b border-[var(--border)] bg-[var(--bg-deep)] px-2 pt-1 select-none">
            <nav className="flex items-end gap-0.5 overflow-x-auto">
              {WORKSPACE_TABS.map(({ href, label, icon: Icon }) => {
                const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`group relative flex h-8 items-center gap-1.5 whitespace-nowrap rounded-t-md px-3 text-xs transition ${
                      active
                        ? "border-x border-t border-[var(--border)] bg-[var(--bg)] font-medium text-[var(--ink)]"
                        : "text-[var(--ink-dim)] hover:bg-[var(--surface)]/70 hover:text-[var(--ink-muted)]"
                    }`}
                  >
                    {active && (
                      <span className="absolute inset-x-0 top-0 h-[2px] rounded-t-md bg-[var(--accent)]" />
                    )}
                    <Icon
                      className={`h-3.5 w-3.5 ${
                        active ? "text-[var(--accent)]" : "text-[var(--ink-dim)] group-hover:text-[var(--ink-muted)]"
                      }`}
                    />
                    <span>{label}</span>
                  </Link>
                );
              })}
            </nav>

            <div className="mb-1 hidden items-center gap-2 sm:flex">
              <button
                type="button"
                onClick={() => setSwitcherOpen(true)}
                className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] text-[var(--ink-muted)] transition hover:border-[var(--accent)]/50 hover:text-[var(--ink)]"
              >
                <Search className="h-3 w-3 text-[var(--accent)]" />
                <span>快速跳转笔记 / 主题...</span>
                <kbd className="rounded border border-[var(--border-strong)] bg-[var(--bg-deep)] px-1 py-0.2 font-mono text-[10px] text-[var(--ink-dim)]">
                  Ctrl K
                </kbd>
              </button>
            </div>
          </header>

          {/* Main Workspace Viewport */}
          <main className={`min-h-0 flex-1 ${isVaultPage ? "overflow-hidden" : "overflow-y-auto"}`}>
            {isVaultPage ? (
              children
            ) : (
              <div className="mx-auto max-w-[1320px] px-5 py-6 sm:px-8">{children}</div>
            )}
          </main>
        </div>
      </div>

      {/* 24px Bottom Obsidian Status Bar */}
      <footer className="flex h-6 shrink-0 items-center justify-between border-t border-[var(--border)] bg-[var(--bg-deep)] px-3 text-[11px] text-[var(--ink-dim)] select-none">
        <div className="flex items-center gap-3 truncate">
          <span className="inline-flex items-center gap-1.5 text-[var(--ink-muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
            TradeLoom Vault
          </span>
          <span className="hidden sm:inline">
            {vault
              ? `${vault.counts.total} 篇复盘 · ${vault.counts.years} 年 · ${vault.counts.topics} 主题 · ${vault.counts.links} 条双链 · ${vault.counts.manuals} 本手册`
              : "正在索引知识库..."}
          </span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 hover:text-[var(--ink)]"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                provider?.configured ? "bg-[var(--emerald)]" : "bg-[var(--amber)]"
              }`}
            />
            <span>{provider?.configured ? `LLM: ${provider.model}` : "未配置 LLM API"}</span>
          </Link>
          <span className="hidden md:inline">MIT · Local-First</span>
        </div>
      </footer>

      {/* Obsidian Ctrl+K Quick Switcher Modal */}
      {switcherOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[12vh] backdrop-blur-[2px]"
          onClick={() => setSwitcherOpen(false)}
        >
          <div
            className="w-full max-w-xl overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-3.5 py-2.5">
              <Search className="h-4 w-4 text-[var(--accent)]" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleSwitcherKeyDown}
                placeholder="输入复盘标题、日期、主题或命令（↑↓ 选择，Enter 打开）..."
                className="flex-1 bg-transparent text-sm text-[var(--ink)] placeholder:text-[var(--ink-dim)] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setSwitcherOpen(false)}
                className="rounded p-1 text-[var(--ink-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[380px] overflow-y-auto p-1.5">
              {switcherItems.length === 0 ? (
                <div className="py-8 text-center text-xs text-[var(--ink-dim)]">未匹配到任何笔记或命令</div>
              ) : (
                switcherItems.map((item, idx) => {
                  const active = idx === selectedIdx;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onMouseEnter={() => setSelectedIdx(idx)}
                      onClick={() => navigateSwitcher(item)}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition ${
                        active ? "bg-[var(--accent-soft)] text-[var(--ink)]" : "text-[var(--ink-muted)] hover:bg-[var(--surface-2)]"
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <NodeIcon kind={item.kind} />
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium text-[var(--ink)]">{item.label}</div>
                          <div className="truncate font-mono text-[10px] text-[var(--ink-dim)]">{item.sublabel}</div>
                        </div>
                      </div>
                      {active && (
                        <span className="shrink-0 font-mono text-[10px] text-[var(--accent)]">Enter ↵</span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
