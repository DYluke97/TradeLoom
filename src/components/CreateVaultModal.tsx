"use client";

import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Cloud,
  FileUp,
  FolderOpen,
  Globe,
  Loader2,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { VAULT_ACCENT_COLORS, type VaultSummary, type VaultTemplateId, type VaultsOverview } from "@/lib/vault-types";

type TemplateSummary = VaultsOverview["templates"][number];

const FALLBACK_TEMPLATES: TemplateSummary[] = [
  {
    id: "short-term",
    name: "A 股短线 / 龙头情绪",
    badge: "情绪周期 · 梯队 · 止损",
    description: "适合打板、龙头低吸、题材轮动复盘，预置短线情绪与风控词典。",
    color: "#2d5f8b",
    defaultSkillId: "short-term",
    conceptCount: 6,
  },
  {
    id: "fundamental",
    name: "中长线价值 / 财报基本面",
    badge: "行业景气 · 现金流 · 估值锚",
    description: "适合财报跟踪、行业研报、公司深度研究，预置财务排雷词典。",
    color: "#0f766e",
    defaultSkillId: "fundamental",
    conceptCount: 6,
  },
  {
    id: "trend-swing",
    name: "趋势波段 / 期货与右侧",
    badge: "右侧趋势 · 量价 · 盈亏比",
    description: "适合右侧趋势交易、商品期货、ETF 波段，预置量价与风控词典。",
    color: "#b4690e",
    defaultSkillId: "trend-swing",
    conceptCount: 6,
  },
  {
    id: "custom",
    name: "大师体系拆解 / 通用空白",
    badge: "综合词典 · 自由定制",
    description: "适合拆解某位大 V/前辈完整体系、读书笔记或跨市场复盘。",
    color: "#217a56",
    defaultSkillId: "general",
    conceptCount: 10,
  },
];

export function dispatchVaultChanged(vaultId?: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("tradeloom:vault-changed", { detail: { vaultId } }));
  }
}

export default function CreateVaultModal({
  open,
  onClose,
  templates,
  existingVaults,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  templates?: TemplateSummary[];
  existingVaults?: VaultSummary[];
  onCreated?: (vault: VaultSummary, overview: VaultsOverview) => void;
}) {
  const router = useRouter();
  const tplList = templates && templates.length > 0 ? templates : FALLBACK_TEMPLATES;

  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [templateId, setTemplateId] = useState<VaultTemplateId>("short-term");
  const [color, setColor] = useState("#7c4dff");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [externalSourceDir, setExternalSourceDir] = useState("");
  const [cloneFromId, setCloneFromId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createdVault, setCreatedVault] = useState<VaultSummary | null>(null);

  useEffect(() => {
    if (open) {
      setStep(1);
      setName("");
      setDescription("");
      setTemplateId("short-term");
      setColor("#7c4dff");
      setShowAdvanced(false);
      setExternalSourceDir("");
      setCloneFromId("");
      setError("");
      setCreatedVault(null);
    }
  }, [open]);

  if (!open) return null;

  function selectTemplate(tpl: TemplateSummary) {
    setTemplateId(tpl.id);
    setColor(tpl.color);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("先给这个知识库起个名字吧，比如「A股短线实盘」或「价值研报库」");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/vaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: name.trim(),
          description: description.trim(),
          templateId,
          color,
          externalSourceDir: externalSourceDir.trim() || undefined,
          cloneConceptsFromVaultId: cloneFromId || undefined,
          activate: true,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "创建知识库失败");
        return;
      }
      const created = data.vault as VaultSummary;
      setCreatedVault(created);
      dispatchVaultChanged(created.id);
      onCreated?.(created, data as VaultsOverview);
      setStep(2);
    } catch {
      setError("网络请求失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  function finishAndNavigate(href: string) {
    onClose();
    router.push(href);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)] shadow-[var(--shadow-modal)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-deep)]/90 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-lg text-white shadow-sm"
              style={{ background: `linear-gradient(135deg, ${color}, #22d3ee)` }}
            >
              {step === 1 ? <Plus className="h-[19px] w-[19px]" /> : <Check className="h-[19px] w-[19px]" />}
            </span>
            <div>
              <h2 className="text-sm font-semibold text-[var(--ink-strong)]">
                {step === 1 ? "新建独立双链知识库" : `已创建并切换至「${createdVault?.name}」`}
              </h2>
              <p className="text-[11px] text-[var(--ink-dim)]">
                {step === 1
                  ? "每个知识库拥有独立的复盘原稿、双链星图、关键词词典、交割账本与方法论手册"
                  : "下一步：选择一种最顺手的方式导入首批复盘素材（大模型和云端账号全局通用）"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--ink-dim)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
          >
            <X className="h-[19px] w-[19px]" />
          </button>
        </div>

        {step === 1 ? (
          <form onSubmit={handleCreate} className="max-h-[78vh] space-y-4 overflow-y-auto p-5">
            {/* Step 1: Name & Color */}
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--ink)]">
                  1. 给这套方法论 / 知识库起个名字 <span className="text-[var(--rose)]">*</span>
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：A股短线实盘、美股财报基本面、某前辈体系拆解"
                  autoFocus
                  className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink-dim)] focus:border-[var(--cyan)] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--ink)]">标识色</label>
                <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-2.5 py-2">
                  {VAULT_ACCENT_COLORS.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => setColor(hex)}
                      className={`h-5 w-5 rounded-full transition ${
                        color === hex ? "scale-110 ring-2 ring-white ring-offset-2 ring-offset-[#0f1422]" : "opacity-75 hover:opacity-100"
                      }`}
                      style={{ backgroundColor: hex }}
                      title={hex}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--ink-muted)]">
                一句话备注（可选，方便多库并行时一眼区分）
              </label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="例如：专注 2026 年主板连板情绪周期与回撤风控"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] px-3 py-1.5 text-xs text-[var(--ink)] placeholder:text-[var(--ink-dim)] focus:border-[var(--cyan)] focus:outline-none"
              />
            </div>

            {/* Step 2: 流派模板 */}
            <div>
              <label className="mb-2 block text-xs font-medium text-[var(--ink)]">
                2. 选择开箱模板（自动配置本库双链关键词与默认 AI 提炼规则）
              </label>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {tplList.map((tpl) => {
                  const active = templateId === tpl.id;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => selectTemplate(tpl)}
                      className={`rounded-xl border p-3 text-left transition ${
                        active
                          ? "border-[var(--cyan)] bg-[var(--cyan-soft)]/50"
                          : "border-[var(--border)] bg-[var(--bg-deep)]/85 hover:border-[var(--border-strong)] hover:bg-[var(--surface)]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--ink-strong)]">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tpl.color }} />
                          {tpl.name}
                        </span>
                        <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-dim)]">
                          {tpl.conceptCount} 组词典
                        </span>
                      </div>
                      <div className="mt-1 text-[10px] font-medium text-[var(--cyan)]">{tpl.badge}</div>
                      <p className="mt-1 text-[11px] leading-4 text-[var(--ink-muted)]">{tpl.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Advanced Collapsible */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-deep)]/65">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex w-full items-center justify-between px-3.5 py-2.5 text-xs font-medium text-[var(--ink-muted)] hover:text-[var(--ink)]"
              >
                <span className="inline-flex items-center gap-1.5">
                  <FolderOpen className="h-[17px] w-[17px] text-[var(--ink-dim)]" />
                  高级选项（挂载本机已有文件夹 / 复制已有库词典）
                </span>
                {showAdvanced ? <ChevronUp className="h-[17px] w-[17px]" /> : <ChevronDown className="h-[17px] w-[17px]" />}
              </button>
              {showAdvanced && (
                <div className="space-y-3 border-t border-[var(--border)] px-3.5 py-3">
                  <div>
                    <label className="mb-1 block text-[11px] text-[var(--ink-muted)]">
                      挂载本机已有复盘文件夹 / 现有 Obsidian 目录（可选，留空则在软件内独立托管）
                    </label>
                    <input
                      value={externalSourceDir}
                      onChange={(e) => setExternalSourceDir(e.target.value)}
                      placeholder="例如：D:\我的Obsidian库\交易复盘（只读取笔记，不往原目录写入杂项配置）"
                      className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 font-mono text-xs text-[var(--ink)] placeholder:text-[var(--ink-dim)] focus:border-[var(--cyan)] focus:outline-none"
                    />
                  </div>
                  {existingVaults && existingVaults.length > 0 && (
                    <div>
                      <label className="mb-1 block text-[11px] text-[var(--ink-muted)]">
                        直接复用某个已有知识库的自定义关键词词典（可选）
                      </label>
                      <select
                        value={cloneFromId}
                        onChange={(e) => setCloneFromId(e.target.value)}
                        className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--ink)] focus:border-[var(--cyan)] focus:outline-none"
                      >
                        <option value="">使用上方所选模板默认词典</option>
                        {existingVaults.map((v) => (
                          <option key={v.id} value={v.id}>
                            复制「{v.name}」的关键词词典
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-[var(--rose)]">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-[var(--border-strong)] px-3.5 py-2 text-xs text-[var(--ink-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-strong)] px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-[17px] w-[17px] animate-spin" /> : <Sparkles className="h-[17px] w-[17px]" />}
                {busy ? "正在创建知识库..." : "创建并进入下一步"}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4 p-5">
            <div className="rounded-xl border border-[var(--emerald)]/35 bg-[var(--emerald-soft)]/50 px-3.5 py-2.5 text-xs text-[var(--emerald)]">
              独立知识库「<strong>{createdVault?.name}</strong>」已就绪！它拥有独立的双链图谱、词典、交割账本与手册历史。
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => finishAndNavigate("/vault")}
                className="group flex flex-col justify-between rounded-xl border border-[var(--border-strong)] bg-[var(--bg-deep)] p-4 text-left transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]/30"
              >
                <div>
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
                    <FileUp className="h-4.5 w-4.5" />
                  </div>
                  <div className="mt-3 text-xs font-semibold text-[var(--ink-strong)]">拖入本地文档</div>
                  <p className="mt-1 text-[11px] leading-5 text-[var(--ink-muted)]">
                    直接拖入 Word、PDF、Markdown、TXT 或印象笔记导出的 HTML。
                  </p>
                </div>
                <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent)]">
                  去导入本地文件 <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => finishAndNavigate("/sync")}
                className="group flex flex-col justify-between rounded-xl border border-[var(--border-strong)] bg-[var(--bg-deep)] p-4 text-left transition hover:border-[var(--cyan)] hover:bg-[var(--cyan-soft)]/30"
              >
                <div>
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--cyan-soft)] text-[var(--cyan)]">
                    <Cloud className="h-4.5 w-4.5" />
                  </div>
                  <div className="mt-3 text-xs font-semibold text-[var(--ink-strong)]">连 9 大云端平台</div>
                  <p className="mt-1 text-[11px] leading-5 text-[var(--ink-muted)]">
                    飞书 / Notion / 语雀 / 滴答 / 腾讯文档 / ima / 有道 / OneNote / 印象笔记一键同步。
                  </p>
                </div>
                <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--cyan)]">
                  去云端同步中心 <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => finishAndNavigate("/vault?import=cloud")}
                className="group flex flex-col justify-between rounded-xl border border-[var(--border-strong)] bg-[var(--bg-deep)] p-4 text-left transition hover:border-[var(--emerald)] hover:bg-[var(--emerald-soft)]/30"
              >
                <div>
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--emerald-soft)] text-[var(--emerald)]">
                    <Globe className="h-4.5 w-4.5" />
                  </div>
                  <div className="mt-3 text-xs font-semibold text-[var(--ink-strong)]">粘贴或抓网页链接</div>
                  <p className="mt-1 text-[11px] leading-5 text-[var(--ink-muted)]">
                    批量粘贴雪球长文、微信公众号链接，或直接 Ctrl+V 富文本入库。
                  </p>
                </div>
                <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--emerald)]">
                  去抓取 / 粘贴 <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </div>
              </button>
            </div>

            <div className="flex justify-end border-t border-[var(--border)] pt-3">
              <button
                type="button"
                onClick={() => finishAndNavigate("/")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 py-2 text-xs font-medium text-[var(--ink)] transition hover:border-[var(--cyan)] hover:text-[var(--cyan)]"
              >
                暂不导入，先进入「{createdVault?.name}」工作台
                <ArrowRight className="h-[17px] w-[17px]" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}