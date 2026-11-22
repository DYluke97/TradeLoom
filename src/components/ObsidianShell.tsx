"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpen,
  Calendar,
  CandlestickChart,
  Check,
  ChevronDown,
  Cloud,
  Command,
  Compass,
  Database,
  FileText,
  FolderGit2,
  FolderKanban,
  Hash,
  Layers,
  Loader2,
  Moon,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CreateVaultModal, { dispatchVaultChanged } from "@/components/CreateVaultModal";
import type { MaskedProviderStatus } from "@/lib/provider";
import type { VaultFileItem, VaultIndex } from "@/lib/vault-builder";
import type { VaultsOverview } from "@/lib/vault-types";

const VAULT_TABS = [
  { href: "/", label: "库内工作台", shortLabel: "工作台", icon: Compass },
  { href: "/vault", label: "复盘与星图", shortLabel: "复盘库", icon: FolderGit2 },
  { href: "/ledger", label: "本库账本", shortLabel: "账本", icon: CandlestickChart },
  { href: "/synthesize", label: "提炼方法论", shortLabel: "提炼", icon: Layers },
  { href: "/manuals", label: "交易手册", shortLabel: "手册", icon: BookOpen },
];

const GLOBAL_NAV = [
  { href: "/vaults", label: "全部知识库大厅", shortLabel: "全部库", icon: FolderKanban },
  { href: "/sync", label: "云端同步中心（9 大平台）", shortLabel: "云同步", icon: Cloud },
  { href: "/settings", label: "模型与提炼规则设置", shortLabel: "设置", icon: Settings },
];

type SwitcherItem = {
  id: string;
  label: string;
  sublabel: string;
  href?: string;
  switchVaultId?: string;
  kind: "command" | "vault" | "overview" | "timeline" | "card" | "topic" | "manual";
};

function NodeIcon({ kind }: { kind: SwitcherItem["kind"] }) {
  switch (kind) {
    case "vault":
      return <Database className="h-4 w-4 text-[var(--ink-muted)]" />;
    case "topic":
      return <Hash className="h-4 w-4 text-[var(--ink-muted)]" />;
    case "timeline":
      return <Calendar className="h-4 w-4 text-[var(--ink-strong)]" />;
    case "manual":
      return <BookOpen className="h-4 w-4 text-[var(--ink-muted)]" />;
    case "command":
      return <Command className="h-4 w-4 text-[var(--accent)]" />;
    default:
      return <FileText className="h-4 w-4 text-[var(--ink-muted)]" />;
  }
}

export default function ObsidianShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const [overview, setOverview] = useState<VaultsOverview | null>(null);
  const [activeVaultId, setActiveVaultId] = useState<string>("default");
  const [vault, setVault] = useState<VaultIndex | null>(null);
  const [provider, setProvider] = useState<MaskedProviderStatus | null>(null);

  const [vaultMenuOpen, setVaultMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [switchingVaultId, setSwitchingVaultId] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    try {
      const current = document.documentElement.dataset.theme;
      if (current === "dark" || current === "light") setTheme(current);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem("tradeloom-theme", next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const loadMeta = useCallback(async () => {
    try {
      const [ovRes, vRes, pRes] = await Promise.all([
        fetch("/api/vaults", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/vault", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/provider", { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (ovRes.ok) {
        setOverview(ovRes);
        if (ovRes.activeVaultId) setActiveVaultId(ovRes.activeVaultId);
      }
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
    const onVaultChanged = (e: Event) => {
      const custom = e as CustomEvent<{ vaultId?: string }>;
      if (custom.detail?.vaultId) {
        setActiveVaultId(custom.detail.vaultId);
      }
      loadMeta();
    };
    const onOpenCreate = () => setCreateOpen(true);
    window.addEventListener("tradeloom:vault-changed", onVaultChanged);
    window.addEventListener("tradeloom:open-create-vault", onOpenCreate);
    return () => {
      window.removeEventListener("tradeloom:vault-changed", onVaultChanged);
      window.removeEventListener("tradeloom:open-create-vault", onOpenCreate);
    };
  }, [loadMeta]);

  useEffect(() => {
    if (!vaultMenuOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setVaultMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onOutside);
    return () => window.removeEventListener("mousedown", onOutside);
  }, [vaultMenuOpen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSwitcherOpen((prev) => !prev);
      } else if (e.key === "Escape") {
        if (switcherOpen) setSwitcherOpen(false);
        if (vaultMenuOpen) setVaultMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [switcherOpen, vaultMenuOpen]);

  useEffect(() => {
    if (switcherOpen) {
      setQuery("");
      setSelectedIdx(0);
      loadMeta();
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [switcherOpen, loadMeta]);

  const handleSwitchVault = useCallback(
    async (targetId: string, navigateTo?: string) => {
      if (switchingVaultId) return;
      setSwitchingVaultId(targetId);
      try {
        const res = await fetch("/api/vaults", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "switch", id: targetId }),
        });
        const data = await res.json();
        if (data.ok) {
          setOverview(data);
          setActiveVaultId(data.activeVaultId);
          setVaultMenuOpen(false);
          dispatchVaultChanged(data.activeVaultId);
          if (navigateTo) {
            router.push(navigateTo);
          } else {
            router.refresh();
          }
        }
      } finally {
        setSwitchingVaultId(null);
      }
    },
    [router, switchingVaultId],
  );

  const switcherItems = useMemo<SwitcherItem[]>(() => {
    const vaultItems: SwitcherItem[] = (overview?.vaults ?? [])
      .filter((v) => v.id !== activeVaultId)
      .map((v) => ({
        id: `switch-vault-${v.id}`,
        label: `切换知识库 → ${v.name}`,
        sublabel: `${v.stats.docsCount} 篇复盘 · ${v.stats.manualsCount} 本手册 · ${v.stats.tradesCount} 笔交割`,
        switchVaultId: v.id,
        kind: "vault",
      }));

    const commands: SwitcherItem[] = [
      { id: "cmd-vaults", label: "全部知识库大厅（多库并行管理）", sublabel: "查看、新建、导出或切换多个独立双链知识库", href: "/vaults", kind: "command" },
      { id: "cmd-sync", label: "云端同步中心（9 大平台一键拉取）", sublabel: "滴答 / Notion / 飞书 / 语雀 / 腾讯文档 / ima / 有道 / OneNote / 印象笔记", href: "/sync", kind: "command" },
      { id: "cmd-graph", label: "打开本库双链星图 (Graph View)", sublabel: "探索当前知识库的复盘脉络与主题连线", href: "/vault?view=graph", kind: "command" },
      { id: "cmd-cloud-import", label: "粘贴文本 / 批量抓取网页链接", sublabel: "雪球 / 公众号 / 浏览器一键剪藏快速入库", href: "/vault?import=cloud", kind: "command" },
      { id: "cmd-ledger", label: "本库实盘交割账本（净值 & K 线买卖点）", sublabel: "仅作用于当前知识库，与其他库物理隔离", href: "/ledger", kind: "command" },
      { id: "cmd-synth", label: "提炼本库方法论手册", sublabel: "框选时间段复盘 + 叠加本库实盘审计", href: "/synthesize", kind: "command" },
      { id: "cmd-manuals", label: "查看本库个人交易手册", sublabel: "方法演变时间轴与逐字原文证据回链", href: "/manuals", kind: "command" },
      { id: "cmd-settings", label: "全局设置：AI 大模型与提炼规则", sublabel: "DeepSeek / OpenAI / 硅基流动 / Ollama（全库共享）", href: "/settings", kind: "command" },
    ];

    const files: SwitcherItem[] = (vault?.files ?? []).map((f: VaultFileItem) => ({
      id: `file-${f.rel}`,
      label: f.title,
      sublabel: f.rel,
      href: `/vault?card=${encodeURIComponent(f.rel)}`,
      kind: f.nodeType,
    }));

    const q = query.trim().toLowerCase();
    const all = [...vaultItems, ...commands, ...files];
    if (!q) return [...vaultItems.slice(0, 3), ...commands.slice(0, 4), ...files.slice(0, 10)];

    return all
      .filter((item) => item.label.toLowerCase().includes(q) || item.sublabel.toLowerCase().includes(q))
      .slice(0, 18);
  }, [overview, activeVaultId, vault, query]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  function navigateSwitcher(item: SwitcherItem) {
    setSwitcherOpen(false);
    if (item.switchVaultId) {
      handleSwitchVault(item.switchVaultId);
    } else if (item.href) {
      router.push(item.href);
    }
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

  const activeVault = overview?.activeVault ?? null;
  const activeColor = activeVault?.color || "#7c4dff";
  const isVaultPage = pathname === "/vault";
  const isGlobalPage =
    pathname.startsWith("/vaults") || pathname.startsWith("/sync") || pathname.startsWith("/settings");

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--bg)] text-[var(--ink)]">
      {/* Main Desktop Area: Dual-Zone Left Rail + Workspace */}
      <div className="flex min-h-0 flex-1">
        {/* 48px Left Dual-Zone Navigation Rail */}
        <aside className="flex w-12 shrink-0 flex-col items-center justify-between border-r border-[var(--border)] bg-[var(--bg-deep)]/95 py-2.5 select-none">
          <div className="flex flex-col items-center gap-1.5">
            {/* Brand Prism */}
            <Link
              href="/"
              title="TradeLoom · 织脉"
              className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--accent)]/25 bg-[var(--accent-soft)] text-xs font-bold tracking-tight text-[var(--accent)] transition hover:bg-[var(--accent)]/15"
            >
              TL
            </Link>

            <span className="font-mono text-[10px] tracking-wider text-[var(--ink-dim)]">本库</span>

            {/* Current Vault Zone (5 core items) */}
            {VAULT_TABS.map(({ href, label, icon: Icon }) => {
              const active =
                href === "/"
                  ? pathname === "/"
                  : href === "/vault"
                    ? pathname === "/vault"
                    : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  title={`${activeVault?.name ?? "当前库"} · ${label}`}
                  className={`relative flex h-10 w-10 items-center justify-center rounded-lg transition ${
                    active
                      ? "bg-[var(--surface)] text-[var(--ink-strong)] shadow-xs ring-1 ring-[var(--border-strong)]"
                      : "text-[var(--ink-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--ink-strong)]"
                  }`}
                >
                  {active && (
                    <span
                      className="absolute -left-[7px] top-1 bottom-1 w-[3px] rounded-r"
                      style={{ backgroundColor: activeColor }}
                    />
                  )}
                  <Icon className="h-5 w-5" strokeWidth={1.75} style={active ? { color: activeColor } : undefined} />
                </Link>
              );
            })}

            <div className="my-1.5 h-px w-6 bg-gradient-to-r from-transparent via-[var(--border-strong)] to-transparent" />
            <span className="font-mono text-[10px] tracking-wider text-[var(--ink-dim)]">全局</span>

            {/* Global Infrastructure Zone */}
            {GLOBAL_NAV.map(({ href, label, icon: Icon }) => {
              const active = pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  title={label}
                  className={`relative flex h-10 w-10 items-center justify-center rounded-lg transition ${
                    active
                      ? "bg-[var(--surface)] text-[var(--accent)] shadow-xs ring-1 ring-[var(--border-strong)]"
                      : "text-[var(--ink-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--ink-strong)]"
                  }`}
                >
                  {active && (
                    <span className="absolute -left-[7px] top-1 bottom-1 w-[3px] rounded-r bg-[var(--accent)]" />
                  )}
                  <Icon className="h-5 w-5" strokeWidth={1.75} />
                </Link>
              );
            })}
          </div>

          {/* Bottom Quick Search Button */}
          <div className="flex flex-col items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSwitcherOpen(true)}
              title="快速切换知识库 / 笔记 / 命令 (Ctrl+K)"
              className="flex h-10 w-10 items-center justify-center rounded-lg text-[var(--ink-dim)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
            >
              <Search className="h-5 w-5" strokeWidth={1.75} />
            </button>
          </div>
        </aside>

        {/* Right Column: Top Vault Switcher & Tabs + Viewport */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* 42px Top Header */}
          <header className="flex h-[50px] shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--bg-deep)]/95 px-3 select-none">
            <div className="flex min-w-0 items-center gap-2">
              {/* Current Vault Switcher Pill */}
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setVaultMenuOpen((o) => !o)}
                  className="inline-flex max-w-[240px] items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 text-[13px] font-medium text-[var(--ink-strong)] transition hover:border-[var(--accent)]/50"
                  title="点击切换当前激活的知识库，或新建并行知识库"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: activeColor }}
                  />
                  <span className="truncate">{activeVault?.name ?? "我的主复盘库"}</span>
                  {activeVault?.isDemo && (
                    <span className="shrink-0 rounded bg-[var(--cyan-soft)] px-1 py-0.2 text-[9px] text-[var(--cyan)]">
                      示范
                    </span>
                  )}
                  {activeVault?.paths.isExternal && (
                    <span className="shrink-0 rounded bg-[var(--amber-soft)] px-1 py-0.2 text-[9px] text-[var(--amber)]">
                      外挂
                    </span>
                  )}
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--ink-dim)]" />
                </button>

                {vaultMenuOpen && (
                  <div className="absolute left-0 top-full z-50 mt-1.5 w-80 overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] shadow-[var(--shadow-modal)]">
                    <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
                      <span className="text-[11px] font-medium text-[var(--ink-muted)]">
                        切换当前双链知识库（共 {overview?.vaults.length ?? 1} 个）
                      </span>
                      <Link
                        href="/vaults"
                        onClick={() => setVaultMenuOpen(false)}
                        className="text-[11px] text-[var(--cyan)] hover:underline"
                      >
                        全部大厅 →
                      </Link>
                    </div>

                    <div className="max-h-72 space-y-0.5 overflow-y-auto p-1.5">
                      {(overview?.vaults ?? []).map((v) => {
                        const isCur = v.id === activeVaultId;
                        const isSwitching = switchingVaultId === v.id;
                        return (
                          <button
                            key={v.id}
                            type="button"
                            disabled={Boolean(switchingVaultId)}
                            onClick={() => {
                              if (isCur) {
                                setVaultMenuOpen(false);
                              } else {
                                handleSwitchVault(v.id);
                              }
                            }}
                            className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                              isCur
                                ? "bg-[var(--accent-soft)] text-[var(--ink-strong)]"
                                : "text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink-strong)]"
                            }`}
                          >
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: v.color }}
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate text-xs font-medium">{v.name}</span>
                                  {v.isDemo && (
                                    <span className="rounded bg-[var(--cyan-soft)] px-1 text-[9px] text-[var(--cyan)]">
                                      示范库
                                    </span>
                                  )}
                                </div>
                                <div className="font-mono text-[10px] text-[var(--ink-dim)]">
                                  {v.stats.docsCount} 篇复盘 · {v.stats.manualsCount} 手册 · {v.stats.tradesCount} 笔交割
                                </div>
                              </div>
                            </div>
                            {isSwitching ? (
                              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--cyan)]" />
                            ) : isCur ? (
                              <Check className="h-3.5 w-3.5 shrink-0 text-[var(--emerald)]" />
                            ) : null}
                          </button>
                        );
                      })}
                    </div>

                    <div className="border-t border-[var(--border)] bg-[var(--bg-deep)]/80 p-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setVaultMenuOpen(false);
                          setCreateOpen(true);
                        }}
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--accent-strong)] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[var(--accent)]"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        新建独立双链知识库
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="hidden h-4 w-px bg-[var(--border-strong)] md:block" />

              {/* Current Vault Tabs */}
              <nav className="flex items-center gap-0.5 overflow-x-auto">
                {VAULT_TABS.map(({ href, label, shortLabel, icon: Icon }) => {
                  const active =
                    href === "/"
                      ? pathname === "/"
                      : href === "/vault"
                        ? pathname === "/vault"
                        : pathname.startsWith(href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      className={`group relative flex h-9 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-[13px] transition ${
                        active
                          ? "bg-[var(--surface)] font-medium text-[var(--ink-strong)] ring-1 ring-[var(--border)] shadow-2xs"
                          : "text-[var(--ink-dim)] hover:bg-[var(--surface)]/70 hover:text-[var(--ink-muted)]"
                      }`}
                    >
                      {active && (
                        <span
                          className="absolute inset-x-1.5 bottom-0 h-[2px] rounded-full"
                          style={{ backgroundColor: activeColor }}
                        />
                      )}
                      <Icon
                        className="h-[18px] w-[18px]" strokeWidth={1.75}
                      />
                      <span className="hidden lg:inline">{label}</span>
                      <span className="lg:hidden">{shortLabel}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>

            {/* Right Global Shortcuts */}
            <div className="flex shrink-0 items-center gap-1.5">
              <Link
                href="/sync"
                className={`hidden items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition xl:inline-flex ${
                  pathname.startsWith("/sync")
                    ? "border-[var(--cyan)]/60 bg-[var(--cyan-soft)] text-[var(--cyan)]"
                    : "border-[var(--border-strong)] bg-[var(--surface)]/80 text-[var(--ink-muted)] hover:border-[var(--cyan)]/50 hover:text-[var(--cyan)]"
                }`}
              >
                <Cloud className="h-4 w-4" />
                <span>云端同步</span>
              </Link>
              <Link
                href="/vaults"
                className={`hidden items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition lg:inline-flex ${
                  pathname.startsWith("/vaults")
                    ? "border-[var(--accent)]/60 bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-[var(--border-strong)] bg-[var(--surface)]/80 text-[var(--ink-muted)] hover:border-[var(--accent)]/50 hover:text-[var(--ink)]"
                }`}
              >
                <FolderKanban className="h-4 w-4" />
                <span>全部库 ({overview?.vaults.length ?? 1})</span>
              </Link>
              <button
                type="button"
                onClick={() => setSwitcherOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--ink-muted)] transition hover:border-[var(--accent)]/50 hover:text-[var(--ink-strong)]"
              >
                <Search className="h-4 w-4 text-[var(--ink-dim)]" />
                <span className="hidden sm:inline">搜库 / 笔记</span>
                <kbd className="rounded border border-[var(--border)] bg-[var(--bg-deep)] px-1 font-mono text-[10px] text-[var(--ink-dim)]">
                  Ctrl K
                </kbd>
              </button>
              <button
                type="button"
                onClick={toggleTheme}
                title={theme === "light" ? "切换至低反差柔炭深色模式" : "切换至护眼浅色模式"}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-[11px] text-[var(--ink-muted)] transition hover:border-[var(--accent)]/50 hover:text-[var(--ink-strong)]"
              >
                {theme === "light" ? (
                  <>
                    <Moon className="h-4 w-4" />
                    <span className="hidden xl:inline">深色</span>
                  </>
                ) : (
                  <>
                    <Sun className="h-4 w-4 text-[var(--ink-strong)]" />
                    <span className="hidden xl:inline">浅色</span>
                  </>
                )}
              </button>
            </div>
          </header>

          {/* Soft Demo Sandbox Notice Bar */}
          {activeVault?.isDemo && !isGlobalPage && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--accent-soft)] px-4 py-1.5 text-[11px] text-[var(--ink)]">
              <div className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-[var(--cyan)]" />
                <span>
                  当前处于<strong>「体验示范库」</strong>（内置 6 篇复盘 + 示范交割单 + 免配模型示范手册），放心点看双链星图、账本和手册，绝不污染你的正式库。
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="rounded-md bg-[var(--accent-strong)] px-2.5 py-0.5 text-[11px] font-medium text-white transition hover:bg-[var(--accent)]"
                >
                  + 创建我的正式知识库
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchVault("default", "/")}
                  className="rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-0.5 text-[11px] text-[var(--ink-muted)] transition hover:text-[var(--ink-strong)]"
                >
                  切回主库
                </button>
              </div>
            </div>
          )}

          {/* Main Workspace Viewport (keyed by activeVaultId so switching vaults cleanly refreshes all pages) */}
          <main
            className={`min-h-0 flex-1 ${
              isVaultPage ? "overflow-hidden" : "scifi-viewport-bg overflow-y-auto"
            }`}
          >
            {isVaultPage ? (
              <div key={activeVaultId} className="h-full w-full">
                {children}
              </div>
            ) : (
              <div key={isGlobalPage ? "global" : activeVaultId} className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6">
                {children}
              </div>
            )}
          </main>
        </div>
      </div>

      {/* 24px Bottom Status Bar */}
      <footer className="flex h-7 shrink-0 items-center justify-between border-t border-[var(--border)] bg-[var(--bg-deep)] px-3.5 text-xs text-[var(--ink-dim)] select-none">
        <div className="flex items-center gap-3 truncate">
          <span className="inline-flex items-center gap-1.5 font-medium text-[var(--ink-muted)]">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: activeColor }}
            />
            {activeVault?.name ?? "我的主复盘库"}
          </span>
          <span className="hidden text-[var(--ink-dim)] sm:inline">
            {vault
              ? `${vault.counts.total} 篇复盘 · ${vault.counts.topics} 主题 · ${vault.counts.links} 条双链 · ${vault.counts.manuals} 本手册`
              : "正在索引当前知识库..."}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <Link href="/settings" className="inline-flex items-center gap-1.5 hover:text-[var(--ink)]">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                provider?.configured
                  ? "bg-[var(--emerald)]"
                  : "bg-[var(--amber)]"
              }`}
            />
            <span>{provider?.configured ? `AI 模型: ${provider.model}` : "未配置 AI 模型"}</span>
          </Link>
          <span className="hidden font-mono text-[10px] text-[var(--ink-dim)] md:inline">
            本地离线优先 · 数据留在本机
          </span>
        </div>
      </footer>

      {/* Create Vault 2-Step Wizard Modal */}
      <CreateVaultModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        templates={overview?.templates}
        existingVaults={overview?.vaults}
        onCreated={(_v, nextOverview) => {
          setOverview(nextOverview);
          setActiveVaultId(nextOverview.activeVaultId);
        }}
      />

      {/* Ctrl+K Quick Switcher Modal */}
      {switcherOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--overlay)] pt-[12vh] backdrop-blur-[2px]"
          onClick={() => setSwitcherOpen(false)}
        >
          <div
            className="w-full max-w-xl overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] shadow-[var(--shadow-modal)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-3.5 py-2.5">
              <Search className="h-4 w-4 text-[var(--cyan)]" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleSwitcherKeyDown}
                placeholder="输入知识库名切换，或搜索当前库笔记、主题、功能..."
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
                <div className="py-8 text-center text-xs text-[var(--ink-dim)]">未匹配到任何知识库、笔记或功能</div>
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