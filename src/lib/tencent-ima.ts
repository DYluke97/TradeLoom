export const IMA_DEFAULT_BASE_URL = "https://ima.qq.com";

export type ImaFolderSummary = {
  id: string;
  name: string;
  isRoot?: boolean;
};

export type ImaKnowledgeBaseSummary = {
  id: string;
  namespace: string;
  name: string;
  description?: string;
  itemsCount?: number;
};

export type ImaNoteSummary = {
  id: string;
  title: string;
  summary?: string;
  folderId?: string;
  folderName?: string;
  eventDate?: string;
};

export type ImaWikiItem = {
  mediaId: string;
  title: string;
  mediaType: number;
  kbId: string;
  kbName: string;
  folderPath?: string;
};

export type ImaFetchedItem = {
  id: string;
  title: string;
  content: string;
  channel: "note" | "wiki";
  sourceLabel: string;
  sourceUrl?: string;
  eventDate?: string;
  tags: string[];
};

export class ImaApiError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "ImaApiError";
    this.code = code;
  }
}

export function normalizeImaBaseUrl(raw?: string): string {
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return IMA_DEFAULT_BASE_URL;
  return trimmed;
}

export function formatImaError(code: number, msg?: string): string {
  if (code === 200002 || /auth|apikey|clientid|token|invalid|expired/i.test(msg ?? "")) {
    return `腾讯 ima 鉴权失败或 API Key 已过期（code=${code}），请前往 ima.qq.com/agent-interface 重新生成 API Key`;
  }
  if (code === 220021) {
    return "腾讯 ima 资料读取接口今日已达调用上限（220021），请明日再试";
  }
  return `腾讯 ima 接口错误（code=${code}）：${msg || "请检查 Client ID、API Key 及网络状态"}`;
}

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

function normalizeImaTimestamp(raw: string): string | undefined {
  if (!raw) return undefined;
  const iso = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(raw);
  if (iso) return iso[1];
  const num = Number(raw);
  if (Number.isFinite(num) && num > 1e9) {
    const ms = num > 1e12 ? num : num * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return undefined;
}

export async function imaPostJson<T = Record<string, unknown>>(
  baseUrl: string,
  endpoint: string,
  clientId: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<T> {
  const url = `${normalizeImaBaseUrl(baseUrl)}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ima-openapi-clientid": clientId.trim(),
      "ima-openapi-apikey": apiKey.trim(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new ImaApiError(res.status, `腾讯 ima HTTP ${res.status}: ${text.slice(0, 220)}`);
  }

  let parsed: { code?: number; msg?: string; message?: string; data?: T };
  try {
    parsed = JSON.parse(text) as { code?: number; msg?: string; message?: string; data?: T };
  } catch {
    throw new ImaApiError(-1, `腾讯 ima 返回了非 JSON 响应：${text.slice(0, 180)}`);
  }

  const code = typeof parsed.code === "number" ? parsed.code : 0;
  if (code !== 0) {
    throw new ImaApiError(code, formatImaError(code, parsed.msg ?? parsed.message));
  }

  return (parsed.data ?? (parsed as unknown as T)) as T;
}

export function parseImaFolders(data: unknown): { folders: ImaFolderSummary[]; nextCursor: string; isEnd: boolean } {
  const rec = asRecord(data);
  if (!rec) return { folders: [], nextCursor: "", isEnd: true };

  const folders: ImaFolderSummary[] = [];
  const seen = new Set<string>();

  const pushFolder = (obj: Record<string, unknown> | null) => {
    if (!obj) return;
    const id = pickStr(obj, ["folder_id", "id", "notebook_id"]);
    const name = pickStr(obj, ["folder_name", "name", "title"]);
    if (!id || seen.has(id)) return;
    seen.add(id);
    folders.push({ id, name: name || `笔记本_${id.slice(0, 6)}` });
  };

  if (Array.isArray(rec.note_book_folders)) {
    for (const item of rec.note_book_folders) {
      const wrap = asRecord(item);
      const folder = asRecord(wrap?.folder) ?? wrap;
      const basic = asRecord(folder?.basic_info) ?? folder;
      pushFolder(basic);
    }
  }
  for (const key of ["note_folder_infos", "folders", "list", "items"]) {
    if (Array.isArray(rec[key])) {
      for (const item of rec[key] as unknown[]) {
        const obj = asRecord(item);
        const basic = asRecord(obj?.basic_info) ?? obj;
        pushFolder(basic);
      }
    }
  }

  const nextCursor = pickStr(rec, ["next_cursor", "cursor"]);
  const isEnd = rec.is_end === true || !nextCursor;
  return { folders, nextCursor, isEnd };
}

export function parseImaNotes(data: unknown): { notes: ImaNoteSummary[]; nextCursor: string; isEnd: boolean } {
  const rec = asRecord(data);
  if (!rec) return { notes: [], nextCursor: "", isEnd: true };

  const notes: ImaNoteSummary[] = [];
  const seen = new Set<string>();

  const rawList =
    (Array.isArray(rec.note_book_list) && rec.note_book_list) ||
    (Array.isArray(rec.docs) && rec.docs) ||
    (Array.isArray(rec.notes) && rec.notes) ||
    (Array.isArray(rec.list) && rec.list) ||
    (Array.isArray(rec.items) && rec.items) ||
    [];

  for (const item of rawList) {
    const outer = asRecord(item);
    if (!outer) continue;
    const lvl1 = asRecord(outer.basic_info) ?? asRecord(outer.doc) ?? outer;
    const info = asRecord(lvl1.basic_info) ?? lvl1;

    const id = pickStr(info, ["docid", "doc_id", "note_id", "id"]) || pickStr(outer, ["docid", "doc_id", "note_id", "id"]);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const title = pickStr(info, ["title", "name", "doc_title"]) || `ima笔记_${id.slice(0, 8)}`;
    const summary = pickStr(info, ["summary", "abstract", "snippet"]) || undefined;
    const folderId = pickStr(info, ["folder_id", "notebook_id"]) || undefined;
    const folderName = pickStr(info, ["folder_name", "notebook_name"]) || undefined;
    const ts = pickStr(info, ["modify_time", "update_time", "create_time"]);

    notes.push({
      id,
      title,
      summary,
      folderId,
      folderName,
      eventDate: normalizeImaTimestamp(ts),
    });
  }

  const nextCursor = pickStr(rec, ["next_cursor", "cursor"]);
  const isEnd = rec.is_end === true || !nextCursor;
  return { notes, nextCursor, isEnd };
}

export function parseImaKnowledgeBases(data: unknown): ImaKnowledgeBaseSummary[] {
  const rec = asRecord(data);
  if (!rec) return [];

  const listKeys = [
    "knowledge_base_list",
    "addable_knowledge_base_list",
    "info_list",
    "kb_list",
    "list",
    "items",
  ];
  let rawList: unknown[] = [];
  for (const key of listKeys) {
    if (Array.isArray(rec[key])) {
      rawList = rec[key] as unknown[];
      break;
    }
  }

  const repos: ImaKnowledgeBaseSummary[] = [];
  const seen = new Set<string>();
  for (const item of rawList) {
    const outer = asRecord(item);
    if (!outer) continue;
    const info = asRecord(outer.basic_info) ?? asRecord(outer.knowledge_base) ?? outer;
    const id = pickStr(info, ["kb_id", "knowledge_base_id", "id"]) || pickStr(outer, ["kb_id", "knowledge_base_id", "id"]);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = pickStr(info, ["name", "title", "kb_name"]) || `知识库_${id.slice(0, 8)}`;
    const description = pickStr(info, ["description", "desc", "intro"]) || undefined;
    const rawCount = Number(info.media_count ?? info.item_count ?? info.doc_count ?? info.knowledge_count);
    repos.push({
      id,
      namespace: id,
      name,
      description,
      itemsCount: Number.isFinite(rawCount) && rawCount > 0 ? rawCount : undefined,
    });
  }

  return repos;
}

export function parseImaKnowledgeItems(
  data: unknown,
  kbId: string,
  kbName: string,
  folderPath?: string,
): { items: ImaWikiItem[]; nextCursor: string; isEnd: boolean } {
  const rec = asRecord(data);
  if (!rec) return { items: [], nextCursor: "", isEnd: true };

  const rawList =
    (Array.isArray(rec.knowledge_list) && rec.knowledge_list) ||
    (Array.isArray(rec.items) && rec.items) ||
    (Array.isArray(rec.list) && rec.list) ||
    [];

  const items: ImaWikiItem[] = [];
  const seen = new Set<string>();
  for (const item of rawList) {
    const obj = asRecord(item);
    if (!obj) continue;
    const mediaId = pickStr(obj, ["media_id", "id", "knowledge_id"]);
    if (!mediaId || seen.has(mediaId)) continue;
    seen.add(mediaId);
    const title = pickStr(obj, ["title", "name", "file_name"]) || `资料_${mediaId.slice(0, 8)}`;
    const mediaType = Number(obj.media_type ?? obj.type ?? 0) || 0;
    items.push({ mediaId, title, mediaType, kbId, kbName, folderPath });
  }

  const nextCursor = pickStr(rec, ["next_cursor", "cursor"]);
  const isEnd = rec.is_end === true || !nextCursor;
  return { items, nextCursor, isEnd };
}

export function extractImaTextFromHtml(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (!/<[a-z][\s\S]*>/i.test(trimmed)) return trimmed;

  return trimmed
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, lvl, inner) => `\n${"#".repeat(Number(lvl))} ${String(inner).replace(/<[^>]+>/g, "").trim()}\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => `- ${String(inner).replace(/<[^>]+>/g, "").trim()}\n`)
    .replace(/<(?:br|\/p|\/div|\/section|\/article|\/blockquote)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchImaNoteBody(
  baseUrl: string,
  clientId: string,
  apiKey: string,
  noteId: string,
): Promise<string> {
  try {
    const data = await imaPostJson<{ content?: string; text?: string }>(
      baseUrl,
      "/openapi/note/v1/get_doc_content",
      clientId,
      apiKey,
      { doc_id: noteId, note_id: noteId, target_content_format: 0 },
    );
    return (data.content ?? data.text ?? "").trim();
  } catch (err) {
    if (err instanceof ImaApiError && (err.code === 200002 || err.code === 220021)) {
      throw err;
    }
    const data = await imaPostJson<{ content?: string; text?: string }>(
      baseUrl,
      "/openapi/note/v1/get_doc_content",
      clientId,
      apiKey,
      { doc_id: noteId, target_content_format: 0 },
    );
    return (data.content ?? data.text ?? "").trim();
  }
}

export async function discoverImaWorkspace(
  clientId: string,
  apiKey: string,
  baseUrl?: string,
): Promise<{ folders: ImaFolderSummary[]; repos: ImaKnowledgeBaseSummary[] }> {
  const base = normalizeImaBaseUrl(baseUrl);
  const folders: ImaFolderSummary[] = [];
  const repos: ImaKnowledgeBaseSummary[] = [];
  const seenRepos = new Set<string>();
  let authError: Error | null = null;

  try {
    const data = await imaPostJson(base, "/openapi/note/v1/list_note_folder_by_cursor", clientId, apiKey, {
      cursor: "0",
      limit: 50,
    });
    folders.push(...parseImaFolders(data).folders);
  } catch (err) {
    if (err instanceof ImaApiError && err.code === 200002) throw err;
    try {
      const data = await imaPostJson(base, "/openapi/note/v1/list_notebook", clientId, apiKey, {
        cursor: "0",
        limit: 50,
      });
      folders.push(...parseImaFolders(data).folders);
    } catch (err2) {
      if (err2 instanceof ImaApiError && err2.code === 200002) throw err2;
      authError = err2 instanceof Error ? err2 : new Error(String(err2));
    }
  }

  let wikiSuccess = false;
  for (const ep of [
    { path: "/openapi/wiki/v1/search_knowledge_base", body: { query: "", cursor: "", limit: 30 } },
    { path: "/openapi/wiki/v1/get_addable_knowledge_base_list", body: { cursor: "", limit: 50 } },
  ]) {
    try {
      const data = await imaPostJson(base, ep.path, clientId, apiKey, ep.body);
      wikiSuccess = true;
      for (const kb of parseImaKnowledgeBases(data)) {
        if (!seenRepos.has(kb.id)) {
          seenRepos.add(kb.id);
          repos.push(kb);
        }
      }
    } catch (err) {
      if (err instanceof ImaApiError && err.code === 200002) throw err;
      if (!authError) authError = err instanceof Error ? err : new Error(String(err));
    }
  }

  if (folders.length === 0 && repos.length === 0 && !wikiSuccess && authError) {
    throw authError;
  }

  return { folders: folders.slice(0, 30), repos: repos.slice(0, 30) };
}

function parseSelection(raw?: string): string[] {
  return (raw ?? "")
    .split(/[\n,;，；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const TEXT_READABLE_MEDIA_TYPES = new Set([2, 6, 13, 20]);

export async function fetchImaItems(
  clientId: string,
  apiKey: string,
  opts: {
    baseUrl?: string;
    includeNotes: boolean;
    includeWiki: boolean;
    folderId?: string;
    wikiId?: string;
    keyword?: string;
    maxItems: number;
    discoveredFolders?: ImaFolderSummary[];
    discoveredRepos?: ImaKnowledgeBaseSummary[];
  },
): Promise<{ items: ImaFetchedItem[]; warnings: string[] }> {
  const base = normalizeImaBaseUrl(opts.baseUrl);
  const limit = Math.min(80, Math.max(1, opts.maxItems || 30));
  const keyword = (opts.keyword ?? "").trim();
  const items: ImaFetchedItem[] = [];
  const warnings: string[] = [];
  const seenNoteIds = new Set<string>();

  if (opts.includeNotes) {
    const candidateNotes: ImaNoteSummary[] = [];
    const selectedFolders = parseSelection(opts.folderId);
    const knownFolders = opts.discoveredFolders ?? [];

    const pushNote = (n: ImaNoteSummary) => {
      if (candidateNotes.length >= limit || seenNoteIds.has(n.id)) return;
      seenNoteIds.add(n.id);
      candidateNotes.push(n);
    };

    if (keyword) {
      try {
        const data = await imaPostJson(base, "/openapi/note/v1/search_note_book", clientId, apiKey, {
          search_type: 0,
          query_info: { title: keyword },
          start: 0,
          end: Math.min(40, limit),
        });
        for (const n of parseImaNotes(data).notes) pushNote(n);
      } catch (err) {
        if (err instanceof ImaApiError && err.code === 200002) throw err;
        try {
          const data = await imaPostJson(base, "/openapi/note/v1/search_note", clientId, apiKey, {
            query: keyword,
            limit: Math.min(40, limit),
          });
          for (const n of parseImaNotes(data).notes) pushNote(n);
        } catch {
          /* ignore */
        }
      }
    } else {
      const targetFolderIds: Array<{ id?: string; name?: string }> = [];
      if (selectedFolders.length > 0) {
        for (const token of selectedFolders) {
          const lower = token.toLowerCase();
          const matched = knownFolders.find(
            (f) => f.id.toLowerCase() === lower || f.name.toLowerCase() === lower,
          );
          targetFolderIds.push({ id: matched?.id ?? token, name: matched?.name ?? token });
        }
      } else {
        targetFolderIds.push({ id: undefined, name: undefined });
      }

      for (const target of targetFolderIds) {
        if (candidateNotes.length >= limit) break;
        let cursor = "";
        for (let page = 0; page < 3 && candidateNotes.length < limit; page++) {
          const body: Record<string, unknown> = {
            cursor,
            limit: Math.min(25, limit - candidateNotes.length),
            ...(target.id ? { folder_id: target.id } : {}),
          };
          let data: unknown;
          try {
            data = await imaPostJson(base, "/openapi/note/v1/list_note_by_folder_id", clientId, apiKey, body);
          } catch (err) {
            if (err instanceof ImaApiError && err.code === 200002) throw err;
            try {
              data = await imaPostJson(base, "/openapi/note/v1/list_note", clientId, apiKey, body);
            } catch {
              break;
            }
          }
          const parsed = parseImaNotes(data);
          for (const n of parsed.notes) {
            pushNote({ ...n, folderName: n.folderName || target.name });
          }
          if (parsed.isEnd || !parsed.nextCursor || parsed.notes.length === 0) break;
          cursor = parsed.nextCursor;
        }
      }
    }

    for (const note of candidateNotes) {
      if (items.length >= limit) break;
      try {
        const body = await fetchImaNoteBody(base, clientId, apiKey, note.id);
        const text = body || note.summary || "";
        if (!text) continue;
        const dateMatch = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(`${note.title}\n${text.slice(0, 400)}`);
        const folderTag = note.folderName?.trim();
        items.push({
          id: `note:${note.id}`,
          title: note.title,
          content: text,
          channel: "note",
          sourceLabel: folderTag ? `腾讯 ima 笔记 · ${folderTag}` : "腾讯 ima 笔记",
          eventDate: note.eventDate || (dateMatch ? dateMatch[1] : undefined),
          tags: Array.from(new Set(["腾讯ima", "ima笔记", ...(folderTag ? [folderTag] : [])])),
        });
      } catch (err) {
        if (err instanceof ImaApiError && err.code === 200002) throw err;
      }
    }
  }

  if (opts.includeWiki && items.length < limit) {
    let availableKbs = opts.discoveredRepos ?? [];
    if (availableKbs.length === 0) {
      try {
        const data = await imaPostJson(base, "/openapi/wiki/v1/search_knowledge_base", clientId, apiKey, {
          query: "",
          cursor: "",
          limit: 20,
        });
        availableKbs = parseImaKnowledgeBases(data);
      } catch (err) {
        if (err instanceof ImaApiError && err.code === 200002) throw err;
      }
    }

    const selectedWikiTokens = parseSelection(opts.wikiId);
    const targetKbs: ImaKnowledgeBaseSummary[] = [];
    if (selectedWikiTokens.length > 0) {
      for (const token of selectedWikiTokens) {
        const lower = token.toLowerCase();
        const matched = availableKbs.find(
          (kb) => kb.id.toLowerCase() === lower || kb.name.toLowerCase() === lower,
        );
        targetKbs.push(matched ?? { id: token, namespace: token, name: token });
      }
    } else {
      targetKbs.push(...availableKbs.slice(0, 5));
    }

    const wikiCandidates: ImaWikiItem[] = [];
    const seenMedia = new Set<string>();
    const remainingBudget = limit - items.length;

    const walkKb = async (kb: ImaKnowledgeBaseSummary, folderId: string | undefined, folderPath: string, depth: number) => {
      if (wikiCandidates.length >= remainingBudget || depth > 1) return;
      try {
        const body: Record<string, unknown> = {
          knowledge_base_id: kb.id,
          cursor: "",
          limit: Math.min(30, remainingBudget),
          ...(folderId ? { folder_id: folderId } : {}),
        };
        const data = await imaPostJson(base, "/openapi/wiki/v1/get_knowledge_list", clientId, apiKey, body);
        const { items: listed } = parseImaKnowledgeItems(data, kb.id, kb.name, folderPath);
        for (const entry of listed) {
          if (wikiCandidates.length >= remainingBudget) break;
          if (entry.mediaType === 99) {
            if (depth < 1) {
              const nextPath = folderPath ? `${folderPath}/${entry.title}` : entry.title;
              await walkKb(kb, entry.mediaId, nextPath, depth + 1);
            }
          } else if (!seenMedia.has(entry.mediaId)) {
            seenMedia.add(entry.mediaId);
            wikiCandidates.push(entry);
          }
        }
      } catch (err) {
        if (err instanceof ImaApiError && err.code === 200002) throw err;
      }
    };

    for (const kb of targetKbs) {
      if (wikiCandidates.length >= remainingBudget) break;
      if (keyword) {
        try {
          const data = await imaPostJson(base, "/openapi/wiki/v1/search_knowledge", clientId, apiKey, {
            knowledge_base_id: kb.id,
            query: keyword,
            cursor: "",
            limit: Math.min(30, remainingBudget),
          });
          const { items: found } = parseImaKnowledgeItems(data, kb.id, kb.name, `检索:${keyword}`);
          for (const entry of found) {
            if (wikiCandidates.length >= remainingBudget) break;
            if (entry.mediaType !== 99 && !seenMedia.has(entry.mediaId)) {
              seenMedia.add(entry.mediaId);
              wikiCandidates.push(entry);
            }
          }
        } catch (err) {
          if (err instanceof ImaApiError && err.code === 200002) throw err;
        }
      } else {
        await walkKb(kb, undefined, "", 0);
      }
    }

    let skippedBinaryCount = 0;
    for (const entry of wikiCandidates) {
      if (items.length >= limit) break;
      try {
        const media = await imaPostJson<{
          url_info?: { url?: string; headers?: Record<string, string> };
          notebook_ext_info?: { notebook_id?: string };
        }>(base, "/openapi/wiki/v1/get_media_info", clientId, apiKey, { media_id: entry.mediaId });

        const linkedNoteId = media.notebook_ext_info?.notebook_id?.trim();
        let body = "";
        let sourceUrl: string | undefined;

        if (entry.mediaType === 11 || linkedNoteId) {
          const noteId = linkedNoteId || entry.mediaId;
          if (seenNoteIds.has(noteId)) continue;
          seenNoteIds.add(noteId);
          body = await fetchImaNoteBody(base, clientId, apiKey, noteId);
        } else if (media.url_info?.url) {
          sourceUrl = media.url_info.url;
          const urlLower = sourceUrl.toLowerCase();
          const isTextUrl =
            TEXT_READABLE_MEDIA_TYPES.has(entry.mediaType) ||
            /\.(?:md|markdown|txt|html|htm)(?:\?|$)/i.test(urlLower);

          if (!isTextUrl) {
            skippedBinaryCount++;
            continue;
          }

          const dlRes = await fetch(sourceUrl, {
            headers: {
              "User-Agent": "TradeLoom/1.0.0",
              ...(media.url_info.headers ?? {}),
            },
            signal: AbortSignal.timeout(15000),
          });
          if (dlRes.ok) {
            const ctype = (dlRes.headers.get("content-type") ?? "").toLowerCase();
            if (!ctype || ctype.includes("text/") || ctype.includes("html") || ctype.includes("markdown") || ctype.includes("json")) {
              const rawText = await dlRes.text();
              body = extractImaTextFromHtml(rawText);
            } else {
              skippedBinaryCount++;
              continue;
            }
          }
        }

        if (!body) continue;
        const dateMatch = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(`${entry.title}\n${body.slice(0, 400)}`);
        items.push({
          id: `wiki:${entry.mediaId}`,
          title: entry.title,
          content: body,
          channel: "wiki",
          sourceLabel: entry.folderPath
            ? `腾讯 ima 知识库 · ${entry.kbName}/${entry.folderPath}`
            : `腾讯 ima 知识库 · ${entry.kbName}`,
          sourceUrl,
          eventDate: dateMatch ? dateMatch[1] : undefined,
          tags: Array.from(new Set(["腾讯ima", "ima知识库", entry.kbName])),
        });
      } catch (err) {
        if (err instanceof ImaApiError && err.code === 200002) throw err;
        if (err instanceof ImaApiError && err.code === 220021) {
          warnings.push("ima 知识库资料读取接口触达每日上限（220021），已保留此前成功拉取的笔记与资料");
          break;
        }
      }
    }

    if (skippedBinaryCount > 0) {
      warnings.push(`已跳过 ${skippedBinaryCount} 份二进制附件（PDF/Word/音视频），如需导入请在 ima 导出后拖入本地上传`);
    }
  }

  return { items, warnings };
}