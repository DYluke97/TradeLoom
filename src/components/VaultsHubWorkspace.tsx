"use client";

import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BookOpen,
  CandlestickChart,
  Check,
  Download,
  Edit3,
  FolderKanban,
  FolderOpen,
  Loader2,
  Network,
  Play,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import CreateVaultModal, { dispatchVaultChanged } from "@/components/CreateVaultModal";
import { VAULT_ACCENT_COLORS, type VaultSummary, type VaultsOverview } from "@/lib/vault-types";

export default function VaultsHubWorkspace() {
  const router = useRouter();
  const [overview, setOverview] = useState<VaultsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  // Edit modal state
  const [editing, setEditing] = useState<VaultSummary | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editColor, setEditColor] = useState("#7c4dff");
  const [editSaving, setEditSaving] = useState(false);

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch("/api/vaults", { cache: "no-store" });
      const data = await res.json();
      if (data.ok) setOverview(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  async function handleEnterVault(vault: VaultSummary) {
    setBusyId(`enter:${vault.id}`);
    setNotice(null);
    try {
      const res = await fetch("/api/vaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "switch", id: vault.id }),
      });
      const data = await res.json();
      if (data.ok) {
        setOverview(data);
        dispatchVaultChanged(vault.id);
        router.push("/");
      } else {
        setNotice({ ok: false, text: data.error || "切换知识库失败" });
      }
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreateOrResetDemo() {
    setDemoBusy(true);
    setNotice(null);
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
        setNotice({
          ok: true,
          text: "独立「体验示范库」已生成（含 6 篇复盘 + 示例交割账本 + 免配模型示范手册），可随时进入预览或删除。",
        });
      } else {
        setNotice({ ok: false, text: data.error || "生成体验示范库失败" });
      }
    } finally {
      setDemoBusy(false);
    }
  }

  async function handleDelete(vault: VaultSummary) {
    if (vault.isDefault) return;
    const confirmed = window.confirm(
      `确定删除知识库「${vault.name}」吗？\n\n托管目录会被安全移入 workspace/.trash/vaults/（若为外部挂载目录，绝不会删除你原本的磁盘文件夹）。`,
    );
    if (!confirmed) return;

    setBusyId(`del:${vault.id}`);
    setNotice(null);
    try {
      const res = await fetch("/api/vaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id: vault.id }),
      });
      const data = await res.json();
      if (data.ok) {
        setOverview(data);
        dispatchVaultChanged(data.activeVaultId);
        setNotice({
          ok: true,
          text: `已移除「${vault.name}」${data.trashedTo ? `（数据已安全移至 ${data.trashedTo}）` : ""}。`,
        });
      } else {
        setNotice({ ok: false, text: data.error || "删除失败" });
      }
    } finally {
      setBusyId(null);
    }
  }

  function openEdit(vault: VaultSummary) {
    setEditing(vault);
    setEditName(vault.name);
    setEditDesc(vault.description || "");
    setEditColor(vault.color || "#7c4dff");
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setEditSaving(true);
    try {
      const res = await fetch("/api/vaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          id: editing.id,
          name: editName.trim(),
          description: editDesc.trim(),
          color: editColor,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setOverview(data);
        dispatchVaultChanged(data.activeVaultId);
        setEditing(null);
        setNotice({ ok: true, text: `已更新知识库「${editName.trim()}」的配置。` });
      } else {
        setNotice({ ok: false, text: data.error || "更新失败" });
      }
    } finally {
      setEditSaving(false);
    }
  }

  if (loading && !overview) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="inline-flex items-center gap-2 text-xs text-[var(--ink-muted)]">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--cyan)]" />
          正在加载全部知识库...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <section className="scifi-card rounded-xl p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)]/35 bg-[var(--accent-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent)]">
              <FolderKanban className="h-3.5 w-3.5" />
              多 Obsidian 双链知识库并行中心
            </div>
            <h1 className="mt-2.5 text-xl font-bold text-[#f8fafc] sm:text-2xl">全部知识库大厅</h1>
            <p className="mt-1.5 text-xs leading-6 text-[var(--ink-muted)]">
              每个知识库拥有完全独立的<strong className="text-[var(--ink)]">复盘原稿、双链星图、关键词词典、实盘交割账本与方法论手册</strong>；
              你可以同时并行打磨「A 股短线实盘」「中长线财报研究」「某位前辈体系拆解」等多套方法论，互不串味，并支持一键导出独立的标准 Obsidian 库。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#7c4dff] to-[#22d3ee] px-4 py-2 text-xs font-semibold text-white shadow-[0_0_16px_rgba(34,211,238,0.28)] transition hover:brightness-110"
            >
              <Plus className="h-4 w-4" />
              新建双链知识库
            </button>
            <button
              type="button"
              disabled={demoBusy}
              onClick={handleCreateOrResetDemo}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--cyan)]/45 bg-[var(--cyan-soft)]/50 px-3.5 py-2 text-xs font-medium text-[var(--cyan)] transition hover:bg-[var(--cyan)]/20 disabled:opacity-50"
            >
              {demoBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {overview?.onboarding.hasDemoVault ? "重置体验示范库" : "生成体验示范库"}
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-[var(--border)] pt-3 text-[11px] text-[var(--ink-dim)]">
          <span>
            <strong className="text-[var(--ink-muted)]">全局共享（只配一次）：</strong>AI 大模型 API、9 大云端平台账号授权、AI 提炼规则工坊、A 股 K 线行情缓存
          </span>
          <span>
            <strong className="text-[var(--ink-muted)]">每库物理隔离：</strong>复盘笔记、双链星图、关键词词典、实盘交割账本、交易手册演进线
          </span>
        </div>
      </section>

      {notice && (
        <div
          className={`rounded-xl border px-4 py-2.5 text-xs ${
            notice.ok
              ? "border-[var(--emerald)]/35 bg-[var(--emerald-soft)]/50 text-[var(--emerald)]"
              : "border-red-500/40 bg-red-500/10 text-red-300"
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* Vault Cards Grid */}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(overview?.vaults ?? []).map((v) => {
          const isActive = v.id === overview?.activeVaultId;
          const isEntering = busyId === `enter:${v.id}`;
          const isDeleting = busyId === `del:${v.id}`;
          return (
            <div
              key={v.id}
              className={`scifi-card relative flex flex-col justify-between overflow-hidden rounded-xl p-5 transition ${
                isActive ? "ring-1 ring-[var(--cyan)]/60" : ""
              }`}
            >
              {/* Top color bar */}
              <span className="absolute inset-x-0 top-0 h-[3px]" style={{ backgroundColor: v.color }} />

              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: v.color }} />
                      <h2 className="truncate text-sm font-bold text-[#f8fafc]">{v.name}</h2>
                      {isActive && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--emerald-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--emerald)]">
                          <Check className="h-2.5 w-2.5" />
                          当前使用中
                        </span>
                      )}
                      {v.isDemo && (
                        <span className="rounded-full bg-[var(--cyan-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--cyan)]">
                          体验示范
                        </span>
                      )}
                      {v.paths.isExternal && (
                        <span className="rounded-full bg-[var(--amber-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--amber)]">
                          外部目录
                        </span>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-[var(--ink-muted)]">
                      {v.description || "独立 Obsidian 双链复盘知识库"}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => openEdit(v)}
                    title="编辑名称、备注与标识色"
                    className="rounded-md p-1.5 text-[var(--ink-dim)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* 4 mini telemetry pills */}
                <div className="grid grid-cols-4 gap-1.5 text-center">
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/85 py-2">
                    <div className="font-mono text-sm font-bold text-[#f8fafc]">{v.stats.docsCount}</div>
                    <div className="text-[10px] text-[var(--ink-dim)]">复盘</div>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/85 py-2">
                    <div className="font-mono text-sm font-bold text-[var(--accent)]">{v.stats.linksCount}</div>
                    <div className="text-[10px] text-[var(--ink-dim)]">双链</div>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/85 py-2">
                    <div className="font-mono text-sm font-bold text-[var(--amber)]">{v.stats.tradesCount}</div>
                    <div className="text-[10px] text-[var(--ink-dim)]">交割</div>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/85 py-2">
                    <div className="font-mono text-sm font-bold text-[var(--emerald)]">{v.stats.manualsCount}</div>
                    <div className="text-[10px] text-[var(--ink-dim)]">手册</div>
                  </div>
                </div>

                {/* Latest Manual or Source Dir info */}
                {v.stats.latestManualTitle ? (
                  <div className="flex items-center gap-2 rounded-lg border border-[var(--emerald)]/25 bg-[var(--emerald-soft)]/25 px-2.5 py-1.5 text-[11px] text-[var(--emerald)]">
                    <BookOpen className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">最新手册：{v.stats.latestManualTitle}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/65 px-2.5 py-1.5 text-[11px] text-[var(--ink-dim)]">
                    <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate font-mono text-[10px]">{v.paths.sourceDir}</span>
                  </div>
                )}
              </div>

              {/* Card Actions */}
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
                <button
                  type="button"
                  disabled={Boolean(busyId)}
                  onClick={() => handleEnterVault(v)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    isActive
                      ? "bg-[var(--surface-2)] text-[var(--cyan)] hover:bg-[var(--cyan-soft)]"
                      : "bg-gradient-to-r from-[#7c4dff] to-[#22d3ee] text-white hover:brightness-110"
                  }`}
                >
                  {isEntering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                  {isActive ? "进入工作台" : "切换并进入"}
                </button>

                <a
                  href={`/api/vault/export?vaultId=${encodeURIComponent(v.id)}`}
                  className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-2.5 py-1.5 text-[11px] text-[var(--ink-muted)] transition hover:border-[var(--cyan)] hover:text-[var(--cyan)]"
                  title="导出本库为独立 Obsidian 文件夹 (.zip)"
                >
                  <Download className="h-3.5 w-3.5" />
                  导出 ZIP
                </a>

                {!v.isDefault && (
                  <button
                    type="button"
                    disabled={Boolean(busyId)}
                    onClick={() => handleDelete(v)}
                    className="ml-auto inline-flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300 transition hover:bg-red-500/20 disabled:opacity-50"
                    title="安全删除（托管数据移入回收站）"
                  >
                    {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    删除
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* "+ Add New Vault" Ghost Card */}
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-deep)]/40 p-6 text-center transition hover:border-[var(--cyan)] hover:bg-[var(--cyan-soft)]/20"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--cyan)]/40 bg-[var(--cyan-soft)]/50 text-[var(--cyan)]">
            <Plus className="h-5 w-5" />
          </span>
          <div className="text-xs font-semibold text-[#f8fafc]">新建一个并行方法论知识库</div>
          <p className="max-w-[220px] text-[11px] leading-5 text-[var(--ink-dim)]">
            支持按策略/市场/大师流派隔离建库，也支持直接挂载本机已有 Obsidian 文件夹
          </p>
        </button>
      </section>

      {/* Quick Feature Explanation Footer */}
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-deep)]/70 p-3.5 text-[11px] leading-5 text-[var(--ink-muted)]">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-[var(--cyan)]">
            <Network className="h-3.5 w-3.5" />
            双链图谱互不串味
          </div>
          每个知识库拥有独立关键词词典与星图，短线情绪词不会污染价值投资研报库。
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-deep)]/70 p-3.5 text-[11px] leading-5 text-[var(--ink-muted)]">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-[var(--amber)]">
            <CandlestickChart className="h-3.5 w-3.5" />
            实盘交割账本完全隔离
          </div>
          A 股实盘、期货模拟或纯大师拆解库各自独立记账，提炼手册时不会交叉错配。
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-deep)]/70 p-3.5 text-[11px] leading-5 text-[var(--ink-muted)]">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-[var(--emerald)]">
            <Sparkles className="h-3.5 w-3.5" />
            大模型与云同步一次配置全库通用
          </div>
          只需在全局配置一次 AI 大模型与 9 大云端平台账号，任意新库即开即用。
        </div>
      </section>

      <CreateVaultModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        templates={overview?.templates}
        existingVaults={overview?.vaults}
        onCreated={(_v, nextOverview) => setOverview(nextOverview)}
      />

      {/* Edit Vault Modal */}
      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#04060c]/80 p-4 backdrop-blur-sm"
          onClick={() => setEditing(null)}
        >
          <form
            onSubmit={handleSaveEdit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md space-y-4 rounded-2xl border border-[var(--border-strong)] bg-[#0f1422] p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#f8fafc]">编辑知识库信息</h3>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded p-1 text-[var(--ink-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div>
              <label className="mb-1 block text-xs text-[var(--ink-muted)]">知识库名称</label>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
                className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-2 text-xs text-[var(--ink)] focus:border-[var(--cyan)] focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-[var(--ink-muted)]">简介备注</label>
              <input
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-2 text-xs text-[var(--ink)] focus:border-[var(--cyan)] focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs text-[var(--ink-muted)]">标识色</label>
              <div className="flex items-center gap-2">
                {VAULT_ACCENT_COLORS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => setEditColor(hex)}
                    className={`h-6 w-6 rounded-full transition ${
                      editColor === hex ? "scale-110 ring-2 ring-white ring-offset-2 ring-offset-[#0f1422]" : "opacity-75 hover:opacity-100"
                    }`}
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={editSaving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--cyan)] px-3.5 py-1.5 text-xs font-semibold text-[#041019] hover:brightness-110 disabled:opacity-50"
              >
                {editSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                保存修改
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
