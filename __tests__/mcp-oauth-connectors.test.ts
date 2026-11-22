import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isDidaWelcomeProject, isDidaWelcomeTask } from "../src/lib/cloud-connectors";
import {
  createPkcePair,
  MCP_ENDPOINTS,
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

  it("resolves official MCP endpoints for Dida365 CN, TickTick Global, and Notion", () => {
    expect(resolveMcpUrl("dida365", "cn")).toBe(MCP_ENDPOINTS.dida365_cn);
    expect(resolveMcpUrl("dida365", "global")).toBe(MCP_ENDPOINTS.dida365_global);
    expect(resolveMcpUrl("notion")).toBe(MCP_ENDPOINTS.notion);
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