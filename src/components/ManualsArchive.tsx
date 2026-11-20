"use client";

import Link from "next/link";
import { BookOpen, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import ReportView from "@/components/ReportView";
import type { SynthesisReport } from "@/lib/synthesis";

export default function ManualsArchive() {
  const [manuals, setManuals] = useState<SynthesisReport[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/manuals", { cache: "no-store" });
      const data = await res.json();
      if (data.ok) {
        setManuals(data.manuals);
        if (data.manuals.length > 0 && !activeId) {
          setActiveId(data.manuals[0].id);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDelete(id: string) {
    await fetch(`/api/manuals?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setManuals((prev) => {
      const next = prev.filter((m) => m.id !== id);
      if (activeId === id) setActiveId(next[0]?.id ?? null);
      return next;
    });
  }

  const active = manuals.find((m) => m.id === activeId) ?? null;

  if (loading) {
    return <div className="py-12 text-center text-sm text-[var(--ink-muted)]">正在加载交易手册归档...</div>;
  }

  if (manuals.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] p-12 text-center">
        <BookOpen className="mx-auto h-8 w-8 text-[var(--accent)] opacity-80" />
        <h2 className="mt-3 text-base font-semibold text-[var(--ink)]">尚未沉淀任何个人交易手册</h2>
        <p className="mt-1.5 text-xs text-[var(--ink-muted)]">
          前往「阶段提炼」勾选一段时期的复盘样本，选择短线或基本面 Skill 生成你的第一份可回溯交易手册。
        </p>
        <Link
          href="/synthesize"
          className="mt-4 inline-flex items-center rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[#111]"
        >
          前往阶段提炼
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[290px_minmax(0,1fr)]">
      <aside className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
        <div className="px-1 text-xs font-semibold text-[var(--ink)]">已沉淀手册（{manuals.length}）</div>
        <div className="space-y-1.5">
          {manuals.map((m) => {
            const isActive = m.id === active?.id;
            return (
              <div
                key={m.id}
                className={`group flex items-start justify-between gap-2 rounded-lg border p-2.5 transition ${
                  isActive
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]/70"
                    : "border-[var(--border)] bg-[var(--bg)] hover:border-[var(--border-strong)]"
                }`}
              >
                <button type="button" onClick={() => setActiveId(m.id)} className="min-w-0 flex-1 text-left">
                  <div className="truncate text-xs font-semibold text-[var(--ink)]">{m.title}</div>
                  <div className="mt-1 text-[11px] text-[var(--ink-dim)]">
                    {m.statistics.rules_count} 条规则 · {m.statistics.timeline_count} 节点 · {m.created_at.slice(0, 10)}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(m.id)}
                  title="删除该手册"
                  className="rounded p-1 text-[var(--ink-dim)] opacity-0 hover:text-[var(--rose)] group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      <div>{active && <ReportView report={active} />}</div>
    </div>
  );
}
