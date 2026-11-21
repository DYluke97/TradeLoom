"use client";

import Link from "next/link";
import {
  AlertTriangle,
  CandlestickChart,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  FileText,
  Flame,
  GitBranch,
  Network,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import type { RuleLifecycle, SynthesisReport } from "@/lib/synthesis";

function LifecycleBadge({ lifecycle }: { lifecycle?: RuleLifecycle }) {
  if (lifecycle === "deprecated") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[10px] font-medium text-rose-300">
        ⚠ 已证伪废弃（反面警示）
      </span>
    );
  }
  if (lifecycle === "iterated") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-[var(--cyan)]/40 bg-[var(--cyan-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--cyan)]">
        <GitBranch className="h-2.5 w-2.5" />
        认知迭代升级
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--emerald)]/35 bg-[var(--emerald-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--emerald)]">
      ✓ 持续验证有效
    </span>
  );
}

export default function ReportView({ report }: { report: SynthesisReport }) {
  const [copied, setCopied] = useState(false);
  const auditList = report.discipline_audit ?? [];

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

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] p-3">
            <div className="text-[11px] text-[var(--ink-dim)]">纳入研究材料</div>
            <div className="mt-1 text-lg font-bold text-[#f3f4f6]">{report.statistics.docs_count} 份</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] p-3">
            <div className="text-[11px] text-[var(--ink-dim)]">方法演变节点</div>
            <div className="mt-1 text-lg font-bold text-[var(--accent)]">{report.statistics.timeline_count} 个</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] p-3">
            <div className="text-[11px] text-[var(--ink-dim)]">交易规则卡</div>
            <div className="mt-1 text-lg font-bold text-[var(--emerald)]">{report.statistics.rules_count} 条</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] p-3">
            <div className="text-[11px] text-[var(--ink-dim)]">知行偏离病灶</div>
            <div className="mt-1 text-lg font-bold text-[var(--amber)]">{auditList.length} 项</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] p-3">
            <div className="text-[11px] text-[var(--ink-dim)]">逐字核验证据</div>
            <div className="mt-1 text-lg font-bold text-[#f3f4f6]">{report.statistics.evidence_used} 段</div>
          </div>
        </div>

        {report.quant_anchor && (
          <div className="mt-4 rounded-xl border border-[var(--cyan)]/35 bg-[#080e1a] p-3.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-semibold text-[var(--cyan)]">
                <CandlestickChart className="h-4 w-4" />
                阶段客观实盘绩效锚定（{report.quant_anchor.fromDate} ~ {report.quant_anchor.toDate} · 对比 {report.quant_anchor.benchmarkName}）
              </div>
              <Link href="/ledger" className="text-[11px] text-[var(--cyan)] hover:underline">
                在实盘账本查看净值与 K 线 →
              </Link>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-[var(--ink)]">
              <span>
                区间收益{" "}
                <strong className={report.quant_anchor.periodReturnPct >= 0 ? "text-red-400" : "text-emerald-400"}>
                  {report.quant_anchor.periodReturnPct > 0 ? "+" : ""}
                  {report.quant_anchor.periodReturnPct.toFixed(2)}%
                </strong>
              </span>
              {report.quant_anchor.excessAlphaPct !== null && (
                <span>
                  超额 Alpha{" "}
                  <strong className={report.quant_anchor.excessAlphaPct >= 0 ? "text-[var(--cyan)]" : "text-amber-400"}>
                    {report.quant_anchor.excessAlphaPct > 0 ? "+" : ""}
                    {report.quant_anchor.excessAlphaPct.toFixed(2)}%
                  </strong>
                </span>
              )}
              <span className="text-red-300">最大回撤 {report.quant_anchor.mddPct.toFixed(2)}%</span>
              <span className="text-[var(--ink-muted)]">日胜率 {report.quant_anchor.dailyWinRatePct.toFixed(1)}%</span>
              {report.quant_anchor.profitFactor !== null && (
                <span className="text-[var(--accent)]">盈亏比 PF {report.quant_anchor.profitFactor.toFixed(2)}</span>
              )}
              {report.quant_anchor.peakPositionPct !== null && (
                <span className={report.quant_anchor.peakPositionPct > 100 ? "text-amber-300" : "text-[var(--ink-muted)]"}>
                  峰值仓位 {report.quant_anchor.peakPositionPct.toFixed(0)}%（融资 {report.quant_anchor.marginDays} 天）
                </span>
              )}
            </div>
          </div>
        )}

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
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[var(--emerald)]" />
            <h3 className="text-base font-semibold text-[#f1f2f5]">个人交易手册（含规则演进与证伪状态）</h3>
          </div>
          <span className="text-[11px] text-[var(--ink-dim)]">
            自动识别跨阶段持续有效、认知迭代升级与已证伪废弃规则
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {report.manual.map((rule) => {
            const isDeprecated = rule.lifecycle === "deprecated";
            return (
              <div
                key={rule.id}
                className={`flex flex-col justify-between rounded-xl border p-4 ${
                  isDeprecated
                    ? "border-rose-500/35 bg-rose-950/10"
                    : "border-[var(--border)] bg-[var(--bg-deep)]"
                }`}
              >
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-[var(--emerald-soft)] px-2 py-0.5 font-mono text-xs font-semibold text-[var(--emerald)]">
                        {rule.id}
                      </span>
                      <LifecycleBadge lifecycle={rule.lifecycle} />
                    </div>
                    <span className="text-[11px] text-[var(--ink-dim)]">
                      {rule.known_dates.length >= 2
                        ? `跨 ${rule.known_dates.length} 个时点印证`
                        : rule.known_dates[0] || "单次观察"}
                    </span>
                  </div>
                  <h4
                    className={`mt-2 text-sm font-semibold ${
                      isDeprecated ? "text-rose-200 line-through decoration-rose-400/60" : "text-[#f1f2f5]"
                    }`}
                  >
                    {rule.title}
                  </h4>

                  {rule.conflict_note && (
                    <div className="mt-2 rounded-lg border border-[var(--cyan)]/30 bg-[var(--cyan-soft)]/45 px-3 py-2 text-xs leading-5 text-[var(--ink)]">
                      <strong className="text-[var(--cyan)]">认知演进 / 冲突说明：</strong>
                      {rule.conflict_note}
                    </div>
                  )}

                  {rule.quant_warning && (
                    <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-200">
                      <strong className="text-amber-300">⚠ 实盘绩效核验预警：</strong>
                      {rule.quant_warning}
                    </div>
                  )}

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
            );
          })}
        </div>
      </section>

      {/* Anti-Mouth-Trading Discipline Audit */}
      {auditList.length > 0 && (
        <section className="rounded-xl border border-amber-500/35 bg-[var(--surface)] p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-[var(--amber)]" />
              <h3 className="text-base font-semibold text-[#f1f2f5]">
                知行偏离与重复违纪病灶榜（防“嘴盘”照妖镜）
              </h3>
            </div>
            <span className="text-[11px] text-amber-300/90">
              对照「口头立下的纪律」与「实盘真实违纪证据」
            </span>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {auditList.map((item) => (
              <div
                key={item.id}
                className="flex flex-col justify-between rounded-xl border border-amber-500/25 bg-[var(--bg-deep)] p-4"
              >
                <div className="space-y-2.5 text-xs leading-5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded bg-amber-500/15 px-2 py-0.5 font-mono font-semibold text-amber-300">
                      {item.id}
                    </span>
                    <span className="font-mono text-[11px] text-[var(--ink-dim)]">
                      {item.known_dates.join(" · ")}
                    </span>
                  </div>

                  <div>
                    <div className="text-[11px] text-[var(--ink-dim)]">口头声明纪律（Stated Rule）</div>
                    <div className="mt-0.5 font-medium text-[#f1f2f5]">{item.stated_rule}</div>
                  </div>

                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5">
                    <div className="font-medium text-rose-300">实盘违纪真相（Actual Deviation）</div>
                    <div className="mt-0.5 text-[var(--ink)]">{item.actual_deviation || "—"}</div>
                  </div>

                  <div>
                    <div className="text-[11px] text-[var(--amber)]">心理与盘面诱因（Trigger Psychology）</div>
                    <div className="mt-0.5 text-[var(--ink)]">{item.trigger_psychology || "—"}</div>
                  </div>

                  <div>
                    <div className="text-[11px] text-[var(--emerald)]">硬性物理阻断栏（Fix Guardrail）</div>
                    <div className="mt-0.5 text-[var(--ink)]">{item.fix_guardrail || "—"}</div>
                  </div>
                </div>

                <div className="mt-3 border-t border-[var(--border)] pt-2.5">
                  <div className="mb-1.5 text-[11px] text-amber-300">违纪现场原文溯源（{item.evidence.length}）</div>
                  <div className="space-y-1">
                    {item.evidence.map((ev) => (
                      <Link
                        key={ev.evidence_id}
                        href={`/vault?card=${encodeURIComponent(ev.card)}`}
                        className="block rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] hover:border-amber-400/50"
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
      )}
    </div>
  );
}
