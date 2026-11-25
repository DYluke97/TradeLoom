"use client";

import {
  Bot,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  Loader2,
  PlugZap,
  Terminal,
  Wrench,
} from "lucide-react";
import { useEffect, useState } from "react";

type AgentIntegrationBundle = {
  baseUrl: string;
  mcpHttpUrl: string;
  mcpScriptPath: string;
  skillFilePath: string;
  workspaceRoot: string;
  protocolVersion: string;
  serverInfo: { name: string; version: string };
  stdioConfigJson: string;
  httpConfigJson: string;
  cliInstallCommands: Array<{ id: string; label: string; command: string }>;
  tools: Array<{ name: string; description: string }>;
  skillMarkdown: string;
};

export default function AgentIntegrationPanel() {
  const [bundle, setBundle] = useState<AgentIntegrationBundle | null>(null);
  const [configTab, setConfigTab] = useState<"stdio" | "http" | "skill">("stdio");
  const [copiedKey, setCopiedKey] = useState<string>("");
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState("");
  const [testErr, setTestErr] = useState("");

  useEffect(() => {
    fetch("/api/agent-integration", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setBundle(d);
      })
      .catch(() => {});
  }, []);

  async function copyText(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((prev) => (prev === key ? "" : prev)), 2000);
    } catch {
      /* fallback ignored */
    }
  }

  function downloadSkillMd() {
    if (!bundle) return;
    const blob = new Blob([bundle.skillMarkdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "SKILL.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleTestMcp() {
    setTesting(true);
    setTestMsg("");
    setTestErr("");
    try {
      const initRes = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "tradeloom-ui", version: "1.0.0" } },
        }),
      }).then((r) => r.json());

      const listRes = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      }).then((r) => r.json());

      if (initRes?.result?.serverInfo && Array.isArray(listRes?.result?.tools)) {
        setTestMsg(
          `本地 MCP 服务已就绪：${initRes.result.serverInfo.name} v${initRes.result.serverInfo.version}（协议 ${initRes.result.protocolVersion}，已暴露 ${listRes.result.tools.length} 个工具）`,
        );
      } else {
        setTestErr(initRes?.error?.message || listRes?.error?.message || "MCP 握手校验未通过");
      }
    } catch (err) {
      setTestErr(err instanceof Error ? err.message : "MCP 连通测试失败");
    } finally {
      setTesting(false);
    }
  }

  if (!bundle) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-xs text-[var(--ink-muted)]">
        <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" />
        正在读取本机 MCP 与 Agent 接入配置...
      </div>
    );
  }

  const activeSnippet =
    configTab === "stdio"
      ? bundle.stdioConfigJson
      : configTab === "http"
        ? bundle.httpConfigJson
        : bundle.skillMarkdown;

  return (
    <div className="space-y-5">
      {/* Hero Banner */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl space-y-1.5">
            <div className="flex items-center gap-2">
              <Bot className="h-[18px] w-[18px] text-[var(--cyan)]" />
              <h2 className="text-sm font-semibold text-[var(--ink-strong)]">
                外部 AI Agent 双向接入（Local MCP Server + 标准 SKILL.md）
              </h2>
              <span className="rounded-full bg-[var(--emerald-soft)] px-2 py-0.5 font-mono text-[10px] font-medium text-[var(--emerald)]">
                零额外 API Key
              </span>
            </div>
            <p className="text-xs leading-6 text-[var(--ink-muted)]">
              把 TradeLoom 接入你日常使用的 <strong>Claude Desktop、Cursor、Antigravity、OpenClaw、Claude Code、Codex、OpenCode、Windsurf</strong> 等外部 Agent。
              以后直接在你的 Agent 对话框里就能搜索复盘星图、核对实盘盈亏、导入新复盘，并用外部 Agent 自身大模型完成提炼后交由 TradeLoom 做逐字 <code className="font-mono text-[11px]">evidence_id</code> 防幻觉校验落库。
            </p>
          </div>
          <button
            type="button"
            onClick={handleTestMcp}
            disabled={testing}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--cyan)]/50 bg-[var(--cyan-soft)] px-3.5 py-2 text-xs font-semibold text-[var(--cyan)] transition hover:bg-[var(--cyan)]/20 disabled:opacity-50"
          >
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
            检测本地 MCP 端点
          </button>
        </div>

        {testMsg && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--emerald)]/35 bg-[var(--emerald-soft)] px-3 py-2 text-xs text-[var(--emerald)]">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{testMsg}</span>
          </div>
        )}
        {testErr && (
          <div className="mt-3 rounded-lg border border-[var(--rose)]/35 bg-[var(--rose-soft)] px-3 py-2 text-xs text-[var(--rose)]">
            {testErr}
          </div>
        )}

        <div className="mt-4 grid gap-2.5 text-[11px] sm:grid-cols-2">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] px-3 py-2">
            <div className="text-[var(--ink-dim)]">本地 Streamable HTTP MCP 端点</div>
            <div className="mt-0.5 truncate font-mono text-[var(--ink)]">{bundle.mcpHttpUrl}</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] px-3 py-2">
            <div className="text-[var(--ink-dim)]">本地 Stdio MCP 桥接脚本</div>
            <div className="mt-0.5 truncate font-mono text-[var(--ink)]" title={bundle.mcpScriptPath}>
              {bundle.mcpScriptPath}
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        {/* Left: Copyable Configs (Stdio / HTTP / SKILL.md) */}
        <section className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setConfigTab("stdio")}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                  configTab === "stdio"
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-[var(--border)] bg-[var(--bg-deep)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
                }`}
              >
                MCP Stdio JSON（通用推荐）
              </button>
              <button
                type="button"
                onClick={() => setConfigTab("http")}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                  configTab === "http"
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-[var(--border)] bg-[var(--bg-deep)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
                }`}
              >
                Streamable HTTP
              </button>
              <button
                type="button"
                onClick={() => setConfigTab("skill")}
                className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                  configTab === "skill"
                    ? "border-[var(--cyan)] bg-[var(--cyan-soft)] text-[var(--cyan)]"
                    : "border-[var(--border)] bg-[var(--bg-deep)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
                }`}
              >
                <FileCode2 className="h-3.5 w-3.5" />
                SKILL.md
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              {configTab === "skill" && (
                <button
                  type="button"
                  onClick={downloadSkillMd}
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-deep)] px-2.5 py-1 text-[11px] font-medium text-[var(--ink)] transition hover:border-[var(--cyan)]"
                >
                  <Download className="h-3.5 w-3.5" />
                  下载 SKILL.md
                </button>
              )}
              <button
                type="button"
                onClick={() => copyText(`snippet-${configTab}`, activeSnippet)}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--accent)]/50 bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent)] transition hover:brightness-110"
              >
                {copiedKey === `snippet-${configTab}` ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedKey === `snippet-${configTab}` ? "已复制" : "一键复制"}
              </button>
            </div>
          </div>

          <p className="text-[11px] leading-5 text-[var(--ink-muted)]">
            {configTab === "stdio"
              ? "粘贴到 Claude Desktop（claude_desktop_config.json）、Cursor（.cursor/mcp.json）、Windsurf、OpenClaw 或 Antigravity 的 MCP 配置中即可即插即用。"
              : configTab === "http"
                ? "适用于原生支持 Streamable HTTP MCP 协议的客户端（要求本地 TradeLoom 服务保持启动）。"
                : `标准 Agent Skill 文件（仓库路径：${bundle.skillFilePath}），放入你的 Agent skills 目录即可让 Agent 自动学会 TradeLoom 的防幻觉提炼闭环。`}
          </p>

          <pre className="max-h-[300px] overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] p-3.5 font-mono text-[11px] leading-5 text-[var(--ink)]">
            {activeSnippet}
          </pre>

          {/* One-liner CLI install commands */}
          <div className="space-y-2 border-t border-[var(--border)] pt-3.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink-strong)]">
              <Terminal className="h-3.5 w-3.5 text-[var(--accent)]" />
              主流 CLI Agent 一行命令注册 MCP
            </div>
            <div className="space-y-1.5">
              {bundle.cliInstallCommands.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-medium text-[var(--ink-dim)]">{item.label}</div>
                    <div className="truncate font-mono text-[11px] text-[var(--ink)]" title={item.command}>
                      {item.command}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyText(`cmd-${item.id}`, item.command)}
                    className="inline-flex shrink-0 items-center gap-1 rounded border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1 text-[10px] font-medium text-[var(--ink-muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  >
                    {copiedKey === `cmd-${item.id}` ? <Check className="h-3 w-3 text-[var(--emerald)]" /> : <Copy className="h-3 w-3" />}
                    {copiedKey === `cmd-${item.id}` ? "已复制" : "复制"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Right: Exposed MCP Tools Catalog */}
        <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-[var(--accent)]" />
              <h3 className="text-sm font-semibold text-[var(--ink-strong)]">
                已开放的 MCP 工具清单（{bundle.tools.length}）
              </h3>
            </div>
            <span className="inline-flex items-center gap-1 font-mono text-[10px] text-[var(--ink-dim)]">
              <ExternalLink className="h-3 w-3" />
              仅本机 127.0.0.1 可达
            </span>
          </div>

          <div className="space-y-2">
            {bundle.tools.map((tool) => (
              <div
                key={tool.name}
                className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] px-3 py-2.5"
              >
                <div className="font-mono text-[11px] font-semibold text-[var(--cyan)]">{tool.name}</div>
                <p className="mt-0.5 text-[11px] leading-5 text-[var(--ink-muted)]">{tool.description}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
