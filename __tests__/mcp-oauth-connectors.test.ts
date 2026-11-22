import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { gunzipSync } from "node:zlib";
import {
  beginFeishuAppRegistration,
  encodeFeishuAddons,
  extractLarkCliDocBody,
  extractLarkCliDocsFromSearch,
  parseLarkCliJson,
  pollFeishuAppRegistration,
  stripHighlightTags,
  TRADELOOM_FEISHU_ADDONS,
} from "../src/lib/feishu-agent";
import { describe, expect, it } from "vitest";
import {
  cleanYoudaoNoteTitle,
  extractYoudaoEntries,
  extractYoudaoNoteContent,
  extractYuqueNoteText,
  isDidaWelcomeProject,
  isDidaWelcomeTask,
  normalizeYuqueBaseUrl,
  parseYoudaoTimestamp,
} from "../src/lib/cloud-connectors";
import {
  createTencentDocsClient,
  discoverTencentDocsStructure,
  fetchTencentDocsItems,
  formatTencentDocsError,
  normalizeTencentDocsToken,
} from "../src/lib/tencent-docs-mcp";
import {
  discoverImaWorkspace,
  extractImaTextFromHtml,
  fetchImaItems,
  parseImaFolders,
  parseImaNotes,
} from "../src/lib/tencent-ima";
import {
  encodePowerShellScript,
  formatOneNoteLocalError,
  parseOneNoteHierarchyXml,
  parseOneNotePageXmlToMarkdown,
} from "../src/lib/onenote-local";
import {
  createPkcePair,
  MCP_ENDPOINTS,
  McpSseClient,
  parseSseEventBlock,
  parseStreamableHttpBody,
  resolveMcpUrl,
} from "../src/lib/mcp-client";

describe("MCP OAuth 2.1 + Streamable HTTP helpers", () => {
  it("generates valid RFC 7636 S256 PKCE verifier/challenge pairs", () => {
    const { codeVerifier, codeChallenge, state } = createPkcePair();
    expect(codeVerifier.length).toBeGreaterThanOrEqual(40);
    expect(state.length).toBeGreaterThanOrEqual(20);
    expect(codeVerifier).not.toMatch(/[+/=]/);
    expect(codeChallenge).not.toMatch(/[+/=]/);

    const expected = createHash("sha256")
      .update(codeVerifier)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    expect(codeChallenge).toBe(expected);
  });

  it("resolves official MCP endpoints for Dida365 CN, TickTick Global, Notion, and YoudaoNote", () => {
    expect(resolveMcpUrl("dida365", "cn")).toBe(MCP_ENDPOINTS.dida365_cn);
    expect(resolveMcpUrl("dida365", "global")).toBe(MCP_ENDPOINTS.dida365_global);
    expect(resolveMcpUrl("notion")).toBe(MCP_ENDPOINTS.notion);
    expect(MCP_ENDPOINTS.youdao).toBe("https://open.mail.163.com/api/ynote/mcp/sse");
  });

  it("parses both JSON and SSE Streamable HTTP MCP responses", () => {
    const jsonMsg = parseStreamableHttpBody(
      JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "list_projects" }] } }),
      "application/json",
      2,
    );
    expect(jsonMsg.id).toBe(2);
    expect((jsonMsg.result as { tools: Array<{ name: string }> }).tools[0].name).toBe("list_projects");

    const sseBody = [
      "event: message",
      'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}',
      "",
      "event: message",
      'data: {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"[]"}]}}',
      "",
    ].join("\n");
    const sseMsg = parseStreamableHttpBody(sseBody, "text/event-stream", 3);
    expect(sseMsg.id).toBe(3);
    expect((sseMsg.result as { content: Array<{ text: string }> }).content[0].text).toBe("[]");
  });

  it("identifies Dida365 official welcome tutorials without false positives on trading notes", () => {
    expect(isDidaWelcomeProject("欢迎使用")).toBe(true);
    expect(isDidaWelcomeProject("Welcome")).toBe(true);
    expect(isDidaWelcomeProject("盘后复盘")).toBe(false);
    expect(isDidaWelcomeProject("A股交易计划")).toBe(false);

    const officialSamples = [
      "→ 关联微信公众号，从微信保存任务",
      "→ 观看 1 分钟视频教程",
      "⚙开启番茄专注和习惯打卡",
      "❓ 还想了解更多？来帮助中心看看",
      "➡️ 点此快速入门",
      "👥 团队共享协作",
      "💎 高级会员",
      "💡 快速了解滴答清单",
      "🕒 智能时间识别",
      "📅 用日历视图安排任务",
      "向左滑动任务来设置日期和提醒",
      "按住右下角➕可以语音添加任务",
      "长按右下角➕语音添加任务",
      "点击任务进入详情，可以写更多备注",
      "点击任务前的小方框来完成任务",
      "点击右下角➕添加任务",
    ];
    for (const s of officialSamples) {
      expect(isDidaWelcomeTask(s), `should filter welcome task: ${s}`).toBe(true);
    }

    expect(isDidaWelcomeTask("2026-11-22 盘后复盘：锂矿分歧减仓")).toBe(false);
    expect(isDidaWelcomeTask("复盘总结：避免高位追涨")).toBe(false);
  });
});

describe("YoudaoNote Official MCP-over-SSE client & helpers", () => {
  it("parses SSE event blocks including endpoint and message events", () => {
    expect(parseSseEventBlock(": heartbeat\nevent: endpoint\ndata: /api/ynote/mcp/message?sessionId=abc")).toEqual({
      event: "endpoint",
      data: "/api/ynote/mcp/message?sessionId=abc",
    });
    expect(parseSseEventBlock('data: {"jsonrpc":"2.0","id":1}')).toEqual({
      event: "message",
      data: '{"jsonrpc":"2.0","id":1}',
    });
    expect(parseSseEventBlock(": only comment")).toBeNull();
  });

  it("normalizes YoudaoNote titles, timestamps, entries, and content payloads", () => {
    expect(cleanYoudaoNoteTitle("2026-11-22 盘后复盘.note")).toBe("2026-11-22 盘后复盘");
    expect(cleanYoudaoNoteTitle("交易纪律.md")).toBe("交易纪律");
    expect(parseYoudaoTimestamp(1732233600)).toBe("2024-11-22");
    expect(parseYoudaoTimestamp(1732233600000)).toBe("2024-11-22");

    const entries = extractYoudaoEntries({
      data: {
        notes: [
          { id: "dir_1", name: "A股复盘", dir: true, parentId: "0" },
          { id: "note_1", name: "11月复盘.note", dir: false, parentId: "dir_1", modifyTime: 1732233600 },
        ],
      },
    });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ id: "dir_1", name: "A股复盘", isDir: true });
    expect(entries[1]).toMatchObject({ id: "note_1", name: "11月复盘.note", isDir: false, eventDate: "2024-11-22" });

    expect(extractYoudaoNoteContent({ text: "raw", json: { content: "正文内容" } })).toBe("正文内容");
    expect(extractYoudaoNoteContent({ text: "# Markdown 复盘", json: null })).toBe("# Markdown 复盘");
  });

  it("communicates end-to-end with a real local MCP-over-SSE server using x-api-key", async () => {
    let sseRes: http.ServerResponse | null = null;
    const seenKeys: string[] = [];

    const server = http.createServer((req, res) => {
      if (req.headers["x-api-key"]) {
        seenKeys.push(String(req.headers["x-api-key"]));
      }

      if (req.method === "GET" && req.url === "/sse") {
        if (req.headers["x-api-key"] !== "test-youdao-key") {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ desc: "authentication failed", error: 10002 }));
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        sseRes = res;
        res.write("event: endpoint\ndata: /message?sessionId=s1\n\n");
        return;
      }

      if (req.method === "POST" && req.url?.startsWith("/message")) {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          const msg = JSON.parse(body) as { id?: number; method: string; params?: Record<string, unknown> };
          res.writeHead(202, { "Content-Type": "text/plain" });
          res.end("Accepted");

          if (msg.id === undefined || !sseRes) return;

          if (msg.method === "initialize") {
            sseRes.write(
              `event: message\ndata: ${JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                result: { protocolVersion: "2024-11-05", serverInfo: { name: "youdao-mock", version: "1.0" } },
              })}\n\n`,
            );
          } else if (msg.method === "tools/list") {
            sseRes.write(
              `event: message\ndata: ${JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                result: {
                  tools: [
                    { name: "listNotes", inputSchema: { properties: { parentId: { type: "string" } } } },
                    { name: "getNoteTextContent", inputSchema: { properties: { fileId: { type: "string" } } } },
                    { name: "searchNotes", inputSchema: { properties: { keyword: { type: "string" } } } },
                  ],
                },
              })}\n\n`,
            );
          } else if (msg.method === "tools/call") {
            const name = String(msg.params?.name ?? "");
            const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
            const payload =
              name === "listNotes"
                ? [{ id: "n1", name: "2026-11-22 盘后复盘.note", dir: false, parentId: args.parentId }]
                : { content: "今日严格执行分批止盈纪律。" };
            sseRes.write(
              `event: message\ndata: ${JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
              })}\n\n`,
            );
          }
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const { port } = server.address() as AddressInfo;
    const sseUrl = `http://127.0.0.1:${port}/sse`;

    const client = new McpSseClient(sseUrl, { "x-api-key": "test-youdao-key" });
    try {
      const tools = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(["listNotes", "getNoteTextContent", "searchNotes"]);

      const listed = await client.callTool("listNotes", { parentId: "0" });
      const entries = extractYoudaoEntries(listed.json);
      expect(entries).toHaveLength(1);
      expect(cleanYoudaoNoteTitle(entries[0].name)).toBe("2026-11-22 盘后复盘");

      const detail = await client.callTool("getNoteTextContent", { fileId: "n1" });
      expect(extractYoudaoNoteContent(detail)).toBe("今日严格执行分批止盈纪律。");
      expect(seenKeys.every((k) => k === "test-youdao-key")).toBe(true);
    } finally {
      client.close();
      (sseRes as http.ServerResponse | null)?.end();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("Feishu Agent Integration (RFC 8628 One-Click Registration + lark-cli parsers)", () => {
  it("encodes Feishu addons with exact gzip + base64url pipeline", () => {
    const encoded = encodeFeishuAddons(TRADELOOM_FEISHU_ADDONS);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((encoded.length + 3) % 4);
    const decoded = JSON.parse(gunzipSync(Buffer.from(padded, "base64")).toString("utf8"));
    expect(decoded.preset).toBe(false);
    expect(decoded.scopes.tenant).toContain("docx:document:readonly");
    expect(decoded.scopes.user).toContain("offline_access");
  });

  it("runs full RFC 8628 begin -> pending -> completed app registration flow", async () => {
    let pollCount = 0;
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const form = new URLSearchParams(body);
        const action = form.get("action");
        if (action === "begin") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              device_code: "dev_code_123",
              user_code: "ABCD-1234",
              verification_uri_complete: "https://open.feishu.cn/page/launcher?user_code=ABCD-1234",
              expires_in: 600,
              interval: 2,
            }),
          );
          return;
        }
        if (action === "poll") {
          pollCount++;
          if (pollCount === 1) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "authorization_pending" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              client_id: "cli_test_app_001",
              client_secret: "sec_test_secret_999",
              user_info: { open_id: "ou_test", tenant_brand: "feishu" },
            }),
          );
          return;
        }
        res.writeHead(404);
        res.end();
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const { port } = server.address() as AddressInfo;

    try {
      const started = await beginFeishuAppRegistration({
        brand: "feishu",
        baseUrlOverride: `http://127.0.0.1:${port}`,
      });
      expect(started.userCode).toBe("ABCD-1234");
      expect(started.authUrl).toContain("source=node-sdk%2Ftradeloom");
      expect(started.authUrl).toContain("addons=");

      const p1 = await pollFeishuAppRegistration(started.sessionId);
      expect(p1.status).toBe("pending");

      const p2 = await pollFeishuAppRegistration(started.sessionId);
      expect(p2).toMatchObject({
        status: "completed",
        appId: "cli_test_app_001",
        appSecret: "sec_test_secret_999",
        domain: "open.feishu.cn",
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("parses lark-cli JSON envelopes, search hits, highlight tags, and fetched markdown", () => {
    expect(stripHighlightTags("2026年 <h>复盘</h> <hb>总结</hb>")).toBe("2026年 复盘 总结");

    const env = parseLarkCliJson(
      'notice: hour snap\n{"ok":true,"identity":"user","data":{"results":[{"doc_token":"doxcn123","title_highlighted":"<h>复盘</h>笔记","doc_type":"docx","url":"https://abc.feishu.cn/docx/doxcn123","edit_time_iso":"2026-11-22T09:00:00+08:00"},{"doc_token":"shtcn999","title":"财务表","doc_type":"sheet"}]}}',
    );
    expect(env?.ok).toBe(true);
    const hits = extractLarkCliDocsFromSearch(env?.data);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      token: "doxcn123",
      title: "复盘笔记",
      docType: "docx",
      url: "https://abc.feishu.cn/docx/doxcn123",
    });

    const docEnv = parseLarkCliJson(
      JSON.stringify({ ok: true, data: { title: "11月交易纪律", markdown: "# 核心纪律\n\n- 严控回撤" } }),
    );
    expect(extractLarkCliDocBody(docEnv, "")).toEqual({
      title: "11月交易纪律",
      markdown: "# 核心纪律\n\n- 严控回撤",
    });
  });
});

describe("Yuque MCP-parity helpers (host normalization + Notes extraction)", () => {
  it("normalizes default and custom team-space Yuque hosts to /api/v2", () => {
    expect(normalizeYuqueBaseUrl("")).toBe("https://www.yuque.com/api/v2");
    expect(normalizeYuqueBaseUrl("https://my-team.yuque.com/")).toBe("https://my-team.yuque.com/api/v2");
    expect(normalizeYuqueBaseUrl("https://www.yuque.com/api/v2/")).toBe("https://www.yuque.com/api/v2");
  });

  it("extracts clean text from Yuque Notes markdown and HTML/Lake envelopes", () => {
    expect(extractYuqueNoteText({ body_markdown: "# 盘中观察\n- 严守纪律" })).toBe("# 盘中观察\n- 严守纪律");
    expect(extractYuqueNoteText({ body: "<p>今日复盘：<strong>减仓锁盈</strong></p><p>等待回踩</p>" })).toBe(
      "今日复盘：减仓锁盈\n\n等待回踩",
    );
  });
});

describe("Tencent Docs Official Remote MCP connector", () => {
  it("normalizes raw tokens and translates Tencent Docs MCP error codes", () => {
    expect(normalizeTencentDocsToken("  Bearer td_token_123  ")).toBe("td_token_123");
    expect(normalizeTencentDocsToken("td_raw_456")).toBe("td_raw_456");
    expect(formatTencentDocsError(new Error("MCP 错误 (400006): invalid token"))).toContain("400006");
    expect(formatTencentDocsError(new Error("400007 vip required"))).toContain("400007");
  });

  it("uses raw Authorization header, discovers knowledge space & drive folders, and reads doc content via get_content", async () => {
    let seenAuthHeader = "";
    const server = http.createServer(async (req, res) => {
      seenAuthHeader = String(req.headers.authorization ?? "");
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        id?: number;
        method?: string;
        params?: { name?: string; arguments?: Record<string, unknown> };
      };

      const sendRpc = (result: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
      };

      if (body.method === "initialize") {
        return sendRpc({ protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "tencent-docs-mock" } });
      }
      if (body.method === "notifications/initialized") {
        res.writeHead(202);
        return res.end();
      }
      if (body.method === "tools/list") {
        return sendRpc({
          tools: [
            { name: "query_space_node", inputSchema: { properties: { parent_id: {}, num: {} } } },
            { name: "manage.folder_list", inputSchema: { properties: { folder_id: {}, limit: {} } } },
            { name: "get_content", inputSchema: { properties: { file_id: {} } } },
          ],
        });
      }
      if (body.method === "tools/call") {
        const name = body.params?.name;
        const args = body.params?.arguments ?? {};
        if (name === "query_space_node") {
          const payload = args.parent_id
            ? {
                children: [
                  {
                    node_id: "doc_space_1",
                    title: "2026-11-22 半导体持仓复盘",
                    node_type: "wiki_tdoc",
                    doc_type: "smartcanvas",
                    url: "https://docs.qq.com/aio/doc_space_1",
                  },
                ],
                has_next: false,
              }
            : {
                children: [{ node_id: "folder_sp_1", title: "交易复盘库", node_type: "wiki_folder", has_child: true }],
                has_next: false,
              };
          return sendRpc({ content: [{ type: "text", text: JSON.stringify(payload) }] });
        }
        if (name === "manage.folder_list") {
          return sendRpc({
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  files: [
                    {
                      file_id: "doc_drive_1",
                      title: "盘前交易计划",
                      file_type: "doc",
                      doc_type: "word",
                      url: "https://docs.qq.com/doc/doc_drive_1",
                    },
                  ],
                }),
              },
            ],
          });
        }
        if (name === "get_content") {
          const fid = String(args.file_id ?? "");
          return sendRpc({
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  content: fid === "doc_space_1" ? "# 复盘要点\n严格止损，不追高。" : "# 盘前计划\n关注放量回踩。",
                }),
              },
            ],
          });
        }
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address() as AddressInfo;
    try {
      const client = createTencentDocsClient("Bearer td_live_secret", `http://127.0.0.1:${addr.port}/openapi/mcp`);
      const tools = await client.listTools();
      expect(seenAuthHeader).toBe("td_live_secret");
      expect(tools).toHaveLength(3);

      const discovered = await discoverTencentDocsStructure(client, tools);
      expect(discovered.folders.some((f) => f.id === "space:folder_sp_1")).toBe(true);

      const items = await fetchTencentDocsItems(client, tools, { scope: "all", maxItems: 10 });
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({
        fileId: "doc_space_1",
        title: "2026-11-22 半导体持仓复盘",
        eventDate: "2026-11-22",
      });
      expect(items[0].content).toContain("严格止损");
      expect(items[1].fileId).toBe("doc_drive_1");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("Tencent ima Official OpenAPI connector (Notes + Knowledge Base)", () => {
  it("parses both v1.1.2 nested and v1.1.7 flattened folders/notes payloads and HTML text", () => {
    const f1 = parseImaFolders({
      note_book_folders: [{ folder: { basic_info: { folder_id: "nb_1", folder_name: "实盘日记" } } }],
      is_end: true,
    });
    expect(f1.folders).toEqual([{ id: "nb_1", name: "实盘日记" }]);

    const f2 = parseImaFolders({
      note_folder_infos: [{ folder_id: "nb_2", folder_name: "行业研报" }],
      is_end: true,
    });
    expect(f2.folders).toEqual([{ id: "nb_2", name: "行业研报" }]);

    const n1 = parseImaNotes({
      note_book_list: [
        { basic_info: { basic_info: { docid: "d_1", title: "11月复盘", modify_time: "1732233600000" } } },
      ],
      is_end: true,
    });
    expect(n1.notes[0]).toMatchObject({ id: "d_1", title: "11月复盘" });

    const n2 = parseImaNotes({
      notes: [{ note_id: "d_2", title: "新契约笔记" }],
      is_end: true,
    });
    expect(n2.notes[0]).toMatchObject({ id: "d_2", title: "新契约笔记" });

    expect(extractImaTextFromHtml("<h1>研报结论</h1><p>关注&nbsp;AI算力</p><li>严控回撤</li>")).toContain("# 研报结论");
  });

  it("discovers notebooks & knowledge bases and syncs Notes + Wiki items via official OpenAPI headers", async () => {
    let seenHeaders: Record<string, string> = {};
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/signed/article.html") {
        expect(req.headers["x-ima-sign"]).toBe("sig_ok");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end("<html><body><h2>算力产业链纪要</h2><p>2026-11-20 订单高增。</p></body></html>");
      }

      seenHeaders = {
        clientid: String(req.headers["ima-openapi-clientid"] ?? ""),
        apikey: String(req.headers["ima-openapi-apikey"] ?? ""),
      };

      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>;
      const sendOk = (data: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: 0, msg: "", data }));
      };

      if (url.pathname === "/openapi/note/v1/list_note_folder_by_cursor") {
        return sendOk({
          note_book_folders: [{ folder: { basic_info: { folder_id: "f_trade", folder_name: "交易复盘" } } }],
          is_end: true,
        });
      }
      if (url.pathname === "/openapi/note/v1/list_note_by_folder_id") {
        return sendOk({
          note_book_list: [
            {
              basic_info: {
                basic_info: {
                  docid: "note_101",
                  title: "2026-11-21 周五复盘",
                  folder_id: "f_trade",
                  folder_name: "交易复盘",
                },
              },
            },
          ],
          is_end: true,
        });
      }
      if (url.pathname === "/openapi/note/v1/get_doc_content") {
        const nid = String(body.note_id ?? body.doc_id ?? "");
        return sendOk({
          content: nid === "note_101" ? "今日减仓锁盈，回撤控制在 1% 内。" : "关联知识库笔记正文。",
        });
      }
      if (url.pathname === "/openapi/wiki/v1/search_knowledge_base") {
        return sendOk({
          knowledge_base_list: [{ kb_id: "kb_ai", name: "AI 投研库", media_count: 12 }],
        });
      }
      if (url.pathname === "/openapi/wiki/v1/get_addable_knowledge_base_list") {
        return sendOk({ addable_knowledge_base_list: [] });
      }
      if (url.pathname === "/openapi/wiki/v1/get_knowledge_list") {
        if (body.folder_id === "dir_1") {
          return sendOk({
            knowledge_list: [
              { media_id: "m_web_1", title: "算力产业链深度纪要", media_type: 2 },
              { media_id: "m_note_2", title: "核心估值拆解", media_type: 11 },
            ],
            is_end: true,
          });
        }
        return sendOk({
          knowledge_list: [{ media_id: "dir_1", title: "算力专题", media_type: 99 }],
          is_end: true,
        });
      }
      if (url.pathname === "/openapi/wiki/v1/get_media_info") {
        const addr = server.address() as AddressInfo;
        if (body.media_id === "m_web_1") {
          return sendOk({
            url_info: {
              url: `http://127.0.0.1:${addr.port}/signed/article.html`,
              headers: { "X-IMA-Sign": "sig_ok" },
            },
          });
        }
        return sendOk({ notebook_ext_info: { notebook_id: "note_linked_2" } });
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${addr.port}`;
    try {
      const discovered = await discoverImaWorkspace("cid_001", "key_999", baseUrl);
      expect(seenHeaders).toEqual({ clientid: "cid_001", apikey: "key_999" });
      expect(discovered.folders).toEqual([{ id: "f_trade", name: "交易复盘" }]);
      expect(discovered.repos[0]).toMatchObject({ id: "kb_ai", name: "AI 投研库", itemsCount: 12 });

      const result = await fetchImaItems("cid_001", "key_999", {
        baseUrl,
        includeNotes: true,
        includeWiki: true,
        maxItems: 10,
        discoveredFolders: discovered.folders,
        discoveredRepos: discovered.repos,
      });
      expect(result.items).toHaveLength(3);
      expect(result.items.map((i) => i.channel)).toEqual(["note", "wiki", "wiki"]);
      expect(result.items[1].content).toContain("算力产业链纪要");
      expect(result.items[2].content).toContain("关联知识库笔记正文");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("Microsoft OneNote Windows Desktop COM connector", () => {
  it("parses OneNote hierarchy XML with nested SectionGroups while excluding Recycle Bin", () => {
    const xml = `<?xml version="1.0"?>
<one:Notebooks xmlns:one="http://schemas.microsoft.com/office/onenote/2013/onenote">
  <one:Notebook name="投研笔记" nickname="实盘复盘" ID="{NB-1}">
    <one:Section name="每日复盘" ID="{SEC-1}">
      <one:Page ID="{PAGE-1}" name="2026-11-22 半导体跟踪" dateTime="2026-11-22T08:00:00.000Z" lastModifiedTime="2026-11-22T14:30:00.000Z" pageLevel="1" />
    </one:Section>
    <one:SectionGroup name="行业研究" ID="{SG-1}">
      <one:Section name="AI算力" ID="{SEC-2}">
        <one:Page ID="{PAGE-2}" name="光模块订单跟踪" lastModifiedTime="2026-11-21T10:00:00.000Z" />
      </one:Section>
    </one:SectionGroup>
    <one:SectionGroup name="OneNote_RecycleBin" ID="{SG-BIN}" isRecycleBin="true">
      <one:Section name="已删除页面" ID="{SEC-BIN}" isInRecycleBin="true">
        <one:Page ID="{PAGE-DEL}" name="应被忽略的废稿" />
      </one:Section>
    </one:SectionGroup>
  </one:Notebook>
</one:Notebooks>`;

    const parsed = parseOneNoteHierarchyXml(xml);
    expect(parsed.notebooks).toEqual([{ id: "{NB-1}", name: "实盘复盘", nickname: "实盘复盘" }]);
    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[1]).toMatchObject({ id: "{SEC-2}", name: "AI算力", groupPath: "行业研究" });
    expect(parsed.pages).toHaveLength(2);
    expect(parsed.pages.some((p) => p.id === "{PAGE-DEL}")).toBe(false);
    expect(parsed.folders.map((f) => f.id)).toEqual(["nb:{NB-1}", "sec:{SEC-1}", "sec:{SEC-2}"]);
  });

  it("converts OneNote page XML (lists, checkboxes, inline formatting, tables, attachments) to clean Markdown", () => {
    const pageXml = `<?xml version="1.0"?>
<one:Page xmlns:one="http://schemas.microsoft.com/office/onenote/2013/onenote" ID="{PAGE-1}" name="2026-11-22 复盘">
  <one:Title><one:OE><one:T><![CDATA[2026-11-22 复盘]]></one:T></one:OE></one:Title>
  <one:Outline>
    <one:OEChildren>
      <one:OE>
        <one:T><![CDATA[今日核心结论：<span style="font-weight:bold">严守回撤红线</span>，参考 <a href="https://example.com/report">研报链接</a>]]></one:T>
      </one:OE>
      <one:OE>
        <one:List><one:Bullet bullet="2" /></one:List>
        <one:T><![CDATA[仓位控制在 60% 以下]]></one:T>
      </one:OE>
      <one:OE>
        <one:Tag index="0" completed="true" />
        <one:T><![CDATA[完成尾盘核对]]></one:T>
      </one:OE>
      <one:OE>
        <one:Table>
          <one:Row>
            <one:Cell><one:OEChildren><one:OE><one:T><![CDATA[标的]]></one:T></one:OE></one:OEChildren></one:Cell>
            <one:Cell><one:OEChildren><one:OE><one:T><![CDATA[操作]]></one:T></one:OE></one:OEChildren></one:Cell>
          </one:Row>
          <one:Row>
            <one:Cell><one:OEChildren><one:OE><one:T><![CDATA[600519]]></one:T></one:OE></one:OEChildren></one:Cell>
            <one:Cell><one:OEChildren><one:OE><one:T><![CDATA[观望]]></one:T></one:OE></one:OEChildren></one:Cell>
          </one:Row>
        </one:Table>
      </one:OE>
      <one:OE>
        <one:InsertedFile preferredName="交割单.csv" />
      </one:OE>
    </one:OEChildren>
  </one:Outline>
</one:Page>`;

    const md = parseOneNotePageXmlToMarkdown(pageXml);
    expect(md).toContain("**严守回撤红线**");
    expect(md).toContain("[研报链接](https://example.com/report)");
    expect(md).toContain("- 仓位控制在 60% 以下");
    expect(md).toContain("- [x] 完成尾盘核对");
    expect(md).toContain("| 标的 | 操作 |");
    expect(md).toContain("| 600519 | 观望 |");
    expect(md).toContain("[附件: 交割单.csv]");
    expect(md).not.toContain("2026-11-22 复盘");
  });

  it("translates COM installation, privilege mismatch, and non-Windows errors into clear user guidance", () => {
    expect(formatOneNoteLocalError(new Error("NON_WINDOWS_PLATFORM"))).toContain("Windows");
    expect(formatOneNoteLocalError(new Error("Retrieving the COM class factory failed: 80040154"))).toContain("UWP");
    expect(formatOneNoteLocalError(new Error("HRESULT: 0x800706BE RPC failed"))).toContain("权限级别不一致");
    expect(encodePowerShellScript("Write-Host 1")).toBe(Buffer.from("Write-Host 1", "utf16le").toString("base64"));
  });
});