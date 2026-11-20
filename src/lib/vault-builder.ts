import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { carrierOf, decodeText, guessTitle, type CarrierKind } from "./convert";
import { extractTags, extractWikiLinks } from "./markdown";
import { writeAtomic } from "./workspace";

export type VaultNodeType = "overview" | "timeline" | "card" | "topic" | "manual";

export type VaultDoc = {
  doc_id: string;
  title: string;
  kind: string;
  carrier: CarrierKind;
  event_date: string | null;
  tags: string[];
  auto_concepts: string[];
  wikilinks: string[];
  card: string;
  source_rel: string;
  bytes: number;
  sha256: string;
};

export type VaultLinkGraph = Record<string, { out: string[]; in: string[] }>;

export type TimelineYearNode = {
  year: string;
  count: number;
  months: Array<{
    month: string;
    count: number;
    days: Array<{ day: string; count: number }>;
  }>;
};

export type VaultFileItem = {
  rel: string;
  group: string;
  title: string;
  nodeType: VaultNodeType;
  eventDate?: string | null;
};

export type VaultIndex = {
  schema: "tradeloom-vault@v2";
  built_at: string;
  counts: {
    total: number;
    dated: number;
    undated: number;
    years: number;
    days: number;
    topics: number;
    manuals: number;
    links: number;
  };
  documents: VaultDoc[];
  days: string[];
  years: string[];
  kinds: string[];
  topics: string[];
  heatmap: Record<string, number>;
  timelineTree: TimelineYearNode[];
  files: VaultFileItem[];
  links: VaultLinkGraph;
};

const MAX_SCAN_FILES = 3000;
const SKIP_DIRS = new Set([".git", ".obsidian", ".vault-history", "_inbox", "node_modules"]);

/**
 * Curated trading concept dictionary for untagged legacy reviews (.txt / .docx / old .md).
 * Even if multi-year legacy notes contain zero #tags or [[wikilinks]], matching concepts
 * automatically weave them into Obsidian 30-主题/ hubs.
 */
const AUTO_CONCEPT_RULES: Array<{ concept: string; patterns: RegExp[] }> = [
  { concept: "情绪周期", patterns: [/情绪周期/, /冰点/, /高潮/, /情绪修复/, /发酵期/] },
  { concept: "退潮风控", patterns: [/退潮/, /核按钮/, /炸板率/, /连亏降档/, /负反馈/] },
  { concept: "龙头与梯队", patterns: [/龙头/, /梯队/, /中军/, /跟风/, /补涨/, /连板/] },
  { concept: "买点结构", patterns: [/弱转强/, /分歧转一致/, /首板/, /回踩/, /放量突破/, /竞价/] },
  { concept: "仓位与止损", patterns: [/止损/, /仓位/, /单笔风险/, /回撤/, /空仓/, /T\+1/] },
  { concept: "追高反例", patterns: [/追高/, /追涨/, /半路/, /接盘/, /反例/] },
  { concept: "行业景气", patterns: [/景气/, /渗透率/, /产能/, /订单/, /资本开支/, /竞争格局/] },
  { concept: "财务质量", patterns: [/现金流/, /应收账款/, /存货/, /毛利率/, /扣非/, /三表/, /ROE/] },
  { concept: "估值锚", patterns: [/估值/, /PE/, /PB/, /分位/, /DCF/, /赔率/, /安全边际/] },
  { concept: "基本面排雷", patterns: [/商誉/, /质押/, /减持/, /排雷/, /证伪/, /财务洗澡/] },
];

export function extractAutoConcepts(text: string): string[] {
  if (!text) return [];
  const hits: string[] = [];
  for (const rule of AUTO_CONCEPT_RULES) {
    if (rule.patterns.some((re) => re.test(text))) {
      hits.push(rule.concept);
    }
  }
  return hits;
}

const sha = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");

function safeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "untitled";
}

function isValidYmd(ymd: string): boolean {
  const [y, m, d] = ymd.split("-").map(Number);
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function detectEventDate(fileName: string, text: string): string | null {
  const fromName = /(\d{4})[-._](\d{2})[-._](\d{2})/.exec(fileName);
  if (fromName) {
    const candidate = `${fromName[1]}-${fromName[2]}-${fromName[3]}`;
    if (isValidYmd(candidate)) return candidate;
  }
  const fromFm = /^(?:date|event_date|published_at)\s*:\s*["']?(\d{4}-\d{2}-\d{2})/m.exec(text.slice(0, 800));
  if (fromFm && isValidYmd(fromFm[1])) return fromFm[1];
  const fromHeading = /^#\s+.*?(\d{4}-\d{2}-\d{2})/m.exec(text.slice(0, 400));
  if (fromHeading && isValidYmd(fromHeading[1])) return fromHeading[1];
  return null;
}

export function detectKind(sourceRel: string): string {
  const parts = sourceRel.split("/");
  const base = parts[parts.length - 1].replace(/\.[^.]+$/, "");
  const m = /^\d{4}[-._]\d{2}[-._]\d{2}[_\-\s]+([^_\-\s]+)/.exec(base);
  if (m && m[1] && m[1].length <= 16) return m[1];
  if (parts.length > 1 && parts[0] !== "_导入") return parts[0];
  return "复盘笔记";
}

async function scanSources(sourceRoot: string): Promise<{ rel: string; full: string; carrier: CarrierKind }[]> {
  const out: { rel: string; full: string; carrier: CarrierKind }[] = [];
  const visit = async (dir: string, relPrefix: string) => {
    if (out.length >= MAX_SCAN_FILES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= MAX_SCAN_FILES) return;
      if (entry.name.startsWith(".") || (entry.isDirectory() && SKIP_DIRS.has(entry.name))) continue;
      const full = path.join(dir, entry.name);
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await visit(full, rel);
      } else if (entry.isFile()) {
        const carrier = carrierOf(entry.name);
        if (carrier) out.push({ rel, full, carrier });
      }
    }
  };
  await visit(sourceRoot, "");
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/**
 * Built-in Obsidian Bi-directional Vault Builder (v2).
 * - Multi-year timeline hierarchy: 10-时间轴/YYYY年.md -> YYYY-MM.md -> 10-每日/YYYY-MM-DD.md
 * - Auto-concept linking for untagged multi-year legacy notes
 * - Playbook back-sync: mirrors workspace/manuals/*.md into 40-交易手册/ so rules link back to source cards
 */
export async function buildVault(
  sourceRoot: string,
  vaultRoot: string,
  manualsRoot?: string,
): Promise<VaultIndex> {
  await mkdir(sourceRoot, { recursive: true });
  await mkdir(vaultRoot, { recursive: true });

  // Clean generated vault directories (preserving _inbox & .obsidian user settings)
  for (const dir of ["10-时间轴", "10-每日", "20-卡片", "30-主题", "40-交易手册"]) {
    await rm(path.join(vaultRoot, dir), { recursive: true, force: true });
  }

  const found = await scanSources(sourceRoot);
  const documents: VaultDoc[] = [];
  const cardContents = new Map<string, string>();
  const fileMeta = new Map<string, { title: string; nodeType: VaultNodeType; eventDate?: string | null }>();

  for (const item of found) {
    let info;
    try {
      info = await stat(item.full);
      if (!info.isFile()) continue;
    } catch {
      continue;
    }
    const buf = await readFile(item.full);
    const digest = sha(buf);
    const docId = sha(item.rel).slice(0, 12);
    const baseName = path.basename(item.rel, path.extname(item.rel));

    let text = "";
    if (item.carrier === "md" || item.carrier === "txt" || item.carrier === "html") {
      text = decodeText(buf).text;
    }

    const title = text ? guessTitle(text, baseName) : baseName;
    const eventDate = detectEventDate(baseName, text);
    const kind = detectKind(item.rel);
    const tags = text ? extractTags(text) : [];
    const wikilinks = text ? extractWikiLinks(text) : [];
    const autoConcepts = text ? extractAutoConcepts(text) : [];
    const cardFile = `20-卡片/${safeFileName(baseName)}.md`;

    documents.push({
      doc_id: docId,
      title,
      kind,
      carrier: item.carrier,
      event_date: eventDate,
      tags,
      auto_concepts: autoConcepts,
      wikilinks,
      card: cardFile,
      source_rel: item.rel,
      bytes: info.size,
      sha256: digest,
    });
  }

  documents.sort((a, b) => {
    const da = a.event_date ?? "0000-00-00";
    const db = b.event_date ?? "0000-00-00";
    if (da !== db) return db.localeCompare(da);
    return a.title.localeCompare(b.title);
  });

  const byDay = new Map<string, VaultDoc[]>();
  const byMonth = new Map<string, VaultDoc[]>();
  const byYear = new Map<string, VaultDoc[]>();
  const byTopic = new Map<string, VaultDoc[]>();
  const kindSet = new Set<string>();
  const docByBase = new Map<string, VaultDoc>();

  for (const doc of documents) {
    kindSet.add(doc.kind);
    docByBase.set(path.basename(doc.card, ".md"), doc);
    if (doc.event_date) {
      const y = doc.event_date.slice(0, 4);
      const ym = doc.event_date.slice(0, 7);
      const dList = byDay.get(doc.event_date) ?? [];
      dList.push(doc);
      byDay.set(doc.event_date, dList);

      const mList = byMonth.get(ym) ?? [];
      mList.push(doc);
      byMonth.set(ym, mList);

      const yList = byYear.get(y) ?? [];
      yList.push(doc);
      byYear.set(y, yList);
    }

    const topicNames = new Set<string>([...doc.tags, ...doc.auto_concepts]);
    for (const wl of doc.wikilinks) {
      const clean = wl.replace(/\.md$/, "").split("/").pop() ?? wl;
      if (!docByBase.has(clean) && !/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
        topicNames.add(clean);
      }
    }
    for (const topic of topicNames) {
      const safeTopic = safeFileName(topic);
      if (!safeTopic) continue;
      const list = byTopic.get(safeTopic) ?? [];
      if (!list.some((d) => d.doc_id === doc.doc_id)) list.push(doc);
      byTopic.set(safeTopic, list);
    }
  }

  for (const base of docByBase.keys()) {
    byTopic.delete(base);
  }

  // 1) Write 20-卡片/*.md
  for (const doc of documents) {
    const srcFull = path.join(sourceRoot, doc.source_rel);
    let excerpt = "";
    if (doc.carrier === "md" || doc.carrier === "txt") {
      try {
        excerpt = decodeText(await readFile(srcFull))
          .text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
          .trim()
          .slice(0, 1600);
      } catch {
        excerpt = "";
      }
    }

    const allConceptNames = [...new Set([...doc.tags, ...doc.auto_concepts, ...doc.wikilinks])]
      .map((t) => safeFileName(t.replace(/\.md$/, "").split("/").pop() ?? t))
      .filter((t) => byTopic.has(t) || docByBase.has(t));

    const topicLinks = allConceptNames.map((t) =>
      byTopic.has(t) ? `[[30-主题/${t}|#${t}]]` : `[[20-卡片/${t}|${t}]]`,
    );

    const monthLink = doc.event_date ? `[[10-时间轴/${doc.event_date.slice(0, 7)}|${doc.event_date.slice(0, 7)}]]` : null;
    const dayLink = doc.event_date ? `[[10-每日/${doc.event_date}|${doc.event_date}]]` : null;

    const lines: string[] = [
      "---",
      `doc_id: "${doc.doc_id}"`,
      `title: "${doc.title.replace(/"/g, '\\"')}"`,
      `kind: "${doc.kind}"`,
      `carrier: "${doc.carrier}"`,
      `event_date: "${doc.event_date ?? ""}"`,
      `source_rel: "${doc.source_rel.replace(/"/g, '\\"')}"`,
      `tags: [${[...new Set([...doc.tags, ...doc.auto_concepts])].map((t) => `"${t.replace(/"/g, '\\"')}"`).join(", ")}]`,
      "---",
      "",
      `# ${doc.title}`,
      "",
      `- **时间坐标**：${dayLink ? `${dayLink} · ${monthLink}` : "未标日期"}`,
      `- **分类与格式**：${doc.kind} · \`${doc.carrier.toUpperCase()}\``,
      `- **源文件**：\`${doc.source_rel}\``,
    ];
    if (topicLinks.length > 0) {
      lines.push(`- **双向关联**：${topicLinks.join(" · ")}`);
    }
    if (doc.auto_concepts.length > 0) {
      lines.push(`- **自动识别交易主题**：${doc.auto_concepts.map((c) => `\`${c}\``).join(" ")}`);
    }
    lines.push("", "---", "");
    if (doc.carrier === "pdf") {
      lines.push("> 本条目为 PDF 原件，可在上方切换「查看 PDF 原件」直接内嵌阅读，并在「阶段提炼」中逐页提取正文供大模型归纳。");
    } else if (excerpt) {
      lines.push(excerpt);
    } else {
      lines.push("> 点击上方「查看原文」查看完整内容。");
    }

    const md = lines.join("\n") + "\n";
    await writeAtomic(path.join(vaultRoot, doc.card), md);
    cardContents.set(doc.card, md);
    fileMeta.set(doc.card, { title: doc.title, nodeType: "card", eventDate: doc.event_date });
  }

  // 2) Write 10-每日/YYYY-MM-DD.md
  const days = [...byDay.keys()].sort();
  const heatmap: Record<string, number> = {};
  for (const day of days) {
    const dayDocs = byDay.get(day)!;
    heatmap[day] = dayDocs.length;
    const ym = day.slice(0, 7);
    const rel = `10-每日/${day}.md`;
    const md = [
      "---",
      `date: "${day}"`,
      `count: ${dayDocs.length}`,
      "---",
      "",
      `# ${day} 复盘日志`,
      "",
      `所属月份：[[10-时间轴/${ym}|${ym}]] · 返回 [[00-总览]]`,
      "",
      `当日共收录 **${dayDocs.length}** 篇复盘资料：`,
      "",
      ...dayDocs.map(
        (d) => `- [[${d.card.replace(/\.md$/, "")}|${d.title}]]（${d.kind} · \`${d.carrier}\`）`,
      ),
      "",
    ].join("\n");
    await writeAtomic(path.join(vaultRoot, rel), md);
    cardContents.set(rel, md);
    fileMeta.set(rel, { title: `${day}`, nodeType: "timeline", eventDate: day });
  }

  // 3) Write 10-时间轴/YYYY年.md & YYYY-MM.md (Multi-Year Hierarchy!)
  const years = [...byYear.keys()].sort().reverse();
  const timelineTree: TimelineYearNode[] = [];

  for (const year of years) {
    const yearDocs = byYear.get(year)!;
    const yearMonths = [...byMonth.keys()]
      .filter((ym) => ym.startsWith(`${year}-`))
      .sort()
      .reverse();

    const monthNodes: TimelineYearNode["months"] = [];
    for (const ym of yearMonths) {
      const mDocs = byMonth.get(ym)!;
      const mDays = days.filter((d) => d.startsWith(`${ym}-`)).reverse();
      monthNodes.push({
        month: ym,
        count: mDocs.length,
        days: mDays.map((d) => ({ day: d, count: byDay.get(d)!.length })),
      });

      const mRel = `10-时间轴/${ym}.md`;
      const mMd = [
        "---",
        `month: "${ym}"`,
        `count: ${mDocs.length}`,
        "---",
        "",
        `# ${ym} 月度复盘索引`,
        "",
        `所属年份：[[10-时间轴/${year}年|${year} 年]] · 返回 [[00-总览]]`,
        "",
        `本月共收录 **${mDocs.length}** 篇复盘，覆盖 **${mDays.length}** 个交易日：`,
        "",
        ...mDays.flatMap((d) => [
          `## [[10-每日/${d}|${d}]]`,
          ...byDay.get(d)!.map((doc) => `- [[${doc.card.replace(/\.md$/, "")}|${doc.title}]]（${doc.kind}）`),
          "",
        ]),
      ].join("\n");
      await writeAtomic(path.join(vaultRoot, mRel), mMd);
      cardContents.set(mRel, mMd);
      fileMeta.set(mRel, { title: `${ym} 月度索引`, nodeType: "timeline", eventDate: `${ym}-01` });
    }

    timelineTree.push({ year, count: yearDocs.length, months: monthNodes });

    const yRel = `10-时间轴/${year}年.md`;
    const yMd = [
      "---",
      `year: "${year}"`,
      `count: ${yearDocs.length}`,
      "---",
      "",
      `# ${year} 年复盘档案`,
      "",
      `全年共收录 **${yearDocs.length}** 篇复盘笔记，横跨 **${yearMonths.length}** 个月份。返回 [[00-总览]]`,
      "",
      "## 月度导航",
      "",
      ...yearMonths.map((ym) => `- [[10-时间轴/${ym}|${ym}]]（${byMonth.get(ym)!.length} 篇）`),
      "",
    ].join("\n");
    await writeAtomic(path.join(vaultRoot, yRel), yMd);
    cardContents.set(yRel, yMd);
    fileMeta.set(yRel, { title: `${year} 年档案`, nodeType: "timeline", eventDate: `${year}-01-01` });
  }

  // 4) Write 30-主题/<topic>.md
  const topics = [...byTopic.keys()].sort(
    (a, b) => byTopic.get(b)!.length - byTopic.get(a)!.length || a.localeCompare(b),
  );
  for (const topic of topics) {
    const tDocs = byTopic.get(topic)!;
    const rel = `30-主题/${topic}.md`;
    const md = [
      "---",
      `topic: "${topic}"`,
      `count: ${tDocs.length}`,
      "---",
      "",
      `# 主题双链：${topic}`,
      "",
      `以下 **${tDocs.length}** 篇复盘（含跨年记录与自动主题识别）关联到 \`#${topic}\`：`,
      "",
      ...tDocs.map(
        (d) =>
          `- ${d.event_date ? `[[10-每日/${d.event_date}|${d.event_date}]] ` : ""}[[${d.card.replace(/\.md$/, "")}|${d.title}]]（${d.kind}）`,
      ),
      "",
      "返回 [[00-总览]]",
      "",
    ].join("\n");
    await writeAtomic(path.join(vaultRoot, rel), md);
    cardContents.set(rel, md);
    fileMeta.set(rel, { title: `#${topic}`, nodeType: "topic" });
  }

  // 5) Sync 40-交易手册/*.md from workspace/manuals/ so Playbooks link back into the Obsidian Graph!
  let manualsCount = 0;
  const manualRels: Array<{ rel: string; title: string }> = [];
  if (manualsRoot) {
    try {
      const mEntries = await readdir(manualsRoot, { withFileTypes: true });
      for (const entry of mEntries) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const raw = await readFile(path.join(manualsRoot, entry.name), "utf8");
        const rel = `40-交易手册/${entry.name}`;
        await writeAtomic(path.join(vaultRoot, rel), raw);
        const title = guessTitle(raw, path.basename(entry.name, ".md"));
        cardContents.set(rel, raw);
        fileMeta.set(rel, { title, nodeType: "manual" });
        manualRels.push({ rel, title });
        manualsCount++;
      }
    } catch {
      /* manuals dir optional */
    }
  }

  // 6) Write 00-总览.md (Obsidian Master MOC)
  const overviewRel = "00-总览.md";
  const overviewMd = [
    "# TradeLoom · Obsidian 复盘知识库总览",
    "",
    `> 共收录 **${documents.length}** 篇复盘笔记，横跨 **${years.length}** 个年份、**${days.length}** 个交易日，编织 **${topics.length}** 个主题节点与 **${manualsCount}** 份沉淀交易手册。本目录原生兼容 **Obsidian** 客户端。`,
    "",
    "## 一、按年份时间轴（多年度复盘导航）",
    "",
    ...(years.length > 0
      ? years.map((y) => `- [[10-时间轴/${y}年|${y} 年复盘档案]]（${byYear.get(y)!.length} 篇）`)
      : ["- 暂无带日期的复盘笔记，可点击左侧「导入笔记」或一键载入示例库。"]),
    "",
    "## 二、核心交易主题双链（自动聚合 + 手动标签）",
    "",
    ...(topics.length > 0
      ? topics.map((t) => `- [[30-主题/${t}|#${t}]]（${byTopic.get(t)!.length} 篇）`)
      : ["- 导入笔记后系统会自动提取交易主题（情绪周期/买点结构/财务质量/排雷等）并建立双向链接。"]),
    "",
    "## 三、已沉淀个人交易手册（反向回链历史案例）",
    "",
    ...(manualRels.length > 0
      ? manualRels.map((m) => `- [[${m.rel.replace(/\.md$/, "")}|${m.title}]]`)
      : ["- 前往「阶段提炼」生成你的第一份交易手册，手册将自动写回 `40-交易手册/` 并与历史复盘形成双向闭环。"]),
    "",
  ].join("\n");
  await writeAtomic(path.join(vaultRoot, overviewRel), overviewMd);
  cardContents.set(overviewRel, overviewMd);
  fileMeta.set(overviewRel, { title: "知识库总览 (MOC)", nodeType: "overview" });

  // 7) Build full bi-directional wikilink graph
  const allRels = [...cardContents.keys()].sort();
  const byCard = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const rel of allRels) {
    byCard.set(rel, rel);
    byCard.set(rel.replace(/\.md$/, ""), rel);
    const plain = rel.replace(/\.md$/, "").split("/").pop()!;
    if (!byName.has(plain)) byName.set(plain, rel);
  }

  const links: VaultLinkGraph = {};
  for (const rel of allRels) links[rel] = { out: [], in: [] };
  let totalLinks = 0;

  for (const rel of allRels) {
    const content = cardContents.get(rel) ?? "";
    const seen = new Set<string>();
    for (const rawTarget of extractWikiLinks(content)) {
      const clean = rawTarget.trim();
      const target =
        byCard.get(clean) ??
        byCard.get(`${clean}.md`) ??
        byName.get(clean.replace(/\.md$/, "").split("/").pop() ?? clean) ??
        null;
      if (!target || target === rel || seen.has(target)) continue;
      seen.add(target);
      links[rel].out.push(target);
      links[target].in.push(rel);
      totalLinks++;
    }
  }

  const files: VaultFileItem[] = allRels.map((rel) => {
    const meta = fileMeta.get(rel);
    return {
      rel,
      group: rel.includes("/") ? rel.split("/")[0] : "00-入口",
      title: meta?.title ?? path.basename(rel, ".md"),
      nodeType: meta?.nodeType ?? "card",
      eventDate: meta?.eventDate ?? null,
    };
  });

  const index: VaultIndex = {
    schema: "tradeloom-vault@v2",
    built_at: new Date().toISOString(),
    counts: {
      total: documents.length,
      dated: documents.filter((d) => Boolean(d.event_date)).length,
      undated: documents.filter((d) => !d.event_date).length,
      years: years.length,
      days: days.length,
      topics: topics.length,
      manuals: manualsCount,
      links: totalLinks,
    },
    documents,
    days,
    years,
    kinds: [...kindSet].sort(),
    topics,
    heatmap,
    timelineTree,
    files,
    links,
  };

  await writeAtomic(path.join(vaultRoot, "index.json"), JSON.stringify(index, null, 2));
  return index;
}
