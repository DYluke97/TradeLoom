import { McpHttpClient, MCP_ENDPOINTS, type McpToolInfo } from "./mcp-client";

export type TencentDocsScope = "all" | "space" | "drive";

export type TencentDocsFolderSummary = {
  id: string;
  name: string;
  isRoot?: boolean;
};

export type TencentDocsFetchedItem = {
  fileId: string;
  title: string;
  content: string;
  url?: string;
  docType?: string;
  folderName?: string;
  eventDate?: string;
};

const READABLE_DOC_TYPES = new Set([
  "",
  "smartcanvas",
  "word",
  "doc",
  "docx",
  "excel",
  "sheet",
  "smartsheet",
  "slide",
  "ppt",
  "mind",
  "flowchart",
  "pdf",
  "txt",
  "md",
  "markdown",
]);

export function normalizeTencentDocsToken(raw: string): string {
  return raw.trim().replace(/^Bearer\s+/i, "").trim();
}

export function normalizeTencentDocsMcpUrl(raw?: string): string {
  const cleaned = (raw ?? "").trim();
  if (!cleaned) return MCP_ENDPOINTS.tencent_docs;
  return cleaned.replace(/\/+$/, "");
}

export function formatTencentDocsError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? "未知错误");
  if (/400006|401|403|unauthorized|invalid token|token.*expired|鉴权/i.test(msg)) {
    return "腾讯文档 MCP Token 无效或已过期（400006），请重新访问 docs.qq.com/open/auth/mcp.html 登录复制个人 Token";
  }
  if (/400007|vip|会员/i.test(msg)) {
    return "当前接口触发腾讯文档会员权限校验（400007）；个人主 Token 可免费使用（2,000 次/天），协作空间独立 Token 需超级会员";
  }
  if (/timeout|aborted|fetch failed|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
    return `无法连接腾讯文档 MCP 服务：${msg}`;
  }
  return msg;
}

export function createTencentDocsClient(token: string, mcpUrl?: string): McpHttpClient {
  return new McpHttpClient(
    normalizeTencentDocsMcpUrl(mcpUrl),
    normalizeTencentDocsToken(token),
    { authScheme: "raw" },
  );
}

export function findMcpTool(
  tools: McpToolInfo[],
  exactNames: string[],
  fuzzyPattern?: RegExp,
): McpToolInfo | undefined {
  for (const name of exactNames) {
    const exact = tools.find((t) => t.name === name);
    if (exact) return exact;
  }
  const lowerExact = exactNames.map((n) => n.toLowerCase());
  for (const name of lowerExact) {
    const ci = tools.find((t) => t.name.toLowerCase() === name);
    if (ci) return ci;
  }
  if (fuzzyPattern) {
    return tools.find((t) => fuzzyPattern.test(t.name));
  }
  return undefined;
}

function getSchemaPropertyNames(tool?: McpToolInfo): string[] {
  const schema = tool?.inputSchema;
  if (!schema || typeof schema !== "object") return [];
  const props = (schema as { properties?: unknown }).properties;
  if (!props || typeof props !== "object") return [];
  return Object.keys(props as Record<string, unknown>);
}

export function buildSchemaMatchedArgs(
  tool: McpToolInfo | undefined,
  groups: Array<{ aliases: string[]; value: unknown }>,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  const propNames = getSchemaPropertyNames(tool);
  if (propNames.length === 0) return fallback;

  const lowerMap = new Map<string, string>();
  for (const key of propNames) {
    lowerMap.set(key.toLowerCase(), key);
  }

  const out: Record<string, unknown> = {};
  for (const group of groups) {
    if (group.value === undefined || group.value === null || group.value === "") continue;
    for (const alias of group.aliases) {
      const matched = lowerMap.get(alias.toLowerCase());
      if (matched) {
        out[matched] = group.value;
        break;
      }
    }
  }
  return Object.keys(out).length > 0 ? out : fallback;
}

type RawDocEntry = {
  id: string;
  title: string;
  isFolder: boolean;
  docType: string;
  url?: string;
  source: "space" | "drive";
  folderName?: string;
  updatedAt?: string;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function pickStr(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

function normalizeDateCandidate(raw: string): string | undefined {
  if (!raw) return undefined;
  const iso = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(raw);
  if (iso) return iso[1];
  const n = Number(raw);
  if (Number.isFinite(n) && n > 1e9) {
    const ms = n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return undefined;
}

function unwrapTencentPayload(payload: unknown): unknown {
  const rec = asRecord(payload);
  if (!rec) return payload;
  if (rec.error && typeof rec.error === "string" && rec.error.trim()) {
    throw new Error(rec.error.trim());
  }
  if (rec.data !== undefined && rec.data !== null) return rec.data;
  if (rec.result !== undefined && rec.result !== null) return rec.result;
  return rec;
}

export function extractTencentEntries(
  payload: unknown,
  source: "space" | "drive",
  folderName?: string,
): { entries: RawDocEntry[]; hasNext: boolean } {
  const unwrapped = unwrapTencentPayload(payload);
  const rec = asRecord(unwrapped);

  let arr: unknown[] = [];
  if (Array.isArray(unwrapped)) {
    arr = unwrapped;
  } else if (rec) {
    for (const key of ["children", "list", "files", "items", "nodes", "docs", "file_list", "node_list", "records"]) {
      if (Array.isArray(rec[key])) {
        arr = rec[key] as unknown[];
        break;
      }
    }
  }

  const hasNext = Boolean(rec && (rec.has_next === true || rec.has_more === true || rec.hasMore === true));
  const entries: RawDocEntry[] = [];

  for (const item of arr) {
    const obj = asRecord(item);
    if (!obj) continue;
    const id = pickStr(obj, ["node_id", "file_id", "doc_id", "id", "pad_id", "folder_id"]);
    if (!id) continue;
    const title = pickStr(obj, ["title", "name", "file_name", "doc_name", "folder_name"]) || `腾讯文档_${id.slice(0, 8)}`;
    const nodeType = pickStr(obj, ["node_type", "type", "file_type", "obj_type"]).toLowerCase();
    const docType = pickStr(obj, ["doc_type", "sub_type", "format"]).toLowerCase();
    const isFolder =
      nodeType === "wiki_folder" ||
      nodeType === "folder" ||
      nodeType === "dir" ||
      nodeType === "directory" ||
      obj.is_folder === true ||
      obj.isFolder === true ||
      (nodeType === "" && docType === "folder");

    if (nodeType === "link") continue;

    const url = pickStr(obj, ["url", "doc_url", "file_url", "link"]) || undefined;
    const updatedAt = pickStr(obj, ["modify_time", "update_time", "updated_at", "last_modify_time", "create_time"]);

    entries.push({
      id,
      title,
      isFolder,
      docType,
      url,
      source,
      folderName,
      updatedAt: normalizeDateCandidate(updatedAt),
    });
  }

  return { entries, hasNext };
}

export function extractTencentContentText(res: { text: string; json: unknown }): string {
  const json = res.json;
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const rec = json as Record<string, unknown>;
    if (typeof rec.error === "string" && rec.error.trim()) {
      throw new Error(rec.error.trim());
    }
    const inner = asRecord(rec.data) ?? rec;
    for (const key of ["content", "markdown", "text", "body", "doc_content"]) {
      const val = inner[key];
      if (typeof val === "string" && val.trim()) {
        return val.trim();
      }
    }
  }
  const trimmed = (res.text ?? "").trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof parsed.content === "string") return parsed.content.trim();
    } catch {
      /* treat as raw text */
    }
  }
  return trimmed;
}

export async function discoverTencentDocsStructure(
  client: McpHttpClient,
  tools: McpToolInfo[],
): Promise<{ folders: TencentDocsFolderSummary[]; sampleDocCount: number }> {
  const folders: TencentDocsFolderSummary[] = [];
  const seen = new Set<string>();
  let sampleDocCount = 0;

  const pushFolder = (id: string, name: string, isRoot = false) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    folders.push({ id, name, isRoot });
  };

  const spaceTool = findMcpTool(tools, ["query_space_node", "space.query_node", "list_space_nodes"], /query_space_node/i);
  if (spaceTool) {
    try {
      const args = buildSchemaMatchedArgs(spaceTool, [{ aliases: ["num", "page"], value: 0 }], { num: 0 });
      const res = await client.callTool(spaceTool.name, args);
      const { entries } = extractTencentEntries(res.json ?? res.text, "space");
      if (entries.length > 0) pushFolder("space:root", "知识库根目录", true);
      for (const e of entries) {
        if (e.isFolder) pushFolder(`space:${e.id}`, `[知识库] ${e.title}`);
        else sampleDocCount++;
      }
    } catch {
      /* space may be empty or unavailable */
    }
  }

  const folderTool = findMcpTool(tools, ["manage.folder_list", "folder_list", "list_folder"], /(?:manage\.)?folder_list/i);
  if (folderTool) {
    try {
      const args = buildSchemaMatchedArgs(
        folderTool,
        [
          { aliases: ["folder_id", "parent_id", "dir_id"], value: "" },
          { aliases: ["limit", "page_size", "count"], value: 30 },
        ],
        {},
      );
      const res = await client.callTool(folderTool.name, args);
      const { entries } = extractTencentEntries(res.json ?? res.text, "drive");
      if (entries.length > 0) pushFolder("drive:root", "云文档根目录", true);
      for (const e of entries) {
        if (e.isFolder) pushFolder(`drive:${e.id}`, `[云文档] ${e.title}`);
        else sampleDocCount++;
      }
    } catch {
      /* drive listing optional */
    }
  }

  return { folders: folders.slice(0, 30), sampleDocCount };
}

function parseFilterTokens(raw?: string): string[] {
  return (raw ?? "")
    .split(/[\n,;，；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function fetchTencentDocsItems(
  client: McpHttpClient,
  tools: McpToolInfo[],
  opts: {
    scope: TencentDocsScope;
    parentId?: string;
    keyword?: string;
    maxItems: number;
  },
): Promise<TencentDocsFetchedItem[]> {
  const limit = Math.min(80, Math.max(1, opts.maxItems || 25));
  const keyword = (opts.keyword ?? "").trim();
  const filterTokens = parseFilterTokens(opts.parentId);

  const spaceNodeTool = findMcpTool(tools, ["query_space_node", "space.query_node"], /query_space_node/i);
  const spaceSearchTool = findMcpTool(tools, ["search_space_file"], /search_space_file/i);
  const driveFolderTool = findMcpTool(tools, ["manage.folder_list", "folder_list"], /(?:manage\.)?folder_list/i);
  const driveSearchTool = findMcpTool(tools, ["manage.search_file", "search_file"], /(?:manage\.)?search_file/i);
  const recentTool = findMcpTool(tools, ["manage.recent_online_file", "recent_online_file"], /recent_online_file/i);
  const readTool = findMcpTool(tools, ["get_content", "read_content", "get_doc_content"], /^get_content$|get_doc_content/i);

  if (!readTool) {
    throw new Error("腾讯文档 MCP 未返回正文读取工具（get_content），请检查 Token 权限");
  }

  const candidates: RawDocEntry[] = [];
  const seenIds = new Set<string>();

  const pushCandidate = (entry: RawDocEntry) => {
    if (candidates.length >= limit) return;
    if (entry.isFolder || !entry.id || seenIds.has(entry.id)) return;
    if (entry.docType && !READABLE_DOC_TYPES.has(entry.docType)) return;
    seenIds.add(entry.id);
    candidates.push(entry);
  };

  const walkSpaceNode = async (parentId: string | undefined, folderLabel: string, depth: number) => {
    if (!spaceNodeTool || candidates.length >= limit || depth > 2) return;
    for (let page = 0; page < 3 && candidates.length < limit; page++) {
      try {
        const args = buildSchemaMatchedArgs(
          spaceNodeTool,
          [
            { aliases: ["parent_id", "node_id", "folder_id"], value: parentId },
            { aliases: ["num", "page"], value: page },
          ],
          parentId ? { parent_id: parentId, num: page } : { num: page },
        );
        const res = await client.callTool(spaceNodeTool.name, args);
        const { entries, hasNext } = extractTencentEntries(res.json ?? res.text, "space", folderLabel);
        for (const entry of entries) {
          if (candidates.length >= limit) break;
          if (!entry.isFolder) {
            pushCandidate({ ...entry, folderName: folderLabel });
          } else if (depth < 2) {
            const nextLabel = folderLabel ? `${folderLabel}/${entry.title}` : entry.title;
            await walkSpaceNode(entry.id, nextLabel, depth + 1);
          }
        }
        if (!hasNext || entries.length < 20) break;
      } catch {
        break;
      }
    }
  };

  const walkDriveFolder = async (folderId: string | undefined, folderLabel: string, depth: number) => {
    if (!driveFolderTool || candidates.length >= limit || depth > 1) return;
    try {
      const args = buildSchemaMatchedArgs(
        driveFolderTool,
        [
          { aliases: ["folder_id", "parent_id", "dir_id"], value: folderId },
          { aliases: ["limit", "page_size", "count"], value: Math.min(30, limit) },
          { aliases: ["start", "offset"], value: 0 },
        ],
        folderId ? { folder_id: folderId } : {},
      );
      const res = await client.callTool(driveFolderTool.name, args);
      const { entries } = extractTencentEntries(res.json ?? res.text, "drive", folderLabel);
      for (const entry of entries) {
        if (candidates.length >= limit) break;
        if (!entry.isFolder) {
          pushCandidate({ ...entry, folderName: folderLabel });
        } else if (depth < 1) {
          const nextLabel = folderLabel ? `${folderLabel}/${entry.title}` : entry.title;
          await walkDriveFolder(entry.id, nextLabel, depth + 1);
        }
      }
    } catch {
      /* ignore inaccessible folder */
    }
  };

  if (keyword) {
    if ((opts.scope === "all" || opts.scope === "space") && spaceSearchTool) {
      try {
        const args = buildSchemaMatchedArgs(
          spaceSearchTool,
          [
            { aliases: ["keyword", "query", "key_word", "search_key", "word"], value: keyword },
            { aliases: ["num", "page"], value: 0 },
            { aliases: ["limit", "page_size", "count"], value: limit },
          ],
          { keyword, num: 0 },
        );
        const res = await client.callTool(spaceSearchTool.name, args);
        const { entries } = extractTencentEntries(res.json ?? res.text, "space", `知识库检索:${keyword}`);
        for (const e of entries) pushCandidate(e);
      } catch {
        /* fallback to drive search */
      }
    }
    if ((opts.scope === "all" || opts.scope === "drive") && driveSearchTool && candidates.length < limit) {
      try {
        const args = buildSchemaMatchedArgs(
          driveSearchTool,
          [
            { aliases: ["keyword", "query", "key_word", "title", "search_key"], value: keyword },
            { aliases: ["limit", "page_size", "count"], value: limit },
          ],
          { keyword },
        );
        const res = await client.callTool(driveSearchTool.name, args);
        const { entries } = extractTencentEntries(res.json ?? res.text, "drive", `云文档检索:${keyword}`);
        for (const e of entries) pushCandidate(e);
      } catch {
        /* ignore */
      }
    }
  } else if (filterTokens.length > 0) {
    for (const token of filterTokens) {
      if (candidates.length >= limit) break;
      if (token === "space:root") {
        await walkSpaceNode(undefined, "知识库", 0);
      } else if (token.startsWith("space:")) {
        const nodeId = token.slice(6).trim();
        if (nodeId) await walkSpaceNode(nodeId, `知识库/${nodeId.slice(0, 8)}`, 0);
      } else if (token === "drive:root") {
        await walkDriveFolder(undefined, "云文档", 0);
      } else if (token.startsWith("drive:")) {
        const fid = token.slice(6).trim();
        if (fid) await walkDriveFolder(fid, `云文档/${fid.slice(0, 8)}`, 0);
      } else {
        if (opts.scope !== "drive") await walkSpaceNode(token, "知识库", 0);
        if (opts.scope !== "space" && candidates.length < limit) await walkDriveFolder(token, "云文档", 0);
      }
    }
  } else {
    if (opts.scope === "all" || opts.scope === "space") {
      await walkSpaceNode(undefined, "知识库", 0);
    }
    if ((opts.scope === "all" || opts.scope === "drive") && candidates.length < limit) {
      await walkDriveFolder(undefined, "云文档", 0);
      if (candidates.length < limit && recentTool) {
        try {
          const args = buildSchemaMatchedArgs(
            recentTool,
            [{ aliases: ["limit", "page_size", "count"], value: limit }],
            {},
          );
          const res = await client.callTool(recentTool.name, args);
          const { entries } = extractTencentEntries(res.json ?? res.text, "drive", "最近查看");
          for (const e of entries) pushCandidate(e);
        } catch {
          /* recent list optional */
        }
      }
    }
  }

  const items: TencentDocsFetchedItem[] = [];
  for (const doc of candidates) {
    try {
      const readArgs = buildSchemaMatchedArgs(
        readTool,
        [{ aliases: ["file_id", "doc_id", "node_id", "id"], value: doc.id }],
        { file_id: doc.id },
      );
      const res = await client.callTool(readTool.name, readArgs);
      const body = extractTencentContentText(res);
      if (!body) continue;

      const dateMatch = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(`${doc.title}\n${body.slice(0, 400)}`);
      items.push({
        fileId: doc.id,
        title: doc.title,
        content: body,
        url: doc.url,
        docType: doc.docType || undefined,
        folderName: doc.folderName,
        eventDate: doc.updatedAt || (dateMatch ? dateMatch[1] : undefined),
      });
    } catch {
      /* skip unreadable/binary document and continue */
    }
  }

  return items;
}