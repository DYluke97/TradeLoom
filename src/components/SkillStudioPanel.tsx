"use client";

import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Copy,
  Edit3,
  Eye,
  FileCode2,
  Lock,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import MarkdownView from "@/components/MarkdownView";
import { parseMarkdown } from "@/lib/markdown";
import type { SkillSpec } from "@/lib/skills";

const CLIENT_SKILL_TEMPLATE = `# 我的自定义交易分析 Skill

> 这份 Skill 为大模型提炼复盘提供专属分析框架，所有提炼出的规则都必须有复盘原文证据支持，原文未提及的维度不得脑补。

## 核心审视维度

1. **市场环境与周期定位**：界定当前所处的市场阶段、主线强弱与风险偏好。
2. **选股与标的筛选标准**：提炼核心驱动逻辑、基本面/技术面门槛及排除条件。
3. **买入触发与仓位分配**：明确可观测的入场信号、分批节奏与单票/总仓位上限。
4. **退出、止损与风控红线**：写清不及预期退出、回撤降仓或去杠杆的硬性纪律。
5. **情绪心态与高频反例**：记录导致大亏的心理误区、追高/扛单模式及纠偏动作。

## 提示词聚焦要求

- 每条规则必须写清 \`context\`（适用环境）、\`condition\`（可观测触发条件）、\`action\`（仓位与动作）、\`exit\`（退出/止损纪律）与 \`counterexample\`（失败反例）；
- 原文未涉及的维度保持留白或如实标注缺口，绝不编造原文未出现的数据、标的或收益。
`;

type EditorMode = "view-readonly" | "edit-custom" | "create";

type Props = {
  initialSkills?: SkillSpec[];
  onSkillsChange?: (skills: SkillSpec[]) => void;
};

function makeUniqueCloneId(baseId: string, existingIds: Set<string>): string {
  const cleanBase = baseId
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "custom";
  const prefix = cleanBase.startsWith("my-") ? cleanBase : `my-${cleanBase}`;
  if (!existingIds.has(prefix)) return prefix;
  for (let i = 2; i < 100; i++) {
    const candidate = `${prefix}-${i}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `${prefix}-${Date.now().toString(36).slice(-4)}`;
}

export default function SkillStudioPanel({ initialSkills, onSkillsChange }: Props) {
  const [skills, setSkills] = useState<SkillSpec[]>(initialSkills ?? []);
  const [selectedId, setSelectedId] = useState<string>("short-term");
  const [mode, setMode] = useState<EditorMode>("view-readonly");
  const [previewTab, setPreviewTab] = useState<"edit" | "preview">("edit");

  // Form state for create / edit-custom
  const [draftId, setDraftId] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftSummary, setDraftSummary] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [draftContent, setDraftContent] = useState("");

  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (initialSkills && initialSkills.length > 0) {
      setSkills(initialSkills);
      return;
    }
    fetch("/api/skills", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && Array.isArray(d.skills)) {
          setSkills(d.skills);
          onSkillsChange?.(d.skills);
        }
      });
  }, [initialSkills, onSkillsChange]);

  const existingIds = useMemo(() => new Set(skills.map((s) => s.id)), [skills]);
  const builtinSkills = useMemo(() => skills.filter((s) => s.builtin), [skills]);
  const customSkills = useMemo(() => skills.filter((s) => !s.builtin), [skills]);
  const selectedSkill = useMemo(
    () => skills.find((s) => s.id === selectedId) ?? builtinSkills[1] ?? skills[0] ?? null,
    [skills, selectedId, builtinSkills],
  );

  function selectSkill(sk: SkillSpec) {
    setSelectedId(sk.id);
    setMsg("");
    setErr("");
    setConfirmDelete(false);
    if (sk.editable) {
      setMode("edit-custom");
      setPreviewTab("edit");
      setDraftId(sk.id);
      setDraftName(sk.name);
      setDraftSummary(sk.summary);
      setDraftTags(sk.tags.join(", "));
      setDraftContent(sk.content);
    } else {
      setMode("view-readonly");
    }
  }

  function startCreateBlank() {
    setMsg("");
    setErr("");
    setConfirmDelete(false);
    setMode("create");
    setPreviewTab("edit");
    const suggestedId = makeUniqueCloneId("strategy", existingIds);
    setDraftId(suggestedId);
    setDraftName("");
    setDraftSummary("");
    setDraftTags("自定义框架, 交易纪律");
    setDraftContent(CLIENT_SKILL_TEMPLATE);
  }

  function startCloneFrom(source: SkillSpec) {
    setMsg("");
    setErr("");
    setConfirmDelete(false);
    setMode("create");
    setPreviewTab("edit");
    const suggestedId = makeUniqueCloneId(source.id === "general" ? "general-custom" : source.id, existingIds);
    setDraftId(suggestedId);
    setDraftName(`${source.name}（自定义版）`);
    setDraftSummary(source.summary);
    setDraftTags(source.tags.join(", "));
    setDraftContent(source.content || CLIENT_SKILL_TEMPLATE);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    setErr("");
    setBusy(true);
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: draftId,
          name: draftName,
          summary: draftSummary,
          tags: draftTags,
          content: draftContent,
        }),
      });
      const data = await res.json();
      if (data.ok && data.skill && Array.isArray(data.skills)) {
        setSkills(data.skills);
        onSkillsChange?.(data.skills);
        setSelectedId(data.skill.id);
        setMode("edit-custom");
        setDraftId(data.skill.id);
        setDraftName(data.skill.name);
        setDraftSummary(data.skill.summary);
        setDraftTags((data.skill.tags ?? []).join(", "));
        setDraftContent(data.skill.content);
        setMsg(`已保存至本地 workspace/skills/${data.skill.id}.md（已被 .gitignore 隔离），在「阶段提炼」页面可直接选用。`);
      } else {
        setErr(data.error || "保存 Skill 失败");
      }
    } catch (error) {
      setErr(error instanceof Error ? error.message : "网络错误，保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!selectedSkill || !selectedSkill.editable) return;
    setMsg("");
    setErr("");
    setBusy(true);
    try {
      const res = await fetch(`/api/skills?id=${encodeURIComponent(selectedSkill.id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.skills)) {
        setSkills(data.skills);
        onSkillsChange?.(data.skills);
        setConfirmDelete(false);
        const fallback = data.skills.find((s: SkillSpec) => s.id === "short-term") ?? data.skills[0];
        if (fallback) {
          setSelectedId(fallback.id);
          setMode(fallback.editable ? "edit-custom" : "view-readonly");
        }
        setMsg(`已删除自定义 Skill「${selectedSkill.name}」。`);
      } else {
        setErr(data.error || "删除 Skill 失败");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Intro banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-3.5">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ink-strong)]">
            <Sparkles className="h-[17px] w-[17px] text-[var(--accent)]" />
            分析 Skill 工坊（自定义交易方法论提炼框架）
          </div>
          <p className="text-xs text-[var(--ink-muted)]">
            内置 Skill 保持只读受保护；你可以<strong>一键克隆内置框架魔改</strong>或<strong>新建空白 Skill</strong>，自动保存至本地{" "}
            <code className="font-mono text-[11px] text-[var(--cyan)]">workspace/skills/*.md</code>（不污染开源仓库），立即在「阶段提炼」生效。
          </p>
        </div>
        <button
          type="button"
          onClick={startCreateBlank}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-strong)] px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-[var(--accent)]"
        >
          <Plus className="h-[15px] w-[15px]" />
          新建自定义 Skill
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[290px_minmax(0,1fr)]">
        {/* Left Skill Directory */}
        <aside className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          {/* Custom Workspace Skills */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--cyan)]">
                我的自定义 Skill ({customSkills.length})
              </span>
              <span className="font-mono text-[10px] text-[var(--ink-dim)]">workspace/skills</span>
            </div>

            {customSkills.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--bg-deep)]/60 p-3 text-[11px] leading-5 text-[var(--ink-dim)]">
                还没有自定义 Skill。点击上方「新建自定义 Skill」，或在下方选中内置 Skill 点击「克隆魔改」。
              </div>
            ) : (
              <div className="space-y-1.5">
                {customSkills.map((sk) => {
                  const active = mode !== "create" && selectedSkill?.id === sk.id;
                  return (
                    <button
                      key={sk.id}
                      type="button"
                      onClick={() => selectSkill(sk)}
                      className={`w-full rounded-lg border p-2.5 text-left transition ${
                        active
                          ? "border-[var(--cyan)] bg-[var(--cyan-soft)]/50"
                          : "border-[var(--border)] bg-[var(--bg-deep)] hover:border-[var(--border-strong)]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-semibold text-[var(--ink-strong)]">{sk.name}</span>
                        <span className="shrink-0 rounded bg-[var(--emerald-soft)] px-1.5 py-0.5 text-[10px] text-[var(--emerald)]">
                          {sk.editable ? "可编辑" : "仓库"}
                        </span>
                      </div>
                      <div className="mt-1 truncate font-mono text-[10px] text-[var(--ink-dim)]">{sk.id}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Built-in Presets */}
          <div className="space-y-2 border-t border-[var(--border)] pt-4">
            <div className="flex items-center justify-between px-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                内置预设 Skill ({builtinSkills.length})
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] text-[var(--ink-dim)]">
                <Lock className="h-2.5 w-2.5" />
                只读可克隆
              </span>
            </div>

            <div className="space-y-1.5">
              {builtinSkills.map((sk) => {
                const active = mode !== "create" && selectedSkill?.id === sk.id;
                return (
                  <button
                    key={sk.id}
                    type="button"
                    onClick={() => selectSkill(sk)}
                    className={`w-full rounded-lg border p-2.5 text-left transition ${
                      active
                        ? "border-[var(--accent)] bg-[var(--accent-soft)]/70"
                        : "border-[var(--border)] bg-[var(--bg-deep)] hover:border-[var(--border-strong)]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-semibold text-[var(--ink-strong)]">{sk.name}</span>
                      <span className="shrink-0 rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--ink-dim)]">
                        内置
                      </span>
                    </div>
                    <div className="mt-1 truncate font-mono text-[10px] text-[var(--ink-dim)]">{sk.id}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* Right Detail / Editor Workspace */}
        <section className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          {msg && (
            <div className="flex items-center gap-2 rounded-lg border border-[var(--emerald)]/40 bg-[var(--emerald-soft)] p-3 text-xs text-[var(--emerald)]">
              <CheckCircle2 className="h-[17px] w-[17px] shrink-0" />
              <span>{msg}</span>
            </div>
          )}
          {err && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-[var(--rose)]">{err}</div>
          )}

          {mode === "view-readonly" && selectedSkill ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] pb-4">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-[var(--ink-strong)]">{selectedSkill.name}</h3>
                    <span className="rounded border border-[var(--border)] bg-[var(--bg-deep)] px-2 py-0.5 font-mono text-[10px] text-[var(--ink-dim)]">
                      {selectedSkill.id}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[10px] text-[var(--ink-muted)]">
                      <Lock className="h-2.5 w-2.5" />
                      {selectedSkill.builtin ? "内置只读模板" : "仓库只读文件"}
                    </span>
                  </div>
                  <p className="text-xs leading-6 text-[var(--ink-muted)]">{selectedSkill.summary}</p>
                  {selectedSkill.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {selectedSkill.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] text-[var(--accent)]"
                        >
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => startCloneFrom(selectedSkill)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-strong)] px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-[var(--accent)]"
                  >
                    <Copy className="h-[15px] w-[15px]" />
                    基于此 Skill 克隆魔改
                  </button>
                  <Link
                    href={`/synthesize?skill=${encodeURIComponent(selectedSkill.id)}`}
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-2 text-xs text-[var(--ink)] transition hover:border-[var(--cyan)]/60 hover:text-[var(--cyan)]"
                  >
                    去提炼使用
                    <ArrowRight className="h-[15px] w-[15px]" />
                  </Link>
                </div>
              </div>

              {selectedSkill.content ? (
                <div className="max-h-[540px] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] p-5">
                  <MarkdownView parsed={parseMarkdown(selectedSkill.content)} />
                </div>
              ) : (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] p-5 text-xs leading-6 text-[var(--ink-muted)]">
                  <strong>「综合阶段归纳（general）」</strong>不预设额外交易流派框架，完全忠实于你勾选的原始复盘笔记自由归纳时间轴与规则。
                  如果你想从零构建一套带有专属分析维度的提示词骨架，可点击右上角「基于此 Skill 克隆魔改」或「新建自定义 Skill」。
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={handleSave} className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-3">
                <div className="flex items-center gap-2">
                  <FileCode2 className="h-[17px] w-[17px] text-[var(--cyan)]" />
                  <h3 className="text-sm font-semibold text-[var(--ink-strong)]">
                    {mode === "create" ? "新建 / 克隆自定义 Skill" : `编辑自定义 Skill：${draftName || draftId}`}
                  </h3>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPreviewTab("edit")}
                    className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] transition ${
                      previewTab === "edit"
                        ? "border-[var(--cyan)] bg-[var(--cyan-soft)] text-[var(--cyan)]"
                        : "border-[var(--border)] bg-[var(--bg-deep)] text-[var(--ink-muted)]"
                    }`}
                  >
                    <Edit3 className="h-4 w-4" />
                    编辑源码
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewTab("preview")}
                    className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] transition ${
                      previewTab === "preview"
                        ? "border-[var(--cyan)] bg-[var(--cyan-soft)] text-[var(--cyan)]"
                        : "border-[var(--border)] bg-[var(--bg-deep)] text-[var(--ink-muted)]"
                    }`}
                  >
                    <Eye className="h-4 w-4" />
                    实时预览
                  </button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1 text-xs">
                  <span className="text-[var(--ink-muted)]">
                    Skill ID（唯一英文标识，保存为 <code className="font-mono text-[10px]">workspace/skills/{draftId || "id"}.md</code>）
                  </span>
                  <input
                    required
                    disabled={mode === "edit-custom"}
                    value={draftId}
                    onChange={(e) => setDraftId(e.target.value)}
                    placeholder="例如：macro-cycle 或 my-short-term"
                    className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-2 font-mono text-xs text-[var(--ink)] focus:border-[var(--cyan)] focus:outline-none disabled:opacity-60"
                  />
                </label>

                <label className="block space-y-1 text-xs">
                  <span className="text-[var(--ink-muted)]">显示名称</span>
                  <input
                    required
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    placeholder="例如：资源周期与融资风控 Skill"
                    className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-2 text-xs text-[var(--ink)] focus:border-[var(--cyan)] focus:outline-none"
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block space-y-1 text-xs sm:col-span-2">
                  <span className="text-[var(--ink-muted)]">一句话简介（展示在「阶段提炼」Skill 卡片上）</span>
                  <input
                    value={draftSummary}
                    onChange={(e) => setDraftSummary(e.target.value)}
                    placeholder="简述适用流派、核心审视维度与提炼目标"
                    className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-2 text-xs text-[var(--ink)] focus:border-[var(--cyan)] focus:outline-none"
                  />
                </label>

                <label className="block space-y-1 text-xs">
                  <span className="text-[var(--ink-muted)]">标签（逗号分隔）</span>
                  <input
                    value={draftTags}
                    onChange={(e) => setDraftTags(e.target.value)}
                    placeholder="周期股, 仓位风控, 知行合一"
                    className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-2 text-xs text-[var(--ink)] focus:border-[var(--cyan)] focus:outline-none"
                  />
                </label>
              </div>

              {previewTab === "edit" ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--ink-muted)]">
                      分析框架与提示词正文（Markdown，将在提炼时直接注入大模型 System Prompt）
                    </span>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setDraftContent(CLIENT_SKILL_TEMPLATE)}
                        className="text-[11px] text-[var(--cyan)] hover:underline"
                      >
                        重置为标准五维模板
                      </button>
                      <span className="font-mono text-[10px] text-[var(--ink-dim)]">
                        {draftContent.length} / 30000 字符
                      </span>
                    </div>
                  </div>
                  <textarea
                    required
                    rows={15}
                    value={draftContent}
                    onChange={(e) => setDraftContent(e.target.value)}
                    placeholder="用 Markdown 写下你的交易审视维度、制度前提、仓位纪律与提示词聚焦要求..."
                    className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] p-3 font-mono text-xs leading-6 text-[var(--ink)] focus:border-[var(--cyan)] focus:outline-none"
                  />
                </div>
              ) : (
                <div className="min-h-[340px] max-h-[480px] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] p-5">
                  <MarkdownView parsed={parseMarkdown(draftContent || "_正文为空_")} />
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-strong)] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[var(--accent)] disabled:opacity-50"
                  >
                    <Save className="h-[15px] w-[15px]" />
                    {busy ? "正在保存..." : mode === "create" ? "创建并启用 Skill" : "保存修改"}
                  </button>

                  {mode === "edit-custom" && selectedSkill && (
                    <>
                      <button
                        type="button"
                        onClick={() => startCloneFrom(selectedSkill)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-2 text-xs text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
                      >
                        <Copy className="h-[15px] w-[15px]" />
                        另存为副本
                      </button>
                      <Link
                        href={`/synthesize?skill=${encodeURIComponent(selectedSkill.id)}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-[var(--cyan)]/50 bg-[var(--cyan-soft)] px-3 py-2 text-xs font-medium text-[var(--cyan)] transition hover:brightness-110"
                      >
                        去「阶段提炼」使用
                        <ArrowRight className="h-[15px] w-[15px]" />
                      </Link>
                    </>
                  )}
                </div>

                {mode === "edit-custom" && selectedSkill?.editable && (
                  <div className="flex items-center gap-2">
                    {confirmDelete ? (
                      <>
                        <span className="text-[11px] text-[var(--rose)]">确认删除该自定义 Skill？</span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={handleDelete}
                          className="rounded-md bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-red-500 disabled:opacity-50"
                        >
                          确认删除
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(false)}
                          className="rounded-md border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink)]"
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(true)}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-500/35 px-3 py-2 text-xs text-[var(--rose)] transition hover:bg-red-500/10"
                      >
                        <Trash2 className="h-[15px] w-[15px]" />
                        删除 Skill
                      </button>
                    )}
                  </div>
                )}
              </div>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
