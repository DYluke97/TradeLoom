"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, Copy, Download, FileText, Network, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { SynthesisReport } from "@/lib/synthesis";

export default function ReportView({ report }: { report: SynthesisReport }) {
  const [copied, setCopied] = useState(false);

  async function handleCopyMarkdown() {
    try {
      const res = await fetch(`/api/manuals?id=${encodeURIComponent(report.id)}&format=md`);
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--ink-muted)]">
              <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-[var(--accent)]">
                {report.skill_name}
              </span>
              {report.source_mode === "manuals" && (
                <span className="rounded-full border border-[var(--cyan)]/40 bg-[var(--cyan-soft)] px-2.5 py-0.5 text-[var(--cyan)]">
                  Map-Reduce 阶段二次综合
                </span>
              )}
              {report.source_mode === "mixed" && (
                <span className="rounded-full border border-[var(--cyan)]/40 bg-[var(--cyan-soft)] px-2.5 py-0.5 text-[var(--cyan)]">
                  阶段手册 + 原文混合综合
                </span>
              )}
              <span>模型：{report.model}</span>
              <span>·</span>
              <span>
                样本区间：{report.date_range.from ?? "—"} ~ {report.date_range.to ?? "—"}
              </span>
            </div>
            <h2 className="mt-2 text-xl font-bold text-[#f3f4f6]">{report.title}</h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/vault?card=${encodeURIComponent(`40-交易手册/${report.id}.md`)}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-1.5 text-xs font-medium text-[var(--accent)] hover:border-[var(--accent)]/60"
            >
              <Network className="h-3.5 w-3.5" />
              在双链库中查看
            </Link>
            <button
              type="button"
              onClick={handleCopyMarkdown}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] hover:border-[var(--accent)]/60"
            >
              <Copy className="h-3.5 w-3.5" />
              {copied ? "已复制 Obsidian MD" : "复制 Obsidian MD"}
            </button>
            <a
              href={`/api/manuals?id=${encodeURIComponent(report.id)}&format=md`}
              download={`${report.id}.md`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-strong)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--accent)]"
            >
              <Download className="h-3.5 w-3.5" />
              下载手册 (.md)
            </a>
          </div>
        </div>

        {/* Summary & KPI */}
        <p className="mt-4 text-sm leading-7 text-[var(--ink)]">{report.overview.summary}</p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] p-3">
            <div className="text-[11px] text-[var(--ink-dim)]">纳入复盘样本</div>
            <div className="mt-1 text-lg font-bold text-[#f3f4f6]">{report.statistics.docs_count} 篇</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] p-3">
            <div className="text-[11px] text-[var(--ink-dim)]">方法演变节点</div>
            <div className="mt-1 text-lg font-bold text-[var(--accent)]">{report.statistics.timeline_count} 个</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] p-3">
            <div className="text-[11px] text-[var(--ink-dim)]">沉淀交易规则</div>
            <div className="mt-1 text-lg font-bold text-[var(--emerald)]">{report.statistics.rules_count} 条</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] p-3">
            <div className="text-[11px] text-[var(--ink-dim)]">逐字核验原文证据</div>
            <div className="mt-1 text-lg font-bold text-[#f3f4f6]">{report.statistics.evidence_used} 段</div>
          </div>
        </div>

        {report.warnings.length > 0 && (
          <div className="mt-4 rounded-lg border border-[var(--amber)]/30 bg-[var(--amber-soft)] p-3 text-xs text-[var(--amber)]">
            <div className="font-medium">证据核验提示：</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {report.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Evolution Timeline */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="mb-4 flex items-center gap-2">
          <Clock className="h-4 w-4 text-[var(--amber)]" />
          <h3 className="text-base font-semibold text-[#f1f2f5]">方法演变时间轴</h3>
        </div>

        {report.timeline.length === 0 ? (
          <p className="text-sm text-[var(--ink-muted)]">本次未提炼出独立的时间轴节点。</p>
        ) : (
          <div className="relative space-y-5 border-l border-[var(--border-strong)] pl-5">
            {report.timeline.map((node, idx) => (
              <div key={idx} className="relative">
                <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--surface)] bg-[var(--accent)]" />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-[var(--surface-2)] px-2 py-0.5 font-mono text-xs text-[var(--amber)]">
                    {node.period}
                  </span>
                  <span className="text-sm font-semibold text-[#f1f2f5]">{node.label}</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-[var(--ink)]">{node.change}</p>
                <div className="mt-2.5 space-y-1.5">
                  {node.evidence.map((ev) => (
                    <div
                      key={ev.evidence_id}
                      className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] px-3 py-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2 text-[var(--ink-muted)]">
                        <Link
                          href={`/vault?card=${encodeURIComponent(ev.card)}`}
                          className="inline-flex items-center gap-1 font-medium text-[var(--accent)] hover:underline"
                        >
                          <FileText className="h-3 w-3" />
                          [[{ev.title}]]
                        </Link>
                        <span className="font-mono text-[11px]">{ev.event_date ?? "未标日期"}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[var(--ink-muted)]">“{ev.quote}”</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Personal Playbook Rules */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[var(--emerald)]" />
          <h3 className="text-base font-semibold text-[#f1f2f5]">个人交易手册（有据规则卡）</h3>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {report.manual.map((rule) => (
            <div
              key={rule.id}
              className="flex flex-col justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-deep)] p-4"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded bg-[var(--emerald-soft)] px-2 py-0.5 font-mono text-xs font-semibold text-[var(--emerald)]">
                    {rule.id}
                  </span>
                  <span className="text-[11px] text-[var(--ink-dim)]">
                    {rule.known_dates.length >= 2
                      ? `跨 ${rule.known_dates.length} 个时点印证`
                      : rule.known_dates[0] || "单次观察"}
                  </span>
                </div>
                <h4 className="mt-2 text-sm font-semibold text-[#f1f2f5]">{rule.title}</h4>

                <dl className="mt-3 space-y-2 text-xs leading-5">
                  <div>
                    <dt className="text-[var(--ink-dim)]">适用情境（Context）</dt>
                    <dd className="mt-0.5 text-[var(--ink)]">{rule.context || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--ink-dim)]">触发条件（Condition）</dt>
                    <dd className="mt-0.5 text-[var(--ink)]">{rule.condition || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--emerald)]">执行动作（Action）</dt>
                    <dd className="mt-0.5 text-[#f1f2f5]">{rule.action || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--amber)]">退出 / 证伪边界（Exit）</dt>
                    <dd className="mt-0.5 text-[var(--ink)]">{rule.exit || "—"}</dd>
                  </div>
                  <div className="rounded-lg border border-[var(--rose)]/25 bg-[var(--rose-soft)] p-2">
                    <dt className="flex items-center gap-1 font-medium text-[var(--rose)]">
                      <AlertTriangle className="h-3 w-3" />
                      反例与失效条件（Counterexample）
                    </dt>
                    <dd className="mt-1 text-[var(--ink)]">{rule.counterexample || "—"}</dd>
                  </div>
                </dl>
              </div>

              <div className="mt-3 border-t border-[var(--border)] pt-2.5">
                <div className="mb-1.5 flex items-center gap-1 text-[11px] text-[var(--emerald)]">
                  <CheckCircle2 className="h-3 w-3" />
                  逐字原文溯源（{rule.evidence.length}）
                </div>
                <div className="space-y-1">
                  {rule.evidence.map((ev) => (
                    <Link
                      key={ev.evidence_id}
                      href={`/vault?card=${encodeURIComponent(ev.card)}`}
                      className="block rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] hover:border-[var(--accent)]/50"
                    >
                      <span className="font-medium text-[var(--accent)]">[[{ev.title}]]</span>
                      <span className="ml-2 font-mono text-[var(--ink-dim)]">{ev.event_date ?? ""}</span>
                      <p className="mt-0.5 line-clamp-2 text-[var(--ink-muted)]">“{ev.quote}”</p>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
