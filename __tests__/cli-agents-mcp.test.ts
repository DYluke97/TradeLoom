import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCliInvocationPlan,
  callLocalCliAgent,
  CLI_AGENT_SPECS,
  parseCustomCliArgs,
  parseNdjsonStreamOutput,
  unwrapCliTextOutput,
  validateCliModel,
} from "@/lib/cli-agents";
import { buildAgentIntegrationBundle, handleMcpJsonRpc, TRADELOOM_MCP_TOOLS } from "@/lib/mcp-server";
import { callChatCompletion, getMaskedProviderStatus, loadProviderConfig, saveCliAgentProviderConfig } from "@/lib/provider";
import {
  clampOutboundLimit,
  exportSynthesisPromptPack,
  importExternalSynthesisResult,
  MAX_OUTBOUND_CHARS,
  parseSynthesisResponse,
} from "@/lib/synthesis";
import { loadOrBuildVault } from "@/lib/vault";

describe("local CLI agent engine, zero-API synthesis collaboration & MCP server", () => {
  it("exposes comprehensive built-in CLI agent plans without passing huge prompts in argv", () => {
    expect(CLI_AGENT_SPECS.length).toBeGreaterThanOrEqual(16);
    expect(CLI_AGENT_SPECS.some((s) => s.id === "zcode")).toBe(true);
    const zcodePlan = buildCliInvocationPlan({
      agentId: "zcode",
      model: "",
      promptFile: "/tmp/sandbox/prompt.txt",
      outputFile: "/tmp/sandbox/output.txt",
      combinedPrompt: "hello",
    });
    expect(zcodePlan.args).toContain("--mode");
    expect(zcodePlan.args).toContain("plan");
    expect(zcodePlan.needsPromptFile).toBe(true);

    const hugePrompt = "复盘正文测试。".repeat(8000);
    for (const spec of CLI_AGENT_SPECS) {
      if (spec.id === "custom") continue;
      const plan = buildCliInvocationPlan({
        agentId: spec.id,
        model: spec.supportsModelFlag ? "test-model" : "",
        promptFile: "/tmp/prompt.txt",
        outputFile: "/tmp/output.txt",
        combinedPrompt: hugePrompt,
      });
      // Every built-in agent either pipes via stdin OR attaches promptFile, never stuffing hugePrompt into argv
      const totalArgLen = plan.args.reduce((sum, a) => sum + a.length, 0);
      expect(totalArgLen).toBeLessThan(512);
      expect(plan.stdinText !== null || plan.needsPromptFile).toBe(true);
    }

    // Security validations
    expect(parseCustomCliArgs("--print --output-format text").ok).toBe(true);
    expect(parseCustomCliArgs("--print && whoami").ok).toBe(false);
    expect(parseCustomCliArgs("--print | cat").ok).toBe(false);
    expect(validateCliModel("claude-sonnet-4-6").ok).toBe(true);
    expect(validateCliModel("bad;rm -rf /").ok).toBe(false);

    // Verify agy uses stream-json NDJSON stdin (no --print flag conflict, no Windows 32KB argv limit)
    const agyPlan = buildCliInvocationPlan({
      agentId: "agy",
      model: "",
      promptFile: "/tmp/sandbox/prompt.txt",
      outputFile: "/tmp/sandbox/output.txt",
      combinedPrompt: "hello agy",
    });
    expect(agyPlan.args).toContain("--input-format");
    expect(agyPlan.args).toContain("stream-json");
    expect(agyPlan.args).not.toContain("--print");
    expect(JSON.parse(agyPlan.stdinText ?? "{}")).toEqual({
      event: "user",
      message: { role: "user", content: "hello agy" },
    });

    // NDJSON stream parser extracts final response & token usage cleanly
    const ndjsonSample = [
      '{"event":"init","conversation_id":"c1"}',
      '{"event":"step_update","step_update":{"text_delta":"STREAM_"}}',
      '{"event":"result","result":{"status":"SUCCESS","response":"STREAM_OK","usage":{"input_tokens":120,"output_tokens":15}}}',
    ].join("\n");
    const parsedStream = parseNdjsonStreamOutput(ndjsonSample);
    expect(parsedStream.recognized).toBe(true);
    expect(parsedStream.content).toBe("STREAM_OK");
    expect(parsedStream.usage).toEqual({ promptTokens: 120, completionTokens: 15 });
    expect(unwrapCliTextOutput(ndjsonSample)).toBe("STREAM_OK");

    // Large outbound context capacity defaults & clamping
    expect(MAX_OUTBOUND_CHARS).toBe(500_000);
    expect(clampOutboundLimit(undefined)).toBe(500_000);
    expect(clampOutboundLimit(1_200_000)).toBe(1_200_000);
    expect(clampOutboundLimit(9_999_999)).toBe(3_000_000);

    // Output unwrapping
    expect(unwrapCliTextOutput('\x1b[32m{"result":"OK"}\x1b[0m')).toBe("OK");
    expect(unwrapCliTextOutput('{"overview":{"summary":"hi"},"manual":[]}')).toContain('"overview"');
  });

  it("executes local CLI agent (stdin & {prompt_file}) and integrates transparently with provider config", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "tradeloom-cli-test-"));
    const prevWs = process.env.TRADELOOM_WORKSPACE_DIR;
    process.env.TRADELOOM_WORKSPACE_DIR = path.join(tmp, "ws");

    const stdinScript = path.join(tmp, "mock-stdin-agent.mjs");
    const fileScript = path.join(tmp, "mock-file-agent.mjs");
    await writeFile(
      stdinScript,
      `let buf = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", c => buf += c); process.stdin.on("end", () => process.stdout.write(JSON.stringify({ result: "STDIN_OK:" + buf.length })));`,
      "utf8",
    );
    await writeFile(
      fileScript,
      `import { readFileSync } from "node:fs"; const txt = readFileSync(process.argv[2], "utf8"); process.stdout.write("FILE_OK:" + txt.length);`,
      "utf8",
    );

    try {
      const rStdin = await callLocalCliAgent({
        agentId: "custom",
        binPath: process.execPath,
        customArgs: `"${stdinScript}"`,
        system: "sys",
        user: "hello-tradeloom",
      });
      expect(rStdin.ok).toBe(true);
      if (rStdin.ok) expect(rStdin.content).toMatch(/^STDIN_OK:\d+$/);

      const rFile = await callLocalCliAgent({
        agentId: "custom",
        binPath: process.execPath,
        customArgs: `"${fileScript}" "{prompt_file}"`,
        system: "sys",
        user: "hello-file-mode",
      });
      expect(rFile.ok).toBe(true);
      if (rFile.ok) expect(rFile.content).toMatch(/^FILE_OK:\d+$/);

      // Save as active provider & call via unified callChatCompletion()
      const saved = await saveCliAgentProviderConfig({
        agentId: "custom",
        binPath: process.execPath,
        customArgs: `"${stdinScript}"`,
      });
      expect(saved.ok).toBe(true);
      const masked = await getMaskedProviderStatus();
      expect(masked.configured).toBe(true);
      expect(masked.mode).toBe("cli");
      expect(masked.cliAgentId).toBe("custom");

      const loaded = await loadProviderConfig();
      expect(loaded.config?.mode).toBe("cli");
      const completion = await callChatCompletion({
        config: loaded.config!,
        system: "sys",
        user: "unified-call",
      });
      expect(completion.ok).toBe(true);
      if (completion.ok) expect(completion.content).toMatch(/^STDIN_OK:\d+$/);
    } finally {
      if (prevWs === undefined) delete process.env.TRADELOOM_WORKSPACE_DIR;
      else process.env.TRADELOOM_WORKSPACE_DIR = prevWs;
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("supports zero-API prompt pack export, noisy web/agent JSON extraction, and full MCP end-to-end flow", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "tradeloom-mcp-test-"));
    const prevWs = process.env.TRADELOOM_WORKSPACE_DIR;
    process.env.TRADELOOM_WORKSPACE_DIR = tmp;

    try {
      // 1. MCP initialize & tools/list
      const initRes = await handleMcpJsonRpc({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26" },
      });
      expect(initRes?.result).toBeTruthy();

      const listRes = await handleMcpJsonRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
      const tools = (listRes?.result as { tools?: unknown[] })?.tools ?? [];
      expect(tools.length).toBe(TRADELOOM_MCP_TOOLS.length);

      // 2. Import a review via MCP
      const impRes = await handleMcpJsonRpc({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "tradeloom_import_review",
          arguments: {
            title: "2025-05-12 退潮期严控仓位复盘",
            eventDate: "2025-05-12",
            content: "今日高位连板股大面积核按钮，情绪进入退潮期。坚持只看核心龙头承接，绝不半路追高跟风票，总仓位降至两成。",
            tags: ["退潮风控", "情绪周期"],
          },
        },
      });
      expect((impRes?.result as { isError?: boolean })?.isError).not.toBe(true);

      // 3. Prepare synthesis via MCP & zero-API export
      const prepRes = await handleMcpJsonRpc({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "tradeloom_prepare_synthesis",
          arguments: { skillId: "short-term", stageTitle: "2025年5月短线风控手册" },
        },
      });
      const prepText = (prepRes?.result as { content: Array<{ text: string }> }).content[0].text;
      const prepData = JSON.parse(prepText) as { docIds: string[]; promptText: string; evidenceCount: number };
      expect(prepData.docIds.length).toBe(1);
      expect(prepData.evidenceCount).toBeGreaterThanOrEqual(1);
      expect(prepData.promptText).toContain("ev_");

      // Extract a real evidence_id from promptText
      const evMatch = prepData.promptText.match(/ev_[a-f0-9]{12}/);
      expect(evMatch).toBeTruthy();
      const realEvidenceId = evMatch![0];

      // 4. Simulate noisy prose + fenced JSON + fake evidence_id returned by a web AI / external Agent
      const noisyAgentReply = [
        "好的，我已阅读完你的复盘材料，下面按 TradeLoom 契约输出 JSON：",
        '{"note":"decoy metadata ignored"}',
        "```json",
        JSON.stringify({
          overview: { summary: "退潮期严控总仓位，放弃跟风追高。", conditions: ["高位核按钮"], counterexamples: ["半路追跟风"] },
          timeline: [{ period: "2025-05", label: "退潮风控确立", change: "主动降仓至两成", evidence_ids: [realEvidenceId] }],
          manual: [
            {
              id: "M1",
              title: "退潮期降仓不追跟风",
              lifecycle: "validated",
              context: "高位连板大面积核按钮",
              condition: "核心龙头无承接且负反馈扩散",
              action: "总仓位降至 <= 2 成",
              exit: "次日弱势直接清仓",
              counterexample: "半路追高跟风票",
              evidence_ids: [realEvidenceId, "ev_fake_000000"],
            },
          ],
          discipline_audit: [],
        }),
        "```",
        "希望这份手册对你有帮助！",
      ].join("\n");

      // Test resilient parser directly
      const { index } = await loadOrBuildVault();
      const directExport = await exportSynthesisPromptPack({ docs: index.documents, skillId: "short-term" });
      expect(directExport.ok).toBe(true);
      const directImport = await importExternalSynthesisResult({
        docs: index.documents,
        skillId: "short-term",
        rawResponse: noisyAgentReply,
        modelLabel: "ChatGPT Plus 协作",
      });
      expect(directImport.ok).toBe(true);
      if (directImport.ok) {
        expect(directImport.report.model).toBe("ChatGPT Plus 协作");
        expect(directImport.report.manual).toHaveLength(1);
        expect(directImport.report.manual[0].evidence).toHaveLength(1);
        expect(directImport.report.warnings.length).toBeGreaterThan(0);
      }

      // 5. Save manual via MCP & list manuals via MCP
      const saveMcpRes = await handleMcpJsonRpc({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "tradeloom_save_manual",
          arguments: {
            docIds: prepData.docIds,
            skillId: "short-term",
            rawResponse: noisyAgentReply,
            modelLabel: "mcp:claude-desktop",
          },
        },
      });
      const savePayload = JSON.parse((saveMcpRes?.result as { content: Array<{ text: string }> }).content[0].text);
      expect(savePayload.ok).toBe(true);
      expect(savePayload.statistics.rules_count).toBe(1);

      const listManualsRes = await handleMcpJsonRpc({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "tradeloom_list_manuals", arguments: {} },
      });
      const listManualsPayload = JSON.parse((listManualsRes?.result as { content: Array<{ text: string }> }).content[0].text);
      expect(listManualsPayload.count).toBeGreaterThanOrEqual(2);

      // 6. Verify Agent Integration Bundle
      const bundle = buildAgentIntegrationBundle("http://127.0.0.1:3200");
      expect(bundle.mcpHttpUrl).toBe("http://127.0.0.1:3200/api/mcp");
      expect(bundle.stdioConfigJson).toContain("tradeloom-mcp-server.mjs");
      expect(bundle.skillMarkdown).toContain("tradeloom_prepare_synthesis");

      // Also confirm parseSynthesisResponse handles ANSI + fenced JSON cleanly
      const ansiRes = parseSynthesisResponse(`\x1b[36m${noisyAgentReply}\x1b[0m`, [
        {
          evidence_id: realEvidenceId,
          doc_id: "d1",
          title: "test",
          card: "20-卡片/test.md",
          event_date: "2025-05-12",
          page: null,
          quote: "退潮期降仓",
          quote_sha256: "abc",
        },
      ]);
      expect(ansiRes.ok).toBe(true);
    } finally {
      if (prevWs === undefined) delete process.env.TRADELOOM_WORKSPACE_DIR;
      else process.env.TRADELOOM_WORKSPACE_DIR = prevWs;
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
