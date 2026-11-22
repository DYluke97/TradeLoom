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