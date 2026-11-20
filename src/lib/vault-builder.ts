import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { carrierOf, decodeText, guessTitle, type CarrierKind } from "./convert";
import { extractTags, extractWikiLinks } from "./markdown";
import { writeAtomic } from "./workspace";

export type VaultDoc = {
  doc_id: string;
  title: string;
  kind: string;
  carrier: CarrierKind;
  event_date: string | null;
  tags: string[];
  wikilinks: string[];
  card: string;
  source_rel: string;
  bytes: number;
  sha256: string;
};

export type VaultLinkGraph = Record<string, { out: string[]; in: string[] }>;

export type VaultIndex = {
  schema: "tradeloom-vault@v1";
  built_at: string;
  counts: {
    total: number;
    dated: number;
    undated: number;
    days: number;
    topics: number;
    links: number;
  };
  documents: VaultDoc[];
  days: string[];
  kinds: string[];
  topics: string[];
  files: { rel: string; group: string; title: string }[];
  links: VaultLinkGraph;
};

const MAX_SCAN_FILES = 3000;
const SKIP_DIRS = new Set([".git", ".obsidian", ".vault-history", "_inbox", "node_modules"]);

const sha = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");

function safeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "untitled";
}

/**
 * Extracts YYYY-MM-DD from filename prefix, frontmatter, or first heading.
 */
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

function isValidYmd(ymd: string): boolean {
  const [y, m, d] = ymd.split("-").map(Number);
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Detects note category from filename (`YYYY-MM-DD_<kind>_<title>`) or parent folder.
 */
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
 * Built-in Obsidian Bi-directional Vault Builder.
 * Scans `sourceRoot`, builds standard Obsidian Markdown cards + daily hubs + topic hubs + index.json in `vaultRoot`.
 */
export async function buildVault(sourceRoot: string, vaultRoot: string): Promise<VaultIndex> {
  await mkdir(sourceRoot, { recursive: true });
  await mkdir(vaultRoot, { recursive: true });

  // Clean previously generated Obsidian directories (preserving _inbox & .obsidian)
  for (const dir of ["10-每日", "20-卡片", "30-主题"]) {
    await rm(path.join(vaultRoot, dir), { recursive: true, force: true });
  }

  const found = await scanSources(sourceRoot);
  const documents: VaultDoc[] = [];
  const cardContents = new Map<string, string>();
  const fileTitles = new Map<string, string>();

  // First pass: extract metadata from each source file
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
    const cardFile = `20-卡片/${safeFileName(baseName)}.md`;

    documents.push({
      doc_id: docId,
      title,
      kind,
      carrier: item.carrier,
      event_date: eventDate,
      tags,
      wikilinks,
      card: cardFile,
      source_rel: item.rel,
      bytes: info.size,
      sha256: digest,
    });
  }

  // Sort chronologically (newest first for display, while days array is ascending)
  documents.sort((a, b) => {
    const da = a.event_date ?? "0000-00-00";
    const db = b.event_date ?? "0000-00-00";
    if (da !== db) return db.localeCompare(da);
    return a.title.localeCompare(b.title);
  });

  // Collect daily buckets and topic buckets
  const byDay = new Map<string, VaultDoc[]>();
  const byTopic = new Map<string, VaultDoc[]>();
  const kindSet = new Set<string>();
  const docByBase = new Map<string, VaultDoc>();

  for (const doc of documents) {
    kindSet.add(doc.kind);
    docByBase.set(path.basename(doc.card, ".md"), doc);
    if (doc.event_date) {
      const list = byDay.get(doc.event_date) ?? [];
      list.push(doc);
      byDay.set(doc.event_date, list);
    }
    const topicNames = new Set<string>([...doc.tags]);
    for (const wl of doc.wikilinks) {
      // Wiki-links that don't match an existing note filename become topic hub nodes
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

  // Re-filter topics that happen to match another note's exact basename
  for (const base of docByBase.keys()) {
    byTopic.delete(base);
  }

  // Write 20-卡片/*.md
  for (const doc of documents) {
    const srcFull = path.join(sourceRoot, doc.source_rel);
    let excerpt = "";
    if (doc.carrier === "md" || doc.carrier === "txt") {
      try {
        const raw = decodeText(await readFile(srcFull)).text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
        excerpt = raw.slice(0, 1200);
      } catch {
        excerpt = "";
      }
    }

    const topicLinks = [...new Set([...doc.tags, ...doc.wikilinks])]
      .map((t) => safeFileName(t.replace(/\.md$/, "").split("/").pop() ?? t))
      .filter((t) => byTopic.has(t) || docByBase.has(t))
      .map((t) => (byTopic.has(t) ? `[[30-主题/${t}|#${t}]]` : `[[20-卡片/${t}|${t}]]`));

    const lines: string[] = [
      "---",
      `doc_id: "${doc.doc_id}"`,
      `title: "${doc.title.replace(/"/g, '\\"')}"`,
      `kind: "${doc.kind}"`,
      `carrier: "${doc.carrier}"`,
      `event_date: "${doc.event_date ?? ""}"`,
      `source_rel: "${doc.source_rel.replace(/"/g, '\\"')}"`,
      `tags: [${doc.tags.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(", ")}]`,
      "---",
      "",
      `# ${doc.title}`,
      "",
      `- **日期**：${doc.event_date ? `[[10-每日/${doc.event_date}|${doc.event_date}]]` : "未标日期"}`,
      `- **类型**：${doc.kind} · **格式**：\`${doc.carrier.toUpperCase()}\``,
      `- **源文件**：\`${doc.source_rel}\``,
    ];
    if (topicLinks.length > 0) {
      lines.push(`- **双向关联**：${topicLinks.join(" · ")}`);
    }
    lines.push("", "---", "");
    if (doc.carrier === "pdf") {
      lines.push("> 本条目为 PDF 原件，可在上方切换「查看原件」直接内嵌阅读，并在「阶段提炼」中提取逐页文字供大模型归纳。");
    } else if (excerpt) {
      lines.push(excerpt);
    } else {
      lines.push("> 点击上方「查看/编辑原文」查看完整内容。");
    }

    const md = lines.join("\n") + "\n";
    await writeAtomic(path.join(vaultRoot, doc.card), md);
    cardContents.set(doc.card, md);
    fileTitles.set(doc.card, doc.title);
  }

  // Write 10-每日/YYYY-MM-DD.md
  const days = [...byDay.keys()].sort();
  for (const day of days) {
    const dayDocs = byDay.get(day)!;
    const rel = `10-每日/${day}.md`;
    const md = [
      "---",
      `date: "${day}"`,
      `count: ${dayDocs.length}`,
      "---",
      "",
      `# ${day} 复盘日志`,
      "",
      `当日共收录 **${dayDocs.length}** 篇复盘资料：`,
      "",
      ...dayDocs.map(
        (d) => `- [[${d.card.replace(/\.md$/, "")}|${d.title}]]（${d.kind} · \`${d.carrier}\`）`,
      ),
      "",
      "返回 [[00-总览]]",
      "",
    ].join("\n");
    await writeAtomic(path.join(vaultRoot, rel), md);
    cardContents.set(rel, md);
    fileTitles.set(rel, `${day} 复盘日志`);
  }

  // Write 30-主题/<topic>.md
  const topics = [...byTopic.keys()].sort((a, b) => (byTopic.get(b)!.length - byTopic.get(a)!.length) || a.localeCompare(b));
  for (const topic of topics) {
    const tDocs = byTopic.get(topic)!;
    const rel = `30-主题/${topic}.md`;
    const md = [
      "---",
      `topic: "${topic}"`,
      `count: ${tDocs.length}`,
      "---",
      "",
      `# 主题：${topic}`,
      "",
      `以下 **${tDocs.length}** 篇复盘提及了 \`${topic}\`：`,
      "",
      ...tDocs.map(
        (d) => `- ${d.event_date ? `[[10-每日/${d.event_date}|${d.event_date}]] ` : ""}[[${d.card.replace(/\.md$/, "")}|${d.title}]]`,
      ),
      "",
      "返回 [[00-总览]]",
      "",
    ].join("\n");
    await writeAtomic(path.join(vaultRoot, rel), md);
    cardContents.set(rel, md);
    fileTitles.set(rel, `#${topic}`);
  }

  // Write 00-总览.md
  const overviewRel = "00-总览.md";
  const overviewMd = [
    "# TradeLoom · 复盘知识库总览",
    "",
    `> 共收录 **${documents.length}** 篇复盘笔记，覆盖 **${days.length}** 个交易日、**${topics.length}** 个主题双链节点。本目录可直接用 Obsidian 打开。`,
    "",
    "## 按时间线浏览（最新优先）",
    "",
    ...(days.length > 0
      ? [...days].reverse().map((day) => `- [[10-每日/${day}|${day}]]（${byDay.get(day)!.length} 篇）`)
      : ["- 暂无带日期的复盘笔记，可在左上角导入或一键加载示例复盘库。"]),
    "",
    "## 主题与概念双链",
    "",
    ...(topics.length > 0
      ? topics.map((t) => `- [[30-主题/${t}|#${t}]]（${byTopic.get(t)!.length} 篇）`)
      : ["- 在笔记正文使用 `#标签` 或 `[[概念]]` 即可自动生成双链主题页。"]),
    "",
  ].join("\n");
  await writeAtomic(path.join(vaultRoot, overviewRel), overviewMd);
  cardContents.set(overviewRel, overviewMd);
  fileTitles.set(overviewRel, "知识库总览");

  // Compute bidirectional link graph across all vault markdown files
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

  const files = allRels.map((rel) => ({
    rel,
    group: rel.includes("/") ? rel.split("/")[0] : "00-入口",
    title: fileTitles.get(rel) ?? path.basename(rel, ".md"),
  }));

  const index: VaultIndex = {
    schema: "tradeloom-vault@v1",
    built_at: new Date().toISOString(),
    counts: {
      total: documents.length,
      dated: documents.filter((d) => Boolean(d.event_date)).length,
      undated: documents.filter((d) => !d.event_date).length,
      days: days.length,
      topics: topics.length,
      links: totalLinks,
    },
    documents,
    days,
    kinds: [...kindSet].sort(),
    topics,
    files,
    links,
  };

  await writeAtomic(path.join(vaultRoot, "index.json"), JSON.stringify(index, null, 2));
  return index;
}
