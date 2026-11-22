"use client";

import { useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2, Cloud, Hash, KeyRound, PlugZap, Save, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import CloudConnectorsPanel from "@/components/CloudConnectorsPanel";
import ConceptTaxonomyEditor from "@/components/ConceptTaxonomyEditor";
import MarkdownView from "@/components/MarkdownView";
import SkillStudioPanel from "@/components/SkillStudioPanel";
import { parseMarkdown } from "@/lib/markdown";
import type { MaskedProviderStatus } from "@/lib/provider";
import type { SkillSpec } from "@/lib/skills";

type Preset = { id: string; label: string; url: string; model: string };
type SettingsTab = "llm" | "skills" | "concepts" | "connectors";

function resolveTab(param: string | null): SettingsTab {
  if (param === "skills") return "skills";
  if (param === "concepts") return "concepts";
  if (param === "connectors") return "connectors";
  return "llm";
}

export default function SettingsWorkspace() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => resolveTab(searchParams.get("tab")));

  const [status, setStatus] = useState<MaskedProviderStatus | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [skills, setSkills] = useState<SkillSpec[]>([]);
  const [activeSkillId, setActiveSkillId] = useState("short-term");

  const [url, setUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "skills" || t === "concepts" || t === "connectors" || t === "llm") {
      setActiveTab(t);
    }
  }, [searchParams]);

  useEffect(() => {
    Promise.all([
      fetch("/api/provider", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/skills", { cache: "no-store" }).then((r) => r.json()),
    ]).then(([p, s]) => {
      if (p.ok) {
        setStatus(p.status);
        setPresets(p.presets || []);
        setUrl(p.status.url || p.presets?.[0]?.url || "");
        setModel(p.status.model || p.presets?.[0]?.model || "");
      }
      if (s.ok) setSkills(s.skills || []);
    });
  }, []);

  async function handleSave(e: React.FormEvent) {
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
        setMsg("配置已安全保存至本地 workspace/config.json（已被 .gitignore 隔离）。");
      } else {
        setErr(data.error || "保存失败");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
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
        setMsg(`连通成功！模型 ${data.model} 返回：${data.reply}`);
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
      {/* Obsidian Settings Sub-Tabs */}
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
          <KeyRound className="h-3.5 w-3.5" />
          AI 大模型配置（全局共享）
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
          <Sparkles className="h-3.5 w-3.5" />
          AI 提炼规则工坊（全局共享）
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
          <Hash className="h-3.5 w-3.5" />
          当前库关键词词典（仅当前库）
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
          <Cloud className="h-3.5 w-3.5" />
          云端同步中心（9 大平台 · 全局授权）
        </button>
      </div>

      {activeTab === "skills" ? (
        <SkillStudioPanel initialSkills={skills} onSkillsChange={setSkills} />
      ) : activeTab === "concepts" ? (
        <ConceptTaxonomyEditor />
      ) : activeTab === "connectors" ? (
        <CloudConnectorsPanel />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          {/* Left: BYOK LLM API Settings */}
          <section className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-[var(--accent)]" />
                <h2 className="text-sm font-semibold text-[var(--ink-strong)]">自配大模型 API（OpenAI 兼容协议）</h2>
              </div>
              {status?.configured && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--emerald-soft)] px-2.5 py-0.5 text-[11px] text-[var(--emerald)]">
                  <CheckCircle2 className="h-3 w-3" />
                  已配置
                </span>
              )}
            </div>

            <p className="text-xs leading-6 text-[var(--ink-muted)]">
              TradeLoom 不托管任何云端账号，你的 API Key 与复盘原文只保留在本地磁盘，仅在你点击「开始提炼」时直连你配置的模型接口。
            </p>

            {/* Presets */}
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setUrl(p.url);
                    setModel(p.model);
                  }}
                  className="rounded-md border border-[var(--border-strong)] bg-[var(--bg-deep)] px-2.5 py-1 text-xs text-[var(--ink-muted)] transition hover:border-[var(--accent)]/60 hover:text-[var(--ink)]"
                >
                  {p.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleSave} className="space-y-3">
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
                API Key {status?.hasApiKey ? `（当前已保存：${status.maskedKey}，留空则保持不变）` : "（本机 Ollama 可留空）"}
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg-deep)] px-3 py-2 font-mono text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                />
              </label>

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

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-strong)] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[var(--accent)] disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" />
                  保存配置
                </button>
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={busy || !status?.configured}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] px-4 py-2 text-xs font-medium text-[var(--ink)] transition hover:border-[var(--accent)]/60 disabled:opacity-50"
                >
                  <PlugZap className="h-3.5 w-3.5" />
                  测试连通
                </button>
              </div>
            </form>
          </section>

          {/* Right: Built-in & Custom Skills Quick Preview */}
          <section className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[var(--accent)]" />
                <h2 className="text-sm font-semibold text-[var(--ink-strong)]">已装载分析 Skill（{skills.length}）</h2>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab("skills")}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--accent)]/50 bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--accent)] transition hover:brightness-110"
              >
                新建 / 克隆魔改 Skill
                <ArrowRight className="h-3 w-3" />
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
        </div>
      )}
    </div>
  );
}
