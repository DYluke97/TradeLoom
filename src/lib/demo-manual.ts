import { createHash } from "node:crypto";
import type { PeriodQuantBrief } from "./ledger-analytics";
import type { EvidenceSlice, SynthesisReport } from "./synthesis";
import type { VaultDoc, VaultIndex } from "./vault-builder";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

function findSampleDoc(index: VaultIndex, keyword: string, fallbackIdx: number): VaultDoc | undefined {
  return (
    index.documents.find((d) => d.source_rel.includes(keyword) || d.title.includes(keyword)) ??
    index.documents[fallbackIdx]
  );
}

function makeEvidence(id: string, doc: VaultDoc | undefined, quote: string): EvidenceSlice {
  return {
    evidence_id: id,
    doc_id: doc?.doc_id ?? id,
    title: doc?.title ?? "示范复盘笔记",
    card: doc?.card ?? "notes/demo.md",
    event_date: doc?.event_date ?? null,
    page: null,
    quote,
    quote_sha256: sha(quote),
  };
}

/**
 * Generates a realistic, schema-valid `tradeloom-playbook@v1` demonstration manual
 * anchored to the 6 built-in sample reviews and demo ledger so first-time users can
 * experience the full end-to-end TradeLoom output BEFORE configuring an LLM API key.
 */
export function buildStaticDemoManual(
  index: VaultIndex,
  quantAnchor: PeriodQuantBrief | null,
): SynthesisReport {
  const d0218 = findSampleDoc(index, "2025-02-18", 0);
  const d0306 = findSampleDoc(index, "2025-03-06", 1);
  const d0415 = findSampleDoc(index, "2025-04-15", 2);
  const d0522 = findSampleDoc(index, "2025-05-22", 3);
  const d0728 = findSampleDoc(index, "2025-07-28", 4);
  const d1020 = findSampleDoc(index, "2025-10-20", 5);

  const ev1 = makeEvidence(
    "EV-01",
    d0218,
    "10:15 看到前排封板后，直接半路追高买了板块第三只跟风票，仓位打了 4 成。冰点期没有形成主线梯队前，买跟风票没有任何盈亏比优势；总仓位上限应压在 2 成以内，且绝不半路追跟风。",
  );
  const ev2 = makeEvidence(
    "EV-02",
    d0306,
    "放弃跟风，专门等核心换手票在早盘分歧回踩均价线不破、再度放量时介入。触发条件：竞价高开 2%–4% 且量比放大，开盘 10 分钟承接强不破分时均线。",
  );
  const ev3 = makeEvidence(
    "EV-03",
    d0415,
    "高标断板负反馈 + 炸板率 > 40% 时，总仓位强制降到 1 成以下或空仓，禁止接力缩量加速板。连续 2 笔止损立即停手复盘，次日仓位减半。",
  );
  const ev4 = makeEvidence(
    "EV-04",
    d0522,
    "经营活动现金流净额 / 净利润 = 0.96，应收账款增速低于营收增速，存货增长主要来自在手订单备料而非滞销积压。建仓前提：动态 PE 回到近三年 55% 分位以下。",
  );
  const ev5 = makeEvidence(
    "EV-05",
    d0728,
    "中报与业绩预告窗口必须先过「现金流 + 应收增速 + 商誉/质押」三道排雷闸门，再看估值便宜与否；账面利润好看但现金流恶化的标的，一律视为高风险反例。",
  );
  const ev6 = makeEvidence(
    "EV-06",
    d1020,
    "形成双轨分工——短线仓只做发酵期主线龙头分歧转一致（单笔风险严格控制在总资金 1%）；中线仓只做景气向上、现金流真实且 PE 低于 60% 分位的标的。",
  );

  const sourceDocs = index.documents.map((d) => ({
    doc_id: d.doc_id,
    title: d.title,
    event_date: d.event_date,
    card: d.card,
  }));

  const dates = sourceDocs.map((d) => d.event_date).filter((d): d is string => Boolean(d)).sort();

  return {
    id: "demo-manual-v1",
    schema: "tradeloom-playbook@v1",
    created_at: new Date().toISOString(),
    title: "【示范成品】A 股双轨实盘交易手册 v1.0（免配模型预览）",
    skill_id: "short-term",
    skill_name: "短线博弈与双轨风控（体验示范样本）",
    model: "TradeLoom 静态示范样本（配置大模型后可基于你自己的复盘实时生成）",
    source_mode: "docs",
    fingerprint: sha("demo-manual-v1:" + sourceDocs.map((d) => d.doc_id).join(",")),
    date_range: {
      from: dates[0] ?? "2025-02-18",
      to: dates[dates.length - 1] ?? "2025-10-20",
    },
    source_docs: sourceDocs,
    overview: {
      summary:
        "这份示范手册完整展示了 TradeLoom 如何将 6 篇跨度 8 个月的零散复盘，结合实盘交割账本，提炼为「可回溯、可证伪、带违纪审计」的个人交易系统：从 Q1 冰点盲目追跟风踩坑，到 Q2 遭遇退潮核按钮固化仓位红线，最终在 Q3 进化为「短线主线分歧买点 + 中线景气现金流排雷」的双轨作战手册。",
      conditions: [
        "情绪周期先于个股选型：冰点期总仓位 <= 2 成，仅在发酵期主线梯队完整后放开核心仓位。",
        "中线打底仓必须先过三道财务排雷闸门（现金流、应收增速、商誉/质押），再评估 PE 历史分位。",
        "所有买点必须提前写清 T+1 证伪止损位与单笔最大风险（<= 总资金 1%）。",
      ],
      counterexamples: [
        "冰点期无主线梯队时重仓半路追板块第三只跟风票，当日炸板浮亏 > 6%。",
        "高标断板跌停 + 炸板率 > 40% 退潮日，误把补涨缩量一字加速当切换新龙头打板被核。",
        "只看账面净利润预增 40%，忽略经营现金流连续 4 季为负与 48% 高质押而踩雷。",
      ],
    },
    quant_anchor: quantAnchor,
    timeline: [
      {
        period: "2025 Q1（2–3 月）",
        label: "冰点追高踩坑 → 聚焦主线核心分歧买点",
        change:
          "2 月中旬在情绪冰点盲目重仓追板块跟风股遭遇炸板亏损；3 月初修正为「先确认完整梯队，再等换手核心早盘分歧回踩均价线承接」的结构买点。",
        evidence: [ev1, ev2],
        known_dates: ["2025-02-18", "2025-03-06"],
      },
      {
        period: "2025 Q2（4–5 月）",
        label: "退潮核按钮教训 → 固化降档红线并引入基本面锚",
        change:
          "4 月退潮期打板缩量加速补涨龙次日被核按钮，直接催生「炸板率 > 40% 空仓/一成、连亏两笔强制降档」硬纪律；5 月起引入行业景气度与现金流三表勾稽，降低纯情绪博弈波动。",
        evidence: [ev3, ev4],
        known_dates: ["2025-04-15", "2025-05-22"],
      },
      {
        period: "2025 Q3（7–10 月）",
        label: "双轨体系成型：短线分歧龙头 + 中线排雷估值锚",
        change:
          "在中报窗口验证三道财务排雷清单有效规避问题票后，正式形成短线情绪仓与中线基本面仓的双轨分工，并为下一阶段保留资金切换阈值待验证项。",
        evidence: [ev5, ev6],
        known_dates: ["2025-07-28", "2025-10-20"],
      },
    ],
    manual: [
      {
        id: "R-01",
        title: "情绪发酵期主线核心分歧转一致买点",
        lifecycle: "iterated",
        conflict_note: "由 2 月早盘追高跟风的失败模式迭代升级为仅做换手核心分歧承接。",
        context: "全市场涨停家数回升至 60+、昨日涨停溢价转正，且主线板块出现完整梯队（领涨核心 + 换手中军 + 助攻首板）。",
        condition: "核心换手票竞价高开 2%–4% 且量比放大，开盘 10 分钟回踩分时均价线不破、再度放量承接。",
        action: "放弃后排跟风票，仅在核心换手标的介入，单笔最大风险严格控制在总资金 1% 以内。",
        exit: "次日若低开破前日收盘价 3% 且半小时内不能翻红，直接执行 T+1 止损，不幻想反包。",
        counterexample: "2025-02-18 冰点期无完整梯队时 4 成仓半路追买板块第三只跟风票，尾盘炸板浮亏超 6%。",
        evidence: [ev1, ev2, ev6],
        known_dates: ["2025-02-18", "2025-03-06", "2025-10-20"],
      },
      {
        id: "R-02",
        title: "退潮期否决红线与连亏降档机制",
        lifecycle: "validated",
        quant_warning: "示范实盘账本显示：中期满融逆势加仓阶段仓位一度超 125%，贡献了区间最大回撤；降至 65% 左右右侧半仓后曲线显著企稳。",
        context: "主线最高标断板跌停释放强负反馈，且全市场炸板率突破 40%、跌停家数明显扩张。",
        condition: "高标断板核按钮叠加炸板率 > 40%，或个人实盘连续出现 2 笔止损。",
        action: "总仓位强制降至 1 成以下或空仓观望；连亏 2 笔后立即停手复盘，次日开仓上限减半，严禁动用融资杠杆抄底。",
        exit: "直至市场重新出现高溢价赚钱效应与正反馈样本后，再从 2 成试错仓逐步恢复。",
        counterexample: "2025-04-15 高标断板当天打板缩量一字加速补涨龙，次日直接跌停核按钮，吞噬前半月利润。",
        evidence: [ev3],
        known_dates: ["2025-04-15"],
      },
      {
        id: "R-03",
        title: "中线基本面三道排雷闸门与估值分位锚",
        lifecycle: "validated",
        context: "财报季、业绩预告窗口及中线底仓选股阶段（如光通信、消费电子等高景气赛道）。",
        condition: "行业 CR3 竞争格局稳定、需求/资本开支上修；同时通过三道财务核验（经营现金流/净利 ≈ 1、应收增速 < 营收增速、无高商誉与高股权质押），且动态 PE 处于近三年 55%–60% 分位以下。",
        action: "纳入中线底仓分批配置，与短线情绪仓资金物理隔离，不因短线情绪波动随意洗出。",
        exit: "以行业景气度拐点或财务三表证伪作为唯一清仓标准，不预设情绪止盈上限。",
        counterexample: "2025-07-28 某零部件公司利润预增 40% 但扣非仅 8%、经营现金流连续 4 季为负且大股东质押 48%，直接一票否决。",
        evidence: [ev4, ev5, ev6],
        known_dates: ["2025-05-22", "2025-07-28", "2025-10-20"],
      },
      {
        id: "R-04",
        title: "【已废弃旧习】冰点脉冲半路追高后排跟风股",
        lifecycle: "deprecated",
        conflict_note: "早期高频亏损源头，已在 3 月和 10 月复盘中正式列为禁止动作。",
        context: "情绪冰点末期早盘题材脉冲，但前排之外缺乏中军与完整首板梯队。",
        condition: "仅因看到前排涨停怕踏空，便在 10:00 后半路重仓追高板块第三、第四跟风标的。",
        action: "永久禁止该模式；若踏空前排，宁可空仓等待次日分歧或切换下一个发酵周期。",
        exit: "一旦冲动违规买入，次日开盘不计成本优先清理，记录违纪审计。",
        counterexample: "2025-02-18 4 成仓追买算力应用第三只跟风票，尾盘炸板次日被动割肉。",
        evidence: [ev1],
        known_dates: ["2025-02-18"],
      },
    ],
    discipline_audit: [
      {
        id: "DA-01",
        stated_rule: "冰点期总仓位压在 2 成以内，绝不半路追后排跟风",
        actual_deviation: "早盘见前排封板情绪上头，直接 4 成重仓追入板块第三只跟风票，尾盘炸板深套。",
        trigger_psychology: "踏空焦虑（FOMO）叠加「前排买不到买后排补涨」的侥幸心理。",
        fix_guardrail: "盘前写死当日备选核心标的清单（最多 3 只），清单外标的盘中一律禁止新开仓。",
        evidence: [ev1],
        known_dates: ["2025-02-18"],
      },
      {
        id: "DA-02",
        stated_rule: "退潮期强制降档空仓，连亏停手且严禁逆势加杠杆",
        actual_deviation: "高标断板日仍打板缩量加速补涨龙；示范账本同期更出现仓位拉升至 125%+ 的满融抄底动作，放大阶段最大回撤。",
        trigger_psychology: "急于一把回本的赌徒心态，把退潮期缩量加速误判为「新主线切换」。",
        fix_guardrail: "在实盘账本设置硬告警：近 5 日出现 2 笔止损或大盘炸板率 > 40% 时，自动锁定当日最大仓位 <= 20% 且关闭融资通道。",
        evidence: [ev3],
        known_dates: ["2025-04-15"],
      },
    ],
    statistics: {
      docs_count: sourceDocs.length,
      timeline_count: 3,
      rules_count: 4,
      evidence_used: 6,
      multi_date_rules: 2,
    },
    warnings: [
      "当前为免配置大模型即可预览的「体验示范手册」；配置你自己的 AI 大模型后，点击「提炼方法论」即可基于你的真实复盘一键生成专属版本。",
    ],
    usage: { promptTokens: null, completionTokens: null },
  };
}