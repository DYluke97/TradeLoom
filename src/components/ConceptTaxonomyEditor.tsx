"use client";

import Link from "next/link";
import { CheckCircle2, Hash, Plus, RefreshCw, RotateCcw, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { ConceptRule } from "@/lib/concepts";

type DraftRule = {
  id: string;
  concept: string;
  keywordsText: string;
  enabled: boolean;
  builtin?: boolean;
};

function toDraft(r: ConceptRule): DraftRule {
  return {
    id: r.id,
    concept: r.concept,
    keywordsText: r.keywords.join("，"),
    enabled: r.enabled,
    builtin: r.builtin,
  };
}

function fromDraft(d: DraftRule): ConceptRule {
  return {
    id: d.id,
    concept: d.concept.trim(),
    keywords: d.keywordsText
      .split(/[,，、\n]+/)
      .map((s) => s.trim())
      .filter(Boolean),
    enabled: d.enabled,
    builtin: d.builtin,
  };
}

export default function ConceptTaxonomyEditor() {
  const [rules, setRules] = useState<DraftRule[]>([]);
  const [newConcept, setNewConcept] = useState("");
  const [newKeywords, setNewKeywords] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/concepts", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && Array.isArray(data.rules)) {
          setRules(data.rules.map(toDraft));
        }
      });
  }, []);

  function handleAddRule(e: React.FormEvent) {
    e.preventDefault();
    const concept = newConcept.trim();
    const keywords = newKeywords
      .split(/[,，、\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (!concept) {
      setError("请输入主题名称（例如：可转债套利、AI算力主线）");
      return;
    }
    if (keywords.length === 0) {
      setError("请至少输入 1 个触发关键词（多个关键词用逗号分隔）");
      return;
    }
    if (rules.some((r) => r.concept.trim() === concept)) {
      setError(`主题「${concept}」已存在，请直接在下方编辑它的关键词。`);
      return;
    }

    setError("");
    setRules((prev) => [
      {
        id: `custom-${Date.now().toString(36)}`,
        concept,
        keywordsText: keywords.join("，"),
        enabled: true,
        builtin: false,
      },
      ...prev,
    ]);
    setNewConcept("");
    setNewKeywords("");
    setNotice("已添加到待编排列表，请点击「保存词典并重新编排双链」生效。");
  }

  async function handleSaveAndReweave() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const payload = rules.map(fromDraft).filter((r) => r.concept && r.keywords.length > 0);
      const res = await fetch("/api/concepts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: payload }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "保存并重排双链失败");
        return;
      }
      setRules(data.rules.map(toDraft));
      const c = data.index?.counts;
      setNotice(
        c
          ? `词典已保存并重新编排全库双链！当前共 ${c.topics} 个主题节点、${c.links} 条双向链接、${c.unlinked} 条未链接提及。`
          : "词典已保存并重新编排全库双链。",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleResetDefaults() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/concepts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      });
      const data = await res.json();
      if (data.ok) {
        setRules(data.rules.map(toDraft));
        const c = data.index?.counts;
        setNotice(
          `已恢复内置 10 组交易词典并重新编排（${c?.topics ?? 0} 个主题 · ${c?.links ?? 0} 条双链）。`,
        );
      } else {
        setError(data.error || "恢复默认失败");
      }
    } finally {
      setBusy(false);
    }
  }

  const enabledCount = rules.filter((r) => r.enabled).length;

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2">
              <Hash className="h-[17px] w-[17px] text-[var(--cyan)]" />
              <h2 className="text-sm font-semibold text-[var(--ink-strong)]">自定义主题词典 & Obsidian 双链重排</h2>
              <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 font-mono text-[10px] text-[var(--accent)]">
                已启用 {enabledCount}/{rules.length} 组
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-6 text-[var(--ink-muted)]">
              配置属于你个人交易体系的主题与触发关键词（持久化保存在 <code className="text-[var(--ink)]">workspace/concepts.json</code>）。
              保存后系统会立即扫描所有历史复盘，按你的新词典重新生成 <code className="text-[var(--cyan)]">30-主题/*.md</code> 节点并重织全库双向链接与图谱。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleResetDefaults}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-1.5 text-xs text-[var(--ink-muted)] hover:border-[var(--accent)]/50 hover:text-[var(--ink)] disabled:opacity-50"
            >
              <RotateCcw className="h-[15px] w-[15px]" />
              恢复默认 10 组
            </button>
            <button
              type="button"
              onClick={handleSaveAndReweave}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-strong)] px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-[var(--accent)] disabled:opacity-50"
            >
              {busy ? <RefreshCw className="h-[15px] w-[15px] animate-spin" /> : <Save className="h-[15px] w-[15px]" />}
              {busy ? "正在重排双链..." : "保存词典并重新编排双链"}
            </button>
          </div>
        </div>

        {notice && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--emerald)]/35 bg-[var(--emerald-soft)] px-3.5 py-2 text-xs text-[var(--emerald)]">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-[15px] w-[15px] shrink-0" />
              {notice}
            </span>
            <Link href="/vault?view=graph" className="font-medium underline">
              前往图谱查看效果 →
            </Link>
          </div>
        )}
        {error && (
          <div className="mt-4 rounded-lg border border-[var(--rose)]/35 bg-[var(--rose-soft)] px-3.5 py-2 text-xs text-[var(--rose)]">
            {error}
          </div>
        )}
      </section>

      {/* Add Custom Topic Form */}
      <form
        onSubmit={handleAddRule}
        className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:grid-cols-[200px_minmax(0,1fr)_auto]"
      >
        <div>
          <label className="block text-[11px] text-[var(--ink-dim)]">新增主题节点名称</label>
          <input
            value={newConcept}
            onChange={(e) => setNewConcept(e.target.value)}
            placeholder="例如：AI算力主线 / 可转债"
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg-deep)] px-2.5 py-1.5 text-xs text-[var(--ink)] placeholder:text-[var(--ink-dim)] focus:border-[var(--accent)] focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-[11px] text-[var(--ink-dim)]">触发关键词（用中英文逗号或顿号分隔）</label>
          <input
            value={newKeywords}
            onChange={(e) => setNewKeywords(e.target.value)}
            placeholder="例如：算力，光模块，CPO，服务器，液冷"
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg-deep)] px-2.5 py-1.5 text-xs text-[var(--ink)] placeholder:text-[var(--ink-dim)] focus:border-[var(--accent)] focus:outline-none"
          />
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            className="inline-flex h-[32px] w-full items-center justify-center gap-1 rounded-md border border-[var(--accent)]/50 bg-[var(--accent-soft)] px-3.5 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/25 sm:w-auto"
          >
            <Plus className="h-[15px] w-[15px]" />
            添加主题
          </button>
        </div>
      </form>

      {/* Editable Rule List */}
      <div className="grid gap-3 md:grid-cols-2">
        {rules.map((rule, idx) => (
          <div
            key={rule.id}
            className={`rounded-xl border p-3.5 transition ${
              rule.enabled
                ? "border-[var(--border)] bg-[var(--surface)]"
                : "border-[var(--border)]/60 bg-[var(--bg-deep)] opacity-60"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(e) =>
                    setRules((prev) =>
                      prev.map((item, i) => (i === idx ? { ...item, enabled: e.target.checked } : item)),
                    )
                  }
                  title="启用或停用该主题"
                  className="h-3.5 w-3.5 accent-[var(--accent)]"
                />
                <input
                  value={rule.concept}
                  onChange={(e) =>
                    setRules((prev) =>
                      prev.map((item, i) => (i === idx ? { ...item, concept: e.target.value } : item)),
                    )
                  }
                  className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs font-semibold text-[var(--ink-strong)] focus:border-[var(--accent)] focus:bg-[var(--bg-deep)] focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--ink-dim)]">
                  {rule.builtin ? "内置" : "自定义"}
                </span>
                <button
                  type="button"
                  onClick={() => setRules((prev) => prev.filter((_, i) => i !== idx))}
                  title="删除该主题规则"
                  className="rounded p-1 text-[var(--ink-dim)] hover:bg-[var(--rose-soft)] hover:text-[var(--rose)]"
                >
                  <Trash2 className="h-[15px] w-[15px]" />
                </button>
              </div>
            </div>

            <div className="mt-2">
              <input
                value={rule.keywordsText}
                onChange={(e) =>
                  setRules((prev) =>
                    prev.map((item, i) => (i === idx ? { ...item, keywordsText: e.target.value } : item)),
                  )
                }
                placeholder="输入关键词，以逗号分隔..."
                className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-deep)] px-2.5 py-1.5 text-xs text-[var(--ink-muted)] focus:border-[var(--accent)] focus:text-[var(--ink)] focus:outline-none"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
