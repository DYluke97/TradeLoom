"use client";

import Link from "next/link";
import {
  Bookmark,
  CheckCircle2,
  Cloud,
  ExternalLink,
  Loader2,
  PlugZap,
  RefreshCw,
  Save,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ConnectorId, MaskedConnectorSummary } from "@/lib/cloud-connectors";

type FieldSpec = {
  key: string;
  label: string;
  placeholder: string;
  secret?: boolean;
  multiline?: boolean;
};

const CONNECTOR_META: Record<
  ConnectorId,
  {
    accent: string;
    subtitle: string;
    tokenGuide: string;
    fields: FieldSpec[];
  }
> = {
  notion: {
    accent: "text-[#f8fafc]",
    subtitle: "同步 Notion 复盘数据库（Database）或单页，自动保留日期属性与标签",
    tokenGuide: "在 notion.so/my-integrations 创建 Internal Integration 获取 Token，并在目标页面右上角 Connections 添加该应用。",
    fields: [
      { key: "token", label: "Integration Token (留空保留已存密钥)", placeholder: "ntn_... 或 secret_...", secret: true },
      { key: "targetId", label: "Database ID 或 Page ID（留空则拉取全部已授权页面）", placeholder: "例如：1a2b3c4d5e6f..." },
      { key: "maxItems", label: "单次最多同步篇数", placeholder: "25" },
    ],
  },
  feishu: {
    accent: "text-[var(--cyan)]",
    subtitle: "通过飞书开放平台直连同步个人复盘云文档（Docx）或知识库节点（Wiki）",
    tokenGuide: "在 open.feishu.cn 创建自建应用并开通 docx:document:readonly / wiki:wiki:readonly 权限，将应用添加至文档协作者。",
    fields: [
      { key: "appId", label: "App ID", placeholder: "cli_a1b2c3d4..." },
      { key: "appSecret", label: "App Secret (留空保留已存密钥)", placeholder: "输入 App Secret", secret: true },
      {
        key: "docTokens",
        label: "飞书文档/知识库链接或 Token（支持多行批量填写）",
        placeholder: "每行一条，如：https://xxx.feishu.cn/docx/xxxxx 或 https://xxx.feishu.cn/wiki/xxxxx",
        multiline: true,
      },
      { key: "domain", label: "开放平台域名", placeholder: "open.feishu.cn" },
    ],
  },
  yuque: {
    accent: "text-[var(--emerald)]",
    subtitle: "直连语雀 API v2，原生 Markdown 无损拉取指定知识库的历史复盘文章",
    tokenGuide: "在语雀右上角「账户设置 → Token」创建只读 Token；知识库路径形如 your_login/trading-review。",
    fields: [
      { key: "token", label: "X-Auth-Token (留空保留已存密钥)", placeholder: "输入语雀 Personal Token", secret: true },
      { key: "namespace", label: "知识库路径（留空自动读取首个知识库）", placeholder: "例如：username/trading-notes" },
      { key: "maxItems", label: "单次最多同步篇数", placeholder: "30" },
    ],
  },
  dida365: {
    accent: "text-[var(--amber)]",
    subtitle: "直连滴答清单 / TickTick Open API，把每日复盘清单、检查项与交易纪律同步为双链卡片",
    tokenGuide: "在 developer.dida365.com 创建应用完成 OAuth 授权获取 Access Token；海外版可将 API 地址改为 https://api.ticktick.com/open/v1。",
    fields: [
      { key: "token", label: "Open API Access Token (留空保留已存密钥)", placeholder: "输入 Bearer Access Token", secret: true },
      { key: "projectId", label: "指定清单名称或 Project ID（留空同步全部清单）", placeholder: "例如：盘后复盘" },
      { key: "baseUrl", label: "API 地址", placeholder: "https://api.dida365.com/open/v1" },
    ],
  },
};

const CLIP_PLATFORMS = [
  {
    name: "雪球 (Xueqiu)",
    badge: "公开帖 URL 抓取 / 剪藏",
    desc: "公开复盘长文可直接用「网页链接抓取」；私密笔记或触发登录校验的页面，推荐用浏览器一键剪藏小书签或 Ctrl+C 富文本粘贴入库。",
  },
  {
    name: "有道云笔记",
    badge: "富文本粘贴 / 剪藏 / 导出 MD",
    desc: "有道云笔记个人端未开放简单 Token API，最稳妥的方式是在网页/客户端复制后「快捷粘贴入库」（自动转 Markdown），或用浏览器剪藏一键收录。",
  },
  {
    name: "印象笔记 (Evernote)",
    badge: "富文本粘贴 / 剪藏 / HTML 导入",
    desc: "支持在客户端批量导出 .html 文件后直接拖入 TradeLoom 上传，或日常单篇使用「富文本粘贴 / 浏览器剪藏」零配置入库。",
  },
];

export default function CloudConnectorsPanel() {
  const [connectors, setConnectors] = useState<MaskedConnectorSummary[]>([]);
  const [drafts, setDrafts] = useState<Record<ConnectorId, Record<string, string>>>({
    notion: {},
    feishu: {},
    yuque: {},
    dida365: {},
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, { ok: boolean; text: string }>>({});

  async function loadConnectors() {
    const res = await fetch("/api/connectors", { cache: "no-store" });
    const data = await res.json();
    if (data.ok && Array.isArray(data.connectors)) {
      setConnectors(data.connectors);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const c of data.connectors as MaskedConnectorSummary[]) {
          next[c.id] = { ...c.fields, ...(prev[c.id] ?? {}) };
        }
        return next;
      });
    }
  }

  useEffect(() => {
    loadConnectors();
  }, []);

  function updateField(id: ConnectorId, key: string, value: string) {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? {}), [key]: value },
    }));
  }

  async function runAction(id: ConnectorId, action: "save" | "test" | "sync") {
    setBusyId(`${id}:${action}`);
    setFeedback((prev) => ({ ...prev, [id]: { ok: true, text: "" } }));
    try {
      const res = await fetch("/api/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          action,
          fields: action === "save" ? drafts[id] : undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        if (data.connectors) setConnectors(data.connectors);
        if (action === "save") {
          // Clear secret inputs after saving
          setDrafts((prev) => ({
            ...prev,
            [id]: { ...(prev[id] ?? {}), token: "", appSecret: "" },
          }));
          setFeedback((prev) => ({
            ...prev,
            [id]: { ok: true, text: "凭证已安全保存至本地 workspace/connectors.json（不上传任何第三方服务器）。" },
          }));
        } else {
          setFeedback((prev) => ({
            ...prev,
            [id]: { ok: true, text: data.message || "操作成功" },
          }));
        }
      } else {
        setFeedback((prev) => ({
          ...prev,
          [id]: { ok: false, text: data.error || "操作失败" },
        }));
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="scifi-card flex flex-wrap items-center justify-between gap-4 rounded-xl p-5">
        <div>
          <div className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold tracking-wider text-[var(--cyan)]">
            <ShieldCheck className="h-3.5 w-3.5" />
            LOCAL-FIRST CLOUD CONNECTORS · BYOK
          </div>
          <h2 className="mt-1.5 text-base font-semibold text-[#f8fafc]">
            主流云端笔记直连同步 & 网页剪藏接入
          </h2>
          <p className="mt-1 text-xs leading-6 text-[var(--ink-muted)]">
            首批内置 <strong className="text-[var(--ink)]">Notion、飞书文档、语雀、滴答清单</strong> 4 大官方开放 API 连接器（所有密钥仅存于本机 <code className="text-[var(--cyan)]">workspace/connectors.json</code>）；
            同时为 <strong className="text-[var(--ink)]">雪球、有道云笔记、印象笔记</strong> 提供零门槛粘贴 / URL 抓取 / 浏览器一键剪藏。
          </p>
        </div>
        <Link
          href="/vault?import=cloud"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--cyan)]/45 bg-[var(--cyan-soft)] px-3.5 py-2 text-xs font-medium text-[var(--cyan)] transition hover:border-[var(--cyan)] hover:bg-[var(--cyan)]/20"
        >
          <Cloud className="h-3.5 w-3.5" />
          打开「粘贴 / URL 抓取 / 剪藏」弹窗
        </Link>
      </div>

      {/* 4 Official API Connectors */}
      <div className="grid gap-4 lg:grid-cols-2">
        {connectors.map((c) => {
          const meta = CONNECTOR_META[c.id];
          const fb = feedback[c.id];
          const isSaving = busyId === `${c.id}:save`;
          const isTesting = busyId === `${c.id}:test`;
          const isSyncing = busyId === `${c.id}:sync`;

          return (
            <div key={c.id} className="scifi-card flex flex-col justify-between rounded-xl p-5">
              <div className="space-y-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className={`text-sm font-semibold ${meta.accent}`}>{c.name}</h3>
                      <span className="rounded border border-[var(--border-strong)] bg-[var(--bg-deep)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-dim)]">
                        {c.badge}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">{meta.subtitle}</p>
                  </div>
                  {c.configured ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--emerald)]/35 bg-[var(--emerald-soft)] px-2 py-0.5 text-[10px] text-[var(--emerald)]">
                      <CheckCircle2 className="h-3 w-3" />
                      已配置 {c.maskedSecret}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--bg-deep)] px-2 py-0.5 text-[10px] text-[var(--ink-dim)]">
                      未配置
                    </span>
                  )}
                </div>

                <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/75 px-3 py-2 text-[11px] leading-5 text-[var(--ink-dim)]">
                  {meta.tokenGuide}
                </div>

                <div className="space-y-2.5">
                  {meta.fields.map((f) => (
                    <div key={f.key}>
                      <label className="block text-[11px] text-[var(--ink-muted)]">{f.label}</label>
                      {f.multiline ? (
                        <textarea
                          rows={2}
                          value={drafts[c.id]?.[f.key] ?? ""}
                          onChange={(e) => updateField(c.id, f.key, e.target.value)}
                          placeholder={f.placeholder}
                          className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-1.5 font-mono text-xs text-[var(--ink)] placeholder:text-[var(--ink-dim)] focus:border-[var(--cyan)] focus:outline-none"
                        />
                      ) : (
                        <input
                          type={f.secret ? "password" : "text"}
                          value={drafts[c.id]?.[f.key] ?? ""}
                          onChange={(e) => updateField(c.id, f.key, e.target.value)}
                          placeholder={
                            f.secret && c.configured ? `已保存 (${c.maskedSecret})，留空不修改` : f.placeholder
                          }
                          className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-1.5 font-mono text-xs text-[var(--ink)] placeholder:text-[var(--ink-dim)] focus:border-[var(--cyan)] focus:outline-none"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 space-y-2.5 border-t border-[var(--border)] pt-3.5">
                {fb?.text && (
                  <div
                    className={`rounded-lg border px-3 py-2 text-xs ${
                      fb.ok
                        ? "border-[var(--emerald)]/35 bg-[var(--emerald-soft)] text-[var(--emerald)]"
                        : "border-red-500/40 bg-red-500/10 text-red-300"
                    }`}
                  >
                    {fb.text}
                  </div>
                )}

                {c.lastSync && (
                  <div className="flex items-center justify-between text-[11px] text-[var(--ink-dim)]">
                    <span className="truncate">上次同步：{c.lastSync.message}</span>
                    <Link
                      href="/vault?view=graph"
                      className="ml-2 inline-flex shrink-0 items-center gap-1 text-[var(--cyan)] hover:underline"
                    >
                      查看星图
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => runAction(c.id, "save")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] transition hover:border-[var(--accent)] disabled:opacity-50"
                  >
                    {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    保存配置
                  </button>
                  <button
                    type="button"
                    disabled={busyId !== null || !c.configured}
                    onClick={() => runAction(c.id, "test")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-1.5 text-xs font-medium text-[var(--ink-muted)] transition hover:border-[var(--cyan)] hover:text-[var(--cyan)] disabled:opacity-50"
                  >
                    {isTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
                    测试连接
                  </button>
                  <button
                    type="button"
                    disabled={busyId !== null || !c.configured}
                    onClick={() => runAction(c.id, "sync")}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#7c4dff] to-[#22d3ee] px-3.5 py-1.5 text-xs font-semibold text-white shadow-[0_0_14px_rgba(34,211,238,0.25)] transition hover:brightness-110 disabled:opacity-50"
                  >
                    {isSyncing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    {isSyncing ? "同步中..." : "拉取同步并重建双链"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 3 Login-Walled Mainstream Platforms: Xueqiu / Youdao / Evernote */}
      <div className="scifi-card rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#f8fafc]">
            <Bookmark className="h-4 w-4 text-[var(--emerald)]" />
            雪球 / 有道云笔记 / 印象笔记（推荐：富文本粘贴 · URL 抓取 · 浏览器一键剪藏）
          </div>
          <Link
            href="/vault?import=cloud"
            className="text-xs font-medium text-[var(--cyan)] hover:underline"
          >
            立即使用粘贴 / 剪藏工具 →
          </Link>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {CLIP_PLATFORMS.map((item) => (
            <div
              key={item.name}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/85 p-3.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--ink)]">{item.name}</span>
                <span className="rounded bg-[var(--emerald-soft)] px-1.5 py-0.5 text-[10px] text-[var(--emerald)]">
                  {item.badge}
                </span>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-[var(--ink-muted)]">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
