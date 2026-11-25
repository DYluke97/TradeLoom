"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cloud,
  Copy,
  Hash,
  KeyRound,
  Loader2,
  PlugZap,
  RefreshCw,
  Save,
  Sparkles,
  Terminal,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import AgentIntegrationPanel from "@/components/AgentIntegrationPanel";
import CloudConnectorsPanel from "@/components/CloudConnectorsPanel";
import ConceptTaxonomyEditor from "@/components/ConceptTaxonomyEditor";
import MarkdownView from "@/components/MarkdownView";
import SkillStudioPanel from "@/components/SkillStudioPanel";
import type { CliAgentId, DetectedCliAgent } from "@/lib/cli-agents";
import { parseMarkdown } from "@/lib/markdown";
import { endGuidedTour, useGuidedTour } from "@/lib/onboarding-tour";
import type { MaskedProviderStatus } from "@/lib/provider";
import type { SkillSpec } from "@/lib/skills";

type Preset = {
  id: string;
  label: string;
  group?: "china-cloud" | "global" | "local";
  url: string;
  model: string;
  note?: string;
};
type SettingsTab = "llm" | "agent" | "skills" | "concepts" | "connectors";
type EnginePanelMode = "cli" | "manual" | "api";

const PRESET_GROUPS: Array<{ key: "china-cloud" | "global" | "local"; label: string }> = [
  { key: "china-cloud", label: "国内主流云厂商 & ZCode / 国产模型" },
  { key: "global", label: "国际官方 & 聚合通道" },
  { key: "local", label: "本机免费模型（免 API Key）" },
];

function resolveTab(param: string | null): SettingsTab {
  if (param === "agent") return "agent";
  if (param === "skills") return "skills";
  if (param === "concepts") return "concepts";
  if (param === "connectors") return "connectors";
  return "llm";
}

const CATEGORY_LABELS: Record<string, string> = {
  flagship: "主流订阅 CLI",
  china: "国产 / 免费额度 CLI",
  "open-ecosystem": "开源 Agent 生态",
  custom: "自定义命令",
};

export default function SettingsWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tourActive = useGuidedTour(searchParams.get("tour") === "1");
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => resolveTab(searchParams.get("tab")));
  const [engineMode, setEngineMode] = useState<EnginePanelMode>("cli");

  const [status, setStatus] = useState<MaskedProviderStatus | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [cliAgents, setCliAgents] = useState<DetectedCliAgent[]>([]);
  const [skills, setSkills] = useState<SkillSpec[]>([]);
  const [activeSkillId, setActiveSkillId] = useState("short-term");

  // API form state
  const [url, setUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");

  // CLI Agent form state
  const [selectedAgentId, setSelectedAgentId] = useState<CliAgentId>("claude");
  const [cliModel, setCliModel] = useState("");
  const [cliBinPath, setCliBinPath] = useState("");
  const [cliCustomArgs, setCliCustomArgs] = useState("");
  const [showAllAgents, setShowAllAgents] = useState(false);
  const [showAdvancedCli, setShowAdvancedCli] = useState(false);
  const [scanningCli, setScanningCli] = useState(false);

  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "agent" || t === "skills" || t === "concepts" || t === "connectors" || t === "llm") {
      setActiveTab(t);
    }
  }, [searchParams]);

  const loadProviderAndAgents = useCallback(async (isRefresh = false) => {
    if (isRefresh) setScanningCli(true);
    try {
      const p = await fetch("/api/provider", { cache: "no-store" }).then((r) => r.json());
      if (p.ok) {
        const st = p.status as MaskedProviderStatus;
        const agents = (p.cliAgents ?? []) as DetectedCliAgent[];
        setStatus(st);
        setPresets(p.presets || []);
        setCliAgents(agents);

        if (!isRefresh) {
          setUrl(st.mode === "api" && st.url ? st.url : p.presets?.[0]?.url || "");
          setModel(st.mode === "api" && st.model ? st.model : p.presets?.[0]?.model || "");

          const firstInstalled = agents.find((a) => a.installed);
          if (st.mode === "cli" && st.cliAgentId) {
            setEngineMode("cli");
            setSelectedAgentId(st.cliAgentId);
            setCliModel(st.model || "");
            setCliBinPath(st.cliBinPath || "");
            setCliCustomArgs(st.cliCustomArgs || "");
            if (st.cliBinPath) setShowAdvancedCli(true);
          } else if (st.mode === "api" && st.configured) {
            setEngineMode("api");
            if (firstInstalled) setSelectedAgentId(firstInstalled.id);
          } else if (firstInstalled) {
            setEngineMode("cli");
            setSelectedAgentId(firstInstalled.id);
          } else {
            setEngineMode("manual");
            setShowAllAgents(true);
          }
        }
      }
    } finally {
      if (isRefresh) setScanningCli(false);
    }
  }, []);

  useEffect(() => {
    loadProviderAndAgents(false);
    fetch("/api/skills", { cache: "no-store" })
      .then((r) => r.json())
      .then((s) => {
        if (s.ok) setSkills(s.skills || []);
      })
      .catch(() => {});
  }, [loadProviderAndAgents]);

  const installedAgents = useMemo(() => cliAgents.filter((a) => a.installed), [cliAgents]);
  const selectedAgent = useMemo(
    () => cliAgents.find((a) => a.id === selectedAgentId) ?? cliAgents[0] ?? null,
    [cliAgents, selectedAgentId],
  );

  function selectCliAgent(agent: DetectedCliAgent) {
    setSelectedAgentId(agent.id);
    setMsg("");
    setErr("");
    if (status?.mode === "cli" && status.cliAgentId === agent.id) {
      setCliModel(status.model || "");
      setCliBinPath(status.cliBinPath || "");
      setCliCustomArgs(status.cliCustomArgs || "");
    } else {
      setCliModel("");
      setCliBinPath("");
      if (agent.id !== "custom") setCliCustomArgs("");
    }
    if (agent.id === "custom" || !agent.installed) {
      setShowAdvancedCli(true);
    }
  }

  async function handleSaveCli() {
    setMsg("");
    setErr("");
    setBusy(true);
    try {
      const res = await fetch("/api/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save-cli",
          agentId: selectedAgentId,
          model: cliModel,
          binPath: cliBinPath,
          customArgs: cliCustomArgs,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatus(data.status);
        if (Array.isArray(data.cliAgents)) setCliAgents(data.cliAgents);
        setMsg(`已切换为本机 Agent 直连：${data.status.label}（免 API Key，复用本机订阅/授权）。`);
        window.dispatchEvent(new CustomEvent("tradeloom:vault-changed"));
      } else {
        setErr(data.error || "保存本机 Agent 失败");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleTestCli() {
    setMsg("");
    setErr("");
    setBusy(true);
    try {
      const res = await fetch("/api/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test-cli",
          agentId: selectedAgentId,
          model: cliModel,
          binPath: cliBinPath,
          customArgs: cliCustomArgs,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setMsg(`本机 Agent 连通成功（${data.model}）！返回：${data.reply}`);
      } else {
        setErr(data.error || "本机 Agent 测试失败");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveApi(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    setErr("");
    setBusy(true);
    try {
      const res = await fetch("/api/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          url,
          model,
          apiKey,
          keepExistingKey: !apiKey && Boolean(status?.hasApiKey),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatus(data.status);
        if (data.status?.url) setUrl(data.status.url);
        setApiKey("");
        setMsg("API 配置已安全保存至本地 workspace/config.json（已被 .gitignore 隔离）。");
        window.dispatchEvent(new CustomEvent("tradeloom:vault-changed"));
      } else {
        setErr(data.error || "保存失败");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleTestActive() {
    setMsg("");
    setErr("");
    setBusy(true);
    try {
      const res = await fetch("/api/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      const data = await res.json();
      if (data.ok) {
        setMsg(`连通成功！引擎 ${data.model} 返回：${data.reply}`);
      } else {
        setErr(data.error || "连通测试失败");
      }
    } finally {
      setBusy(false);
    }
  }

  const activeSkill = skills.find((s) => s.id === activeSkillId) ?? skills[1] ?? skills[0];
  const customSkillCount = skills.filter((s) => !s.builtin).length;

  return (
    <div className="space-y-5">
      {/* Focused Tour Banner OR Full Settings Sub-Tabs */}
      {tourActive ? (
        <div className="mx-auto max-w-3xl rounded-xl border border-[var(--accent)]/35 bg-[var(--accent-soft)]/45 px-4 py-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-semibold text-[var(--ink-strong)]">
                最后一步准备：选一种 AI 方式凝练你的交易手册（支持免 API Key）
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--ink-muted)]">
                可直连本机已装的 CLI Agent、用网页版/订阅版 AI 零配置协作，或填写 OpenAI 兼容 API。
              </div>
            </div>
            {status?.configured ? (
              <button
                type="button"
                onClick={() => router.push("/synthesize?tour=1")}
                className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent-strong)] px-3.5 py-1.5 font-semibold text-white transition hover:bg-[var(--accent)]"
              >
                去凝练交易手册
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => router.push("/synthesize?tour=1&mode=manual")}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--cyan)]/50 bg-[var(--surface)] px-3 py-1.5 font-semibold text-[var(--cyan)] transition hover:bg-[var(--cyan-soft)]"
              >
                免 API 网页协作直达
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-3">
          <button
            type="button"
            onClick={() => setActiveTab("llm")}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-xs font-medium transition ${
              activeTab === "llm"
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            <Terminal className="h-[15px] w-[15px]" />
            AI 引擎配置（本机 Agent / API）
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("agent")}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-xs font-medium transition ${
              activeTab === "agent"
                ? "border-[var(--cyan)] bg-[var(--cyan-soft)] text-[var(--cyan)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink-muted)] hover:text-[var(--cyan)]"
            }`}
          >
            <Bot className="h-[15px] w-[15px]" />
            外部 Agent 接入（MCP / Skill）
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("skills")}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-xs font-medium transition ${
              activeTab === "skills"
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            <Sparkles className="h-[15px] w-[15px]" />
            AI 提炼规则工坊
            {customSkillCount > 0 && (
              <span className="rounded-full bg-[var(--cyan-soft)] px-1.5 py-0.2 font-mono text-[10px] text-[var(--cyan)]">
                +{customSkillCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("concepts")}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-xs font-medium transition ${
              activeTab === "concepts"
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            <Hash className="h-[15px] w-[15px]" />
            当前库关键词词典
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("connectors")}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-xs font-medium transition ${
              activeTab === "connectors"
                ? "border-[var(--cyan)] bg-[var(--cyan-soft)] text-[var(--cyan)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink-muted)] hover:text-[var(--cyan)]"
            }`}
          >
            <Cloud className="h-[15px] w-[15px]" />
            云端同步中心
          </button>
        </div>
      )}

      {!tourActive && activeTab === "agent" ? (
        <AgentIntegrationPanel />
      ) : !tourActive && activeTab === "skills" ? (
        <SkillStudioPanel initialSkills={skills} onSkillsChange={setSkills} />
      ) : !tourActive && activeTab === "concepts" ? (
        <ConceptTaxonomyEditor />
      ) : !tourActive && activeTab === "connectors" ? (
        <CloudConnectorsPanel />
      ) : (
        <div className={tourActive ? "mx-auto max-w-3xl" : "grid gap-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]"}>
          {/* Left: Unified 3-Way AI Engine Configuration */}
          <section className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Bot className="h-[17px] w-[17px] text-[var(--accent)]" />
                <h2 className="text-sm font-semibold text-[var(--ink-strong)]">选择方法论凝练 AI 引擎</h2>
              </div>
              {status?.configured && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--emerald-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--emerald)]">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  当前启用：{status.mode === "cli" ? `本机 ${status.label}` : status.model}
                </span>
              )}
            </div>

            {/* 3-Way Mode Selector */}
            <div className="grid gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => {
                  setEngineMode("cli");
                  setMsg("");
                  setErr("");
                }}
                className={`rounded-xl border p-3 text-left transition ${
                  engineMode === "cli"
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]/70"
                    : "border-[var(--border)] bg-[var(--bg-deep)] hover:border-[var(--border-strong)]"
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <Terminal className="h-4 w-4 text-[var(--accent)]" />
                  <span
                    className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] ${
                      installedAgents.length > 0
                        ? "bg-[var(--emerald-soft)] text-[var(--emerald)]"
                        : "bg-[var(--surface-2)] text-[var(--ink-dim)]"
                    }`}
                  >
                    {installedAgents.length > 0 ? `已检测到 ${installedAgents.length} 款` : "支持 15+ 款"}
                  </span>
                </div>
                <div className="mt-2 text-xs font-semibold text-[var(--ink-strong)]">本机 CLI Agent 直连</div>
                <div className="mt-0.5 text-[11px] leading-4 text-[var(--ink-muted)]">
                  免 API Key，直连本机 Claude / Codex / Gemini / ZCode / agy / OpenCode 等
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setEngineMode("manual");
                  setMsg("");
                  setErr("");
                }}
                className={`rounded-xl border p-3 text-left transition ${
                  engineMode === "manual"
                    ? "border-[var(--cyan)] bg-[var(--cyan-soft)]/70"
                    : "border-[var(--border)] bg-[var(--bg-deep)] hover:border-[var(--border-strong)]"
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <Copy className="h-4 w-4 text-[var(--cyan)]" />
                  <span className="rounded-full bg-[var(--cyan-soft)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--cyan)]">
                    零配置
                  </span>
                </div>
                <div className="mt-2 text-xs font-semibold text-[var(--ink-strong)]">网页 AI / 订阅协作</div>
                <div className="mt-0.5 text-[11px] leading-4 text-[var(--ink-muted)]">
                  复制证据包给 ChatGPT / DeepSeek / Kimi / 豆包，贴回自动校验生成手册
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setEngineMode("api");
                  setMsg("");
                  setErr("");
                }}
                className={`rounded-xl border p-3 text-left transition ${
                  engineMode === "api"
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]/70"
                    : "border-[var(--border)] bg-[var(--bg-deep)] hover:border-[var(--border-strong)]"
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <KeyRound className="h-4 w-4 text-[var(--amber)]" />
                  <span className="rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-dim)]">
                    含本机 Ollama
                  </span>
                </div>
                <div className="mt-2 text-xs font-semibold text-[var(--ink-strong)]">API Key / 云厂商 / 本机</div>
                <div className="mt-0.5 text-[11px] leading-4 text-[var(--ink-muted)]">
                  含 ZCode、火山引擎、阿里云、腾讯云、华为云、百度千帆、DeepSeek 与 Ollama
                </div>
              </button>
            </div>

            {/* MODE 1: Local CLI Agent Direct Connection */}
            {engineMode === "cli" && (
              <div className="space-y-4 pt-1">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-[var(--ink-muted)]">
                    {installedAgents.length > 0
                      ? `已自动扫描到本机 ${installedAgents.length} 款可直接免 Key 调用的命令行 Agent：`
                      : "暂未在默认 PATH 中扫到已安装 CLI，可展开完整列表或手动指定路径："}
                  </span>
                  <button
                    type="button"
                    onClick={() => loadProviderAndAgents(true)}
                    disabled={scanningCli}
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-deep)] px-2.5 py-1 text-[11px] text-[var(--ink-muted)] transition hover:border-[var(--accent)] hover:text-[var(--ink)]"
                  >
                    <RefreshCw className={`h-3 w-3 ${scanningCli ? "animate-spin" : ""}`} />
                    重新扫描
                  </button>
                </div>

                {/* Detected Agents Grid */}
                {installedAgents.length > 0 && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {installedAgents.map((agent) => {
                      const active = selectedAgentId === agent.id;
                      const isSavedCurrent = status?.mode === "cli" && status.cliAgentId === agent.id;
                      return (
                        <button
                          key={agent.id}
                          type="button"
                          onClick={() => selectCliAgent(agent)}
                          className={`rounded-xl border p-3 text-left transition ${
                            active
                              ? "border-[var(--accent)] bg-[var(--accent-soft)]/55"
                              : "border-[var(--emerald)]/35 bg-[var(--bg-deep)] hover:border-[var(--accent)]/60"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-[var(--ink-strong)]">{agent.name}</span>
                            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--emerald-soft)] px-2 py-0.5 font-mono text-[10px] text-[var(--emerald)]">
                              <span className="h-1.5 w-1.5 rounded-full bg-[var(--emerald)]" />
                              {isSavedCurrent ? "当前启用" : "已就绪"}
                            </span>
                          </div>
                          <div className="mt-1 text-[11px] text-[var(--ink-muted)]">{agent.badge}</div>
                          <div className="mt-1 truncate font-mono text-[10px] text-[var(--ink-dim)]" title={agent.resolvedPath ?? ""}>
                            {agent.resolvedPath}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Expandable Full 15+ CLI Agents Catalog */}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-deep)]/60">
                  <button
                    type="button"
                    onClick={() => setShowAllAgents((v) => !v)}
                    className="flex w-full items-center justify-between px-3.5 py-2.5 text-xs font-medium text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
                  >
                    <span>
                      查看全部支持的 {Math.max(16, cliAgents.filter((a) => a.id !== "custom").length)} 款本机 CLI Agent + 自定义命令
                    </span>
                    {showAllAgents ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  {showAllAgents && (
                    <div className="space-y-3 border-t border-[var(--border)] p-3">
                      {(["flagship", "china", "open-ecosystem", "custom"] as const).map((cat) => {
                        const group = cliAgents.filter((a) => a.category === cat);
                        if (group.length === 0) return null;
                        return (
                          <div key={cat} className="space-y-1.5">
                            <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-dim)]">
                              {CATEGORY_LABELS[cat]}
                            </div>
                            <div className="grid gap-1.5 sm:grid-cols-2">
                              {group.map((agent) => {
                                const active = selectedAgentId === agent.id;
                                return (
                                  <button
                                    key={agent.id}
                                    type="button"
                                    onClick={() => selectCliAgent(agent)}
                                    className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition ${
                                      active
                                        ? "border-[var(--accent)] bg-[var(--accent-soft)]/65 text-[var(--ink-strong)]"
                                        : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink-muted)] hover:border-[var(--border-strong)] hover:text-[var(--ink)]"
                                    }`}
                                  >
                                    <div className="min-w-0">
                                      <div className="truncate font-medium text-[var(--ink-strong)]">{agent.name}</div>
                                      <div className="truncate text-[10px] text-[var(--ink-dim)]">{agent.badge}</div>
                                    </div>
                                    <span
                                      className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                                        agent.installed
                                          ? "bg-[var(--emerald-soft)] text-[var(--emerald)]"
                                          : agent.id === "custom"
                                            ? "bg-[var(--cyan-soft)] text-[var(--cyan)]"
                                            : "bg-[var(--bg-deep)] text-[var(--ink-dim)]"
                                      }`}
                                    >
                                      {agent.installed ? "已安装" : agent.id === "custom" ? "自定义" : "未检测到"}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Selected CLI Agent Details & Options */}
                {selectedAgent && (
                  <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--bg-deep)] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold text-[var(--ink-strong)]">
                          {selectedAgent.name} · <span className="font-normal text-[var(--ink-muted)]">{selectedAgent.vendor}</span>
                        </div>
                        <p className="mt-0.5 text-[11px] leading-5 text-[var(--ink-muted)]">{selectedAgent.description}</p>
                      </div>
                      {!selectedAgent.installed && selectedAgent.id !== "custom" && (
                        <span className="rounded bg-[var(--amber-soft)] px-2 py-0.5 font-mono text-[10px] text-[var(--amber)]">
                          未在 PATH 检测到
                        </span>
                      )}
                    </div>

                    {!selectedAgent.installed && selectedAgent.id !== "custom" && (
                      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-[11px] text-[var(--ink-muted)]">
                        安装/登录参考：{selectedAgent.installHint}
                      </div>
                    )}

                    {selectedAgent.supportsModelFlag && (
                      <label className="block text-xs text-[var(--ink-muted)]">
                        指定模型（可选，留空自动使用该 Agent 默认模型）
                        <input
                          value={cliModel}
                          onChange={(e) => setCliModel(e.target.value)}
                          placeholder={selectedAgent.defaultModelHint}
                          className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                        />
                      </label>
                    )}

                    {selectedAgent.id === "custom" ? (
                      <div className="space-y-2.5">
                        <label className="block text-xs text-[var(--ink-muted)]">
                          可执行命令或绝对路径（必填）
                          <input
                            value={cliBinPath}
                            onChange={(e) => setCliBinPath(e.target.value)}
                            placeholder="例如：my-agent 或 C:\tools\agent.exe"
                            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                          />
                        </label>
                        <label className="block text-xs text-[var(--ink-muted)]">
                          参数模板（可选；含 <code className="font-mono">{`{prompt_file}`}</code> 则传临时文件路径，否则自动通过 stdin 传入完整提示词）
                          <input
                            value={cliCustomArgs}
                            onChange={(e) => setCliCustomArgs(e.target.value)}
                            placeholder="例如：run --file {prompt_file} 或 -p --output-format text"
                            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                          />
                        </label>
                      </div>
                    ) : (
                      <div>
                        <button
                          type="button"
                          onClick={() => setShowAdvancedCli((v) => !v)}
                          className="text-[11px] text-[var(--ink-dim)] hover:text-[var(--ink)]"
                        >
                          {showAdvancedCli ? "收起手动路径覆盖 ▲" : "高级：手动指定 CLI 可执行文件路径 ▼"}
                        </button>
                        {showAdvancedCli && (
                          <input
                            value={cliBinPath}
                            onChange={(e) => setCliBinPath(e.target.value)}
                            placeholder={selectedAgent.resolvedPath || "留空自动探测，或填写绝对路径如 C:\\path\\to\\cli.exe"}
                            className="mt-1.5 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                          />
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={handleSaveCli}
                        disabled={busy || (!selectedAgent.installed && !cliBinPath.trim())}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-strong)] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[var(--accent)] disabled:opacity-45"
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        启用 {selectedAgent.name}
                      </button>
                      <button
                        type="button"
                        onClick={handleTestCli}
                        disabled={busy || (!selectedAgent.installed && !cliBinPath.trim())}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 py-2 text-xs font-medium text-[var(--ink)] transition hover:border-[var(--accent)]/60 disabled:opacity-45"
                      >
                        <PlugZap className="h-3.5 w-3.5" />
                        测试 Agent 连通
                      </button>
                      {tourActive && status?.configured && (
                        <button
                          type="button"
                          onClick={() => router.push("/synthesize?tour=1")}
                          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[var(--emerald)] px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110"
                        >
                          进入方法论凝练
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* MODE 2: Zero-API Web AI / External Agent Collaboration */}
            {engineMode === "manual" && (
              <div className="space-y-4 rounded-xl border border-[var(--cyan)]/35 bg-[var(--bg-deep)] p-4">
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-[var(--ink-strong)]">
                    无需任何 API Key，直接复用你已有的网页版 AI / 会员订阅
                  </div>
                  <p className="text-xs leading-6 text-[var(--ink-muted)]">
                    无论你用的是 <strong>ChatGPT Plus、Claude Pro、Gemini、DeepSeek 网页版、Kimi、豆包还是元宝</strong>，TradeLoom 都会在本地把复盘切片、脱敏实盘锚点和防幻觉契约打包好；你复制发给 AI 后把回复贴回，同样完成逐字原文回链校验并生成正式交易手册。
                  </p>
                </div>

                <div className="grid gap-2 text-[11px] sm:grid-cols-3">
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="font-mono text-[10px] font-semibold text-[var(--cyan)]">STEP 01</div>
                    <div className="mt-1 font-medium text-[var(--ink-strong)]">复制证据提示词包</div>
                    <div className="mt-0.5 text-[var(--ink-muted)]">支持一键复制或下载 `.txt` 附件，0 API 消耗</div>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="font-mono text-[10px] font-semibold text-[var(--cyan)]">STEP 02</div>
                    <div className="mt-1 font-medium text-[var(--ink-strong)]">丢给你的任意 AI</div>
                    <div className="mt-0.5 text-[var(--ink-muted)]">100% 消耗你自己的网页/客户端订阅额度</div>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="font-mono text-[10px] font-semibold text-[var(--cyan)]">STEP 03</div>
                    <div className="mt-1 font-medium text-[var(--ink-strong)]">贴回校验生成手册</div>
                    <div className="mt-0.5 text-[var(--ink-muted)]">自动核验每条 evidence_id，拒绝幻觉编造</div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  {!tourActive && (
                    <button
                      type="button"
                      onClick={() => setActiveTab("agent")}
                      className="text-xs font-medium text-[var(--cyan)] hover:underline"
                    >
                      进阶：用 MCP 让外部 Agent 自动读写 TradeLoom →
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => router.push(tourActive ? "/synthesize?tour=1&mode=manual" : "/synthesize?mode=manual")}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-strong)] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[var(--accent)]"
                  >
                    无需配置，直接免 API 去凝练
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* MODE 3: BYOK OpenAI-Compatible API / Local Ollama & LM Studio */}
            {engineMode === "api" && (
              <div className="space-y-4 pt-1">
                <p className="text-xs leading-6 text-[var(--ink-muted)]">
                  API Key 仅保存在本机 <code className="font-mono text-[11px]">workspace/config.json</code>，支持 ZCode、国内主流云厂商（火山引擎 / 阿里云 / 腾讯云 / 华为云 / 百度千帆）及本机免 Key 的 Ollama / LM Studio。
                </p>

                <div className="space-y-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg-deep)]/65 p-3">
                  {PRESET_GROUPS.map((grp) => {
                    const groupPresets = presets.filter((p) => (p.group ?? "china-cloud") === grp.key);
                    if (groupPresets.length === 0) return null;
                    return (
                      <div key={grp.key} className="space-y-1.5">
                        <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-dim)]">
                          {grp.label}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {groupPresets.map((p) => {
                            const isSelected = url.trim().toLowerCase() === p.url.toLowerCase();
                            return (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => {
                                  setUrl(p.url);
                                  setModel(p.model);
                                }}
                                title={p.note || p.url}
                                className={`rounded-md border px-2.5 py-1 text-xs transition ${
                                  isSelected
                                    ? "border-[var(--accent)] bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                                    : "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--ink-muted)] hover:border-[var(--accent)]/60 hover:text-[var(--ink)]"
                                }`}
                              >
                                {p.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  {(() => {
                    const matched = presets.find((p) => p.url.toLowerCase() === url.trim().toLowerCase());
                    return matched?.note ? (
                      <div className="border-t border-[var(--border)] pt-2 text-[11px] text-[var(--cyan)]">
                        提示：{matched.note}
                      </div>
                    ) : null;
                  })()}
                </div>

                <form onSubmit={handleSaveApi} className="space-y-3">
                  <label className="block text-xs text-[var(--ink-muted)]">
                    Chat Completions 接口地址
                    <input
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://api.deepseek.com/v1/chat/completions"
                      className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg-deep)] px-3 py-2 font-mono text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                    />
                  </label>

                  <label className="block text-xs text-[var(--ink-muted)]">
                    模型名称（Model）
                    <input
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder="deepseek-chat"
                      className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg-deep)] px-3 py-2 font-mono text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                    />
                  </label>

                  <label className="block text-xs text-[var(--ink-muted)]">
                    API Key{" "}
                    {status?.mode === "api" && status?.hasApiKey
                      ? `（当前已保存：${status.maskedKey}，留空则保持不变）`
                      : "（本机 Ollama / LM Studio 可留空）"}
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-..."
                      className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg-deep)] px-3 py-2 font-mono text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                    />
                  </label>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="submit"
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-strong)] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[var(--accent)] disabled:opacity-50"
                    >
                      <Save className="h-[15px] w-[15px]" />
                      保存 API 配置
                    </button>
                    <button
                      type="button"
                      onClick={handleTestActive}
                      disabled={busy || !status?.configured || status.mode !== "api"}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] px-4 py-2 text-xs font-medium text-[var(--ink)] transition hover:border-[var(--accent)]/60 disabled:opacity-50"
                    >
                      <PlugZap className="h-[15px] w-[15px]" />
                      测试连通
                    </button>
                    {tourActive && status?.configured && (
                      <button
                        type="button"
                        onClick={() => router.push("/synthesize?tour=1")}
                        className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[var(--emerald)] px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110"
                      >
                        进入方法论凝练
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </form>
              </div>
            )}

            {msg && (
              <div className="rounded-lg border border-[var(--emerald)]/35 bg-[var(--emerald-soft)] p-2.5 text-xs text-[var(--emerald)]">
                {msg}
              </div>
            )}
            {err && (
              <div className="rounded-lg border border-[var(--rose)]/35 bg-[var(--rose-soft)] p-2.5 text-xs text-[var(--rose)]">
                {err}
              </div>
            )}

            {tourActive && (
              <div className="flex justify-end border-t border-[var(--border)] pt-2">
                <button
                  type="button"
                  onClick={() => {
                    endGuidedTour();
                    router.push("/");
                  }}
                  className="text-[11px] text-[var(--ink-dim)] hover:text-[var(--ink-strong)]"
                >
                  暂不凝练，直接展开完整工作台 →
                </button>
              </div>
            )}
          </section>

          {/* Right: Built-in & Custom Skills Quick Preview (Hidden during focused guided tour) */}
          {!tourActive && (
            <section className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-[17px] w-[17px] text-[var(--accent)]" />
                  <h2 className="text-sm font-semibold text-[var(--ink-strong)]">已装载分析 Skill（{skills.length}）</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab("skills")}
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--accent)]/50 bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--accent)] transition hover:brightness-110"
                >
                  新建 / 克隆魔改 Skill
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {skills
                  .filter((s) => s.content)
                  .map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setActiveSkillId(s.id)}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition ${
                        activeSkill?.id === s.id
                          ? "border-[var(--accent)] bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                          : "border-[var(--border)] bg-[var(--bg-deep)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
                      }`}
                    >
                      <span>{s.name}</span>
                      {!s.builtin && (
                        <span className="rounded bg-[var(--cyan-soft)] px-1 py-0.2 text-[9px] text-[var(--cyan)]">
                          自定义
                        </span>
                      )}
                    </button>
                  ))}
              </div>

              {activeSkill?.content && (
                <div className="max-h-[540px] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] p-5">
                  <MarkdownView parsed={parseMarkdown(activeSkill.content)} />
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
