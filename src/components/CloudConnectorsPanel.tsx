"use client";

import Link from "next/link";
import {
  Bookmark,
  BookOpen,
  CheckCircle2,
  Cloud,
  ExternalLink,
  FolderOpen,
  KeyRound,
  ListChecks,
  Loader2,
  LogIn,
  LogOut,
  PlugZap,
  QrCode,
  RefreshCw,
  Save,
  ShieldCheck,
  Terminal,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  ConnectorId,
  DidaProjectSummary,
  MaskedConnectorSummary,
  YoudaoFolderSummary,
  YuqueRepoSummary,
} from "@/lib/cloud-connectors";

type FieldSpec = {
  key: string;
  label: string;
  placeholder: string;
  secret?: boolean;
  multiline?: boolean;
  feishuMode?: "open_api" | "lark_cli";
};

const CONNECTOR_META: Record<
  ConnectorId,
  {
    accent: string;
    subtitle: string;
    tokenGuide: string;
    oauthLabel?: string;
    fields: FieldSpec[];
  }
> = {
  dida365: {
    accent: "text-[var(--amber)]",
    subtitle: "官方 MCP 一键登录直连，自动拉取收集箱、个人复盘清单与已完成历史记录",
    tokenGuide:
      "推荐直接点击上方「一键登录滴答清单 (MCP)」完成官方 OAuth 授权，无需建开发者应用；也可在滴答网页版「头像 → 设置 → 账户与安全 → API 口令」生成口令粘贴。",
    oauthLabel: "一键登录滴答清单 (官方 MCP)",
    fields: [
      { key: "token", label: "备选：滴答网页版 API 口令 / Access Token（已一键登录可留空）", placeholder: "输入 API 口令或 Bearer Token", secret: true },
      { key: "projectId", label: "同步清单筛选（逗号分隔清单名或 ID；留空则同步收集箱 + 全部个人清单）", placeholder: "留空同步全部个人清单，或点下方清单胶囊勾选" },
    ],
  },
  notion: {
    accent: "text-[#f8fafc]",
    subtitle: "支持官方 MCP 一键登录授权，或传统 Integration Token 同步数据库与页面",
    tokenGuide:
      "推荐点击上方「一键登录 Notion (MCP)」直接授权工作区；或使用传统方式在 notion.so/my-integrations 创建 Internal Integration Token。",
    oauthLabel: "一键登录 Notion (官方 MCP)",
    fields: [
      { key: "token", label: "备选：Integration Token（已一键登录可留空）", placeholder: "ntn_... 或 secret_...", secret: true },
      { key: "targetId", label: "Database ID / Page ID / URL（留空则搜索全部已授权页面）", placeholder: "例如：1a2b3c4d5e6f..." },
      { key: "maxItems", label: "单次最多同步篇数", placeholder: "25" },
    ],
  },
  feishu: {
    accent: "text-[var(--cyan)]",
    subtitle: "支持「扫码一键创建应用 (RFC 8628)」与「本机 lark-cli 自动搜索 + 原生 Markdown 导出」双模式",
    tokenGuide:
      "零命令行推荐用「飞书扫码一键创建应用」自动获取 App ID/Secret 并预置只读权限；若本机已安装飞书官方 CLI (lark-cli)，可切换到「本机 lark-cli 直连」直接复用个人登录态，免粘链接批量搜索并导出原生 Markdown。",
    fields: [
      { key: "appId", label: "App ID（扫码创建后自动回填）", placeholder: "cli_a1b2c3d4...", feishuMode: "open_api" },
      { key: "appSecret", label: "App Secret（留空保留已存密钥）", placeholder: "输入 App Secret", secret: true, feishuMode: "open_api" },
      {
        key: "searchQuery",
        label: "个人云文档 / 知识库搜索关键词（≤30 字；留空则拉取最近个人 Docx/Wiki）",
        placeholder: "例如：复盘、交易计划（留空自动拉取最近文档）",
        feishuMode: "lark_cli",
      },
      {
        key: "docTokens",
        label: "指定飞书文档/知识库链接或 Token（支持多行；CLI 模式下可留空走上方搜索）",
        placeholder: "每行一条，如：https://xxx.feishu.cn/docx/xxxxx 或 https://xxx.feishu.cn/wiki/xxxxx",
        multiline: true,
      },
      { key: "cliProfile", label: "可选：lark-cli Profile 名称（留空使用默认 profile）", placeholder: "例如：default 或 bot-reader", feishuMode: "lark_cli" },
      { key: "maxItems", label: "单次最多同步篇数", placeholder: "20", feishuMode: "lark_cli" },
      { key: "domain", label: "开放平台域名", placeholder: "open.feishu.cn", feishuMode: "open_api" },
    ],
  },
  youdao: {
    accent: "text-[#38bdf8]",
    subtitle: "直连有道云笔记官方远程 MCP (SSE)，无需装 OpenClaw，支持目录点选与关键词全文同步",
    tokenGuide:
      "打开网易智能开发者平台 (mopen.163.com)，用绑定有道云笔记的手机号登录 → 进入「API 管理」免费生成 API Key（约 30 秒、免审核），粘贴到下方保存后点「测试并浏览目录」即可。",
    fields: [
      { key: "apiKey", label: "有道云笔记 API Key (x-api-key，留空保留已存密钥)", placeholder: "粘贴从 mopen.163.com 获取的 API Key", secret: true },
      { key: "folderId", label: "同步目录筛选（逗号分隔文件夹名或 ID；留空同步根目录 + 前 10 个顶层目录）", placeholder: "留空自动拉取全部常见目录，或点上方目录胶囊勾选" },
      { key: "keyword", label: "按关键词全文检索同步（可选，填写后将优先调用官方 searchNotes）", placeholder: "例如：复盘、交易计划（留空则按目录拉取）" },
      { key: "maxItems", label: "单次最多同步篇数", placeholder: "30" },
    ],
  },
  yuque: {
    accent: "text-[var(--emerald)]",
    subtitle: "支持官方 API v2 知识库胶囊点选、语雀小记 (Notes) 同步与跨库关键词搜索；免费用户可走免会员剪藏/导入通道",
    tokenGuide:
      "【超级会员 / 团队旗舰版】前往语雀「设置 → Token」创建只读 Token 贴入下方，点「测试并浏览知识库」即可勾选同步知识库与小记；【语雀免费版用户】无需开会员，直接点上方「免会员：剪藏 / 导出 MD 导入」即可无损入库。",
    fields: [
      { key: "token", label: "X-Auth-Token (留空保留已存密钥)", placeholder: "输入语雀 Personal / Team Token", secret: true },
      { key: "namespace", label: "同步知识库筛选（逗号分隔路径；留空自动同步全部知识库，或点上方胶囊勾选）", placeholder: "例如：username/trading-notes（留空同步全部）" },
      { key: "keyword", label: "跨库关键词全文检索（可选，填写后调用官方 /search 精准拉取）", placeholder: "例如：复盘、交割（留空则按知识库拉取）" },
      { key: "baseUrl", label: "API 地址或团队空间域名（支持直接填 https://xxx.yuque.com）", placeholder: "https://www.yuque.com/api/v2" },
      { key: "maxItems", label: "单次最多同步篇数", placeholder: "30" },
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
    name: "印象笔记 (Evernote)",
    badge: "富文本粘贴 / 剪藏 / HTML 导入",
    desc: "支持在客户端批量导出 .html 文件后直接拖入 TradeLoom 上传，或日常单篇使用「富文本粘贴 / 浏览器剪藏」零配置入库。",
  },
  {
    name: "微信公众号 / 任意投研长文",
    badge: "网页抓取 / 浏览器一键剪藏",
    desc: "看到深度行业研报或个人公号复盘，可直接粘贴链接抓取正文，或用书签栏剪藏一键转 Markdown 存入本地 Obsidian 知识库。",
  },
];

function parseSelectionList(raw: string): string[] {
  return raw
    .split(/[\n,;，；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function CloudConnectorsPanel() {
  const [connectors, setConnectors] = useState<MaskedConnectorSummary[]>([]);
  const [drafts, setDrafts] = useState<Record<ConnectorId, Record<string, string>>>({
    notion: {},
    feishu: {},
    yuque: {},
    dida365: {},
    youdao: {},
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [feishuReg, setFeishuReg] = useState<{
    sessionId: string;
    authUrl: string;
    userCode: string;
    interval: number;
    remainingSec: number;
  } | null>(null);
  const [feishuBrand, setFeishuBrand] = useState<"feishu" | "lark">("feishu");
  const [larkCliInfo, setLarkCliInfo] = useState<{
    installed: boolean;
    loggedIn: boolean;
    version?: string;
    userName?: string;
    appId?: string;
    profile?: string;
    message: string;
    authUrl?: string;
  } | null>(null);
  const feishuPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function loadConnectors() {
    const res = await fetch("/api/connectors", { cache: "no-store" });
    const data = await res.json();
    if (data.ok && Array.isArray(data.connectors)) {
      // Show Dida365 & Notion (MCP OAuth enabled) first
      const order: ConnectorId[] = ["dida365", "notion", "youdao", "feishu", "yuque"];
      const sorted = [...(data.connectors as MaskedConnectorSummary[])].sort(
        (a, b) => order.indexOf(a.id) - order.indexOf(b.id),
      );
      setConnectors(sorted);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const c of sorted) {
          next[c.id] = { ...c.fields, ...(prev[c.id] ?? {}) };
        }
        return next;
      });
    }
  }

  useEffect(() => {
    loadConnectors();
    if (typeof window !== "undefined") {
      const qs = new URLSearchParams(window.location.search);
      const okId = qs.get("oauth_ok") as ConnectorId | null;
      const errMsg = qs.get("oauth_err");
      const count = qs.get("oauth_count");
      if (okId) {
        const extra = okId === "dida365" && count ? `，已自动发现 ${count} 个清单（含收集箱），可直接勾选后拉取同步！` : "，现在可直接点击「拉取同步并重建双链」！";
        setFeedback((prev) => ({
          ...prev,
          [okId]: { ok: true, text: `官方 MCP OAuth 授权登录成功${extra}` },
        }));
        qs.delete("oauth_ok");
        qs.delete("oauth_count");
        const cleanUrl = `${window.location.pathname}?${qs.toString()}`;
        window.history.replaceState({}, "", cleanUrl);
      } else if (errMsg) {
        setFeedback((prev) => ({
          ...prev,
          dida365: { ok: false, text: errMsg },
        }));
        qs.delete("oauth_err");
        const cleanUrl = `${window.location.pathname}?${qs.toString()}`;
        window.history.replaceState({}, "", cleanUrl);
      }
    }
  }, []);

  function updateField(id: ConnectorId, key: string, value: string) {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? {}), [key]: value },
    }));
  }

  function toggleDidaProject(proj: DidaProjectSummary) {
    const cur = parseSelectionList(drafts.dida365?.projectId ?? "");
    const lowerSet = new Set(cur.map((s) => s.toLowerCase()));
    const matchKey = proj.id.toLowerCase();
    const nameKey = proj.name.toLowerCase();
    let next: string[];
    if (lowerSet.has(matchKey) || lowerSet.has(nameKey)) {
      next = cur.filter((s) => s.toLowerCase() !== matchKey && s.toLowerCase() !== nameKey);
    } else {
      next = [...cur, proj.isInbox ? "inbox" : proj.name];
    }
    updateField("dida365", "projectId", next.join(", "));
  }

  function toggleYuqueRepo(repo: YuqueRepoSummary) {
    const cur = parseSelectionList(drafts.yuque?.namespace ?? "");
    const lowerSet = new Set(cur.map((s) => s.toLowerCase()));
    const nsKey = repo.namespace.toLowerCase();
    const nameKey = repo.name.toLowerCase();
    let next: string[];
    if (lowerSet.has(nsKey) || lowerSet.has(nameKey)) {
      next = cur.filter((s) => s.toLowerCase() !== nsKey && s.toLowerCase() !== nameKey);
    } else {
      next = [...cur, repo.namespace];
    }
    updateField("yuque", "namespace", next.join(", "));
  }

  function toggleYoudaoFolder(folder: YoudaoFolderSummary) {
    const cur = parseSelectionList(drafts.youdao?.folderId ?? "");
    const lowerSet = new Set(cur.map((s) => s.toLowerCase()));
    const idKey = folder.id.toLowerCase();
    const nameKey = folder.name.toLowerCase();
    const rootMatched = folder.isRoot && (lowerSet.has("0") || lowerSet.has("根目录") || lowerSet.has("root"));
    let next: string[];
    if (lowerSet.has(idKey) || lowerSet.has(nameKey) || rootMatched) {
      next = cur.filter(
        (s) =>
          s.toLowerCase() !== idKey &&
          s.toLowerCase() !== nameKey &&
          !(folder.isRoot && (s.toLowerCase() === "0" || s.toLowerCase() === "根目录" || s.toLowerCase() === "root")),
      );
    } else {
      next = [...cur, folder.isRoot ? "0" : folder.name];
    }
    updateField("youdao", "folderId", next.join(", "));
  }

  useEffect(() => {
    if (!feishuReg) {
      if (feishuPollTimerRef.current) {
        clearTimeout(feishuPollTimerRef.current);
        feishuPollTimerRef.current = null;
      }
      return;
    }

    let cancelled = false;
    const pollOnce = async (sessionId: string, delaySec: number) => {
      feishuPollTimerRef.current = setTimeout(async () => {
        if (cancelled) return;
        try {
          const res = await fetch("/api/connectors/feishu-agent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "register_poll", sessionId }),
          });
          const data = await res.json();
          if (cancelled) return;

          if (data.ok && data.status === "completed") {
            setFeishuReg(null);
            if (Array.isArray(data.connectors)) {
              const order: ConnectorId[] = ["dida365", "notion", "youdao", "feishu", "yuque"];
              const sorted = [...(data.connectors as MaskedConnectorSummary[])].sort(
                (a, b) => order.indexOf(a.id) - order.indexOf(b.id),
              );
              setConnectors(sorted);
            }
            setDrafts((prev) => ({
              ...prev,
              feishu: {
                ...(prev.feishu ?? {}),
                mode: "open_api",
                appId: data.appId || "",
                appSecret: "",
                domain: data.domain || "open.feishu.cn",
              },
            }));
            setFeedback((prev) => ({
              ...prev,
              feishu: {
                ok: true,
                text: `飞书应用扫码创建成功 (${data.appId})，文档只读权限已预置并安全保存至本地！`,
              },
            }));
            return;
          }

          if (data.ok && data.status === "pending") {
            const nextInterval = Math.max(2, Number(data.interval) || delaySec);
            setFeishuReg((prev) =>
              prev && prev.sessionId === sessionId
                ? { ...prev, interval: nextInterval, remainingSec: Number(data.remainingSec) || prev.remainingSec }
                : prev,
            );
            pollOnce(sessionId, nextInterval);
            return;
          }

          setFeishuReg(null);
          setFeedback((prev) => ({
            ...prev,
            feishu: { ok: false, text: data.error || "飞书扫码创建未完成，请重试" },
          }));
        } catch {
          if (!cancelled) {
            pollOnce(sessionId, Math.min(10, delaySec + 2));
          }
        }
      }, delaySec * 1000);
    };

    pollOnce(feishuReg.sessionId, feishuReg.interval);
    return () => {
      cancelled = true;
      if (feishuPollTimerRef.current) {
        clearTimeout(feishuPollTimerRef.current);
        feishuPollTimerRef.current = null;
      }
    };
  }, [feishuReg?.sessionId]);

  async function startFeishuQrRegistration() {
    setBusyId("feishu:qr");
    setFeedback((prev) => ({ ...prev, feishu: { ok: true, text: "" } }));
    try {
      const res = await fetch("/api/connectors/feishu-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "register_start",
          brand: feishuBrand,
          existingAppId: drafts.feishu?.appId || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok && data.sessionId && data.authUrl) {
        setFeishuReg({
          sessionId: data.sessionId,
          authUrl: data.authUrl,
          userCode: data.userCode || "",
          interval: Number(data.interval) || 5,
          remainingSec: Number(data.expiresIn) || 600,
        });
      } else {
        setFeedback((prev) => ({
          ...prev,
          feishu: { ok: false, text: data.error || "发起飞书扫码建应用失败" },
        }));
      }
    } catch (err) {
      setFeedback((prev) => ({
        ...prev,
        feishu: { ok: false, text: err instanceof Error ? err.message : "网络异常" },
      }));
    } finally {
      setBusyId(null);
    }
  }

  async function checkLarkCliStatus() {
    setBusyId("feishu:cli_status");
    setFeedback((prev) => ({ ...prev, feishu: { ok: true, text: "" } }));
    try {
      const res = await fetch("/api/connectors/feishu-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cli_status", profile: drafts.feishu?.cliProfile || undefined }),
      });
      const data = await res.json();
      if (data.ok && data.cli) {
        setLarkCliInfo(data.cli);
        setFeedback((prev) => ({
          ...prev,
          feishu: { ok: Boolean(data.cli.installed && data.cli.loggedIn), text: data.cli.message },
        }));
      } else {
        setFeedback((prev) => ({
          ...prev,
          feishu: { ok: false, text: data.error || "检测本机 lark-cli 失败" },
        }));
      }
    } catch (err) {
      setFeedback((prev) => ({
        ...prev,
        feishu: { ok: false, text: err instanceof Error ? err.message : "网络异常" },
      }));
    } finally {
      setBusyId(null);
    }
  }

  async function startLarkCliLogin() {
    setBusyId("feishu:cli_login");
    setFeedback((prev) => ({ ...prev, feishu: { ok: true, text: "" } }));
    try {
      const res = await fetch("/api/connectors/feishu-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cli_login", profile: drafts.feishu?.cliProfile || undefined }),
      });
      const data = await res.json();
      if (data.ok && data.authUrl) {
        setLarkCliInfo((prev) => ({
          ...(prev ?? { installed: true, loggedIn: false, message: data.message }),
          authUrl: data.authUrl,
          message: data.message,
        }));
        setFeedback((prev) => ({ ...prev, feishu: { ok: true, text: data.message } }));
      } else {
        setFeedback((prev) => ({
          ...prev,
          feishu: { ok: false, text: data.error || "发起 CLI 浏览器授权失败" },
        }));
      }
    } catch (err) {
      setFeedback((prev) => ({
        ...prev,
        feishu: { ok: false, text: err instanceof Error ? err.message : "网络异常" },
      }));
    } finally {
      setBusyId(null);
    }
  }

  async function startMcpOAuth(id: "dida365" | "notion") {
    setBusyId(`${id}:oauth`);
    setFeedback((prev) => ({ ...prev, [id]: { ok: true, text: "" } }));
    try {
      const region = id === "dida365" && drafts.dida365?.region === "global" ? "global" : "cn";
      const res = await fetch("/api/connectors/oauth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, region }),
      });
      const data = await res.json();
      if (data.ok && data.authUrl) {
        window.location.href = data.authUrl;
        return;
      }
      setFeedback((prev) => ({
        ...prev,
        [id]: { ok: false, text: data.error || "发起官方 MCP 登录失败" },
      }));
    } catch (err) {
      setFeedback((prev) => ({
        ...prev,
        [id]: { ok: false, text: err instanceof Error ? err.message : "网络异常" },
      }));
    } finally {
      setBusyId(null);
    }
  }

  async function runAction(id: ConnectorId, action: "save" | "test" | "sync" | "disconnect") {
    setBusyId(`${id}:${action}`);
    setFeedback((prev) => ({ ...prev, [id]: { ok: true, text: "" } }));
    try {
      // Auto-persist filter/mode changes before syncing (or testing Feishu CLI mode)
      if (action === "sync" || (action === "test" && id === "feishu" && drafts.feishu?.mode === "lark_cli")) {
        await fetch("/api/connectors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, action: "save", fields: drafts[id] }),
        });
      }

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
        if (data.connectors) {
          const order: ConnectorId[] = ["dida365", "notion", "youdao", "feishu", "yuque"];
          const sorted = [...(data.connectors as MaskedConnectorSummary[])].sort(
            (a, b) => order.indexOf(a.id) - order.indexOf(b.id),
          );
          setConnectors(sorted);
        }
        if (action === "save") {
          setDrafts((prev) => ({
            ...prev,
            [id]: { ...(prev[id] ?? {}), token: "", appSecret: "", apiKey: "" },
          }));
          setFeedback((prev) => ({
            ...prev,
            [id]: { ok: true, text: "凭证与同步选项已安全保存至本地 workspace/connectors.json。" },
          }));
        } else if (action === "disconnect") {
          setDrafts((prev) => ({
            ...prev,
            [id]: { ...(prev[id] ?? {}), token: "", appSecret: "", apiKey: "", projectId: "", folderId: "" },
          }));
          setFeedback((prev) => ({
            ...prev,
            [id]: { ok: true, text: "已断开当前账号授权，可重新登录切换账号。" },
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
            LOCAL-FIRST CLOUD CONNECTORS · MCP OAUTH & BYOK
          </div>
          <h2 className="mt-1.5 text-base font-semibold text-[#f8fafc]">
            主流云端笔记直连同步 & 官方 MCP 一键登录
          </h2>
          <p className="mt-1 text-xs leading-6 text-[var(--ink-muted)]">
            <strong className="text-[var(--amber)]">滴答清单 / TickTick</strong> 与 <strong className="text-[#f8fafc]">Notion</strong> 已支持{" "}
            <strong className="text-[var(--cyan)]">官方远程 MCP + 一键 OAuth 登录</strong>；
            <strong className="text-[#38bdf8]">有道云笔记</strong> 已支持{" "}
            <strong className="text-[var(--cyan)]">官方远程 MCP (SSE)</strong>（仅需 1 个 API Key，无需装 OpenClaw）；
            <strong className="text-[var(--cyan)]">飞书</strong> 支持「扫码一键建应用 + 本机 lark-cli」双模式直连；
            <strong className="text-[var(--ink)]">语雀</strong> 支持官方 API v2；
            <strong className="text-[var(--ink)]">雪球 / 印象笔记 / 公众号</strong> 提供粘贴 / URL 抓取 / 浏览器一键剪藏。
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

      {/* 4 Official Connectors */}
      <div className="grid gap-4 lg:grid-cols-2">
        {connectors.map((c) => {
          const meta = CONNECTOR_META[c.id];
          const fb = feedback[c.id];
          const isOAuth = busyId === `${c.id}:oauth`;
          const isSaving = busyId === `${c.id}:save`;
          const isTesting = busyId === `${c.id}:test`;
          const isSyncing = busyId === `${c.id}:sync`;
          const isDisconnecting = busyId === `${c.id}:disconnect`;
          const selectedDidaTokens = new Set(
            parseSelectionList(drafts.dida365?.projectId ?? "").map((s) => s.toLowerCase()),
          );
          const selectedYoudaoTokens = new Set(
            parseSelectionList(drafts.youdao?.folderId ?? "").map((s) => s.toLowerCase()),
          );
          const selectedYuqueTokens = new Set(
            parseSelectionList(drafts.yuque?.namespace ?? "").map((s) => s.toLowerCase()),
          );

          return (
            <div key={c.id} className="scifi-card flex flex-col justify-between rounded-xl p-5">
              <div className="space-y-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className={`text-sm font-semibold ${meta.accent}`}>{c.name}</h3>
                      <span
                        className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                          c.authMode === "mcp_oauth" || c.authMode === "mcp_api_key"
                            ? "border-[var(--cyan)]/45 bg-[var(--cyan-soft)] text-[var(--cyan)]"
                            : "border-[var(--border-strong)] bg-[var(--bg-deep)] text-[var(--ink-dim)]"
                        }`}
                      >
                        {c.badge}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">{meta.subtitle}</p>
                  </div>
                  {c.configured ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--emerald)]/35 bg-[var(--emerald-soft)] px-2 py-0.5 text-[10px] text-[var(--emerald)]">
                      <CheckCircle2 className="h-3 w-3" />
                      {c.authMode === "mcp_oauth" ? "MCP 已授权" : `已配置 ${c.maskedSecret}`}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--bg-deep)] px-2 py-0.5 text-[10px] text-[var(--ink-dim)]">
                      未配置
                    </span>
                  )}
                </div>

                {/* One-Click MCP OAuth Login Bar for Dida365 & Notion */}
                {c.supportsMcpOAuth && (c.id === "dida365" || c.id === "notion") && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--cyan)]/35 bg-[var(--cyan-soft)]/50 p-2.5">
                    {c.id === "dida365" && (
                      <div className="inline-flex rounded-md border border-[var(--border-strong)] bg-[var(--bg-deep)] p-0.5 text-[11px]">
                        <button
                          type="button"
                          onClick={() => updateField("dida365", "region", "cn")}
                          className={`rounded px-2 py-0.5 transition ${
                            (drafts.dida365?.region ?? "cn") !== "global"
                              ? "bg-[var(--accent-strong)] font-medium text-white"
                              : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
                          }`}
                        >
                          国内版 dida365
                        </button>
                        <button
                          type="button"
                          onClick={() => updateField("dida365", "region", "global")}
                          className={`rounded px-2 py-0.5 transition ${
                            drafts.dida365?.region === "global"
                              ? "bg-[var(--accent-strong)] font-medium text-white"
                              : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
                          }`}
                        >
                          海外版 TickTick
                        </button>
                      </div>
                    )}

                    <button
                      type="button"
                      disabled={busyId !== null}
                      onClick={() => startMcpOAuth(c.id as "dida365" | "notion")}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-strong)] px-3 py-1.5 text-xs font-semibold text-white shadow-[0_0_12px_rgba(124,77,255,0.3)] transition hover:bg-[var(--accent)] disabled:opacity-50"
                    >
                      {isOAuth ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
                      {c.configured && c.authMode === "mcp_oauth" ? "重新登录 / 切换账号" : meta.oauthLabel}
                    </button>

                    {c.configured && (
                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => runAction(c.id, "disconnect")}
                        className="ml-auto inline-flex items-center gap-1 rounded-md border border-red-500/35 bg-red-500/10 px-2 py-1 text-[11px] text-red-300 transition hover:bg-red-500/20 disabled:opacity-50"
                      >
                        {isDisconnecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />}
                        断开授权
                      </button>
                    )}
                  </div>
                )}

                {/* Feishu Dual-Mode Agent Bar: QR One-Click App Creation + Local lark-cli Bridge */}
                {c.id === "feishu" && (
                  <div className="space-y-2.5 rounded-lg border border-[var(--cyan)]/35 bg-[var(--cyan-soft)]/35 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="inline-flex rounded-md border border-[var(--border-strong)] bg-[var(--bg-deep)] p-0.5 text-[11px]">
                        <button
                          type="button"
                          onClick={() => updateField("feishu", "mode", "open_api")}
                          className={`rounded px-2.5 py-1 transition ${
                            (drafts.feishu?.mode ?? "open_api") !== "lark_cli"
                              ? "bg-[var(--accent-strong)] font-medium text-white"
                              : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
                          }`}
                        >
                          扫码建应用 / Open API
                        </button>
                        <button
                          type="button"
                          onClick={() => updateField("feishu", "mode", "lark_cli")}
                          className={`rounded px-2.5 py-1 transition ${
                            drafts.feishu?.mode === "lark_cli"
                              ? "bg-[var(--accent-strong)] font-medium text-white"
                              : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
                          }`}
                        >
                          本机 lark-cli 直连
                        </button>
                      </div>

                      {c.configured && (
                        <button
                          type="button"
                          disabled={busyId !== null}
                          onClick={() => runAction("feishu", "disconnect")}
                          className="inline-flex items-center gap-1 rounded-md border border-red-500/35 bg-red-500/10 px-2 py-1 text-[11px] text-red-300 transition hover:bg-red-500/20 disabled:opacity-50"
                        >
                          {isDisconnecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />}
                          清除配置
                        </button>
                      )}
                    </div>

                    {(drafts.feishu?.mode ?? "open_api") !== "lark_cli" ? (
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="inline-flex rounded-md border border-[var(--border-strong)] bg-[var(--bg-deep)] p-0.5 text-[10px]">
                            <button
                              type="button"
                              onClick={() => setFeishuBrand("feishu")}
                              className={`rounded px-2 py-0.5 transition ${
                                feishuBrand === "feishu"
                                  ? "bg-[var(--cyan)]/20 font-medium text-[var(--cyan)]"
                                  : "text-[var(--ink-dim)] hover:text-[var(--ink)]"
                              }`}
                            >
                              国内飞书
                            </button>
                            <button
                              type="button"
                              onClick={() => setFeishuBrand("lark")}
                              className={`rounded px-2 py-0.5 transition ${
                                feishuBrand === "lark"
                                  ? "bg-[var(--cyan)]/20 font-medium text-[var(--cyan)]"
                                  : "text-[var(--ink-dim)] hover:text-[var(--ink)]"
                              }`}
                            >
                              国际 Lark
                            </button>
                          </div>

                          <button
                            type="button"
                            disabled={busyId !== null || feishuReg !== null}
                            onClick={startFeishuQrRegistration}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-strong)] px-3 py-1.5 text-xs font-semibold text-white shadow-[0_0_12px_rgba(124,77,255,0.28)] transition hover:bg-[var(--accent)] disabled:opacity-50"
                          >
                            {busyId === "feishu:qr" ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <QrCode className="h-3.5 w-3.5" />
                            )}
                            飞书扫码一键创建应用
                          </button>
                        </div>

                        {feishuReg && (
                          <div className="space-y-2 rounded-lg border border-[var(--cyan)]/45 bg-[var(--bg-deep)] p-3 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1.5 font-medium text-[var(--cyan)]">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                等待你在飞书确认（约剩余 {feishuReg.remainingSec}s）
                              </span>
                              <button
                                type="button"
                                onClick={() => setFeishuReg(null)}
                                className="inline-flex items-center gap-0.5 text-[11px] text-[var(--ink-dim)] hover:text-red-300"
                              >
                                <X className="h-3 w-3" />
                                取消
                              </button>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <a
                                href={feishuReg.authUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--cyan)] px-3 py-1 text-xs font-semibold text-[#06131f] transition hover:brightness-110"
                              >
                                打开飞书授权确认页
                                <ExternalLink className="h-3 w-3" />
                              </a>
                              {feishuReg.userCode && (
                                <span className="rounded border border-[var(--border-strong)] bg-[var(--surface-2)] px-2 py-1 font-mono text-[11px] text-[var(--ink)]">
                                  确认码：{feishuReg.userCode}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] leading-5 text-[var(--ink-dim)]">
                              点击上方按钮在浏览器或手机飞书中确认创建后，TradeLoom 会自动拉回 App ID 与 App Secret 并保存。
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={busyId !== null}
                            onClick={checkLarkCliStatus}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0284c7] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#0ea5e9] disabled:opacity-50"
                          >
                            {busyId === "feishu:cli_status" ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Terminal className="h-3.5 w-3.5" />
                            )}
                            检测本机 lark-cli 状态
                          </button>
                          <button
                            type="button"
                            disabled={busyId !== null}
                            onClick={startLarkCliLogin}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--cyan)]/45 bg-[var(--bg-deep)] px-3 py-1.5 text-xs font-medium text-[var(--cyan)] transition hover:bg-[var(--cyan-soft)] disabled:opacity-50"
                          >
                            {busyId === "feishu:cli_login" ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <LogIn className="h-3.5 w-3.5" />
                            )}
                            发起 CLI 个人授权
                          </button>
                        </div>
                        {larkCliInfo?.authUrl && (
                          <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--cyan)]/40 bg-[var(--bg-deep)] p-2 text-xs">
                            <a
                              href={larkCliInfo.authUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 font-medium text-[var(--cyan)] hover:underline"
                            >
                              点此打开飞书 CLI 个人授权页面
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        )}
                        <p className="text-[11px] leading-5 text-[var(--ink-dim)]">
                          未安装？在终端执行{" "}
                          <code className="rounded bg-[var(--bg-deep)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--cyan)]">
                            npx @larksuite/cli@latest install
                          </code>{" "}
                          并登录后，点「保存配置 → 拉取同步并重建双链」即可自动检索并导出原生 Markdown。
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* YoudaoNote Official MCP Quick Action Bar */}
                {c.id === "youdao" && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#38bdf8]/35 bg-[#38bdf8]/10 p-2.5">
                    <a
                      href="https://mopen.163.com/"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#0284c7] px-3 py-1.5 text-xs font-semibold text-white shadow-[0_0_12px_rgba(56,189,248,0.28)] transition hover:bg-[#0ea5e9]"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      去 mopen.163.com 获取 API Key
                      <ExternalLink className="h-3 w-3 opacity-80" />
                    </a>
                    {c.configured && (
                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => runAction("youdao", "disconnect")}
                        className="ml-auto inline-flex items-center gap-1 rounded-md border border-red-500/35 bg-red-500/10 px-2 py-1 text-[11px] text-red-300 transition hover:bg-red-500/20 disabled:opacity-50"
                      >
                        {isDisconnecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />}
                        清除密钥
                      </button>
                    )}
                  </div>
                )}

                <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/75 px-3 py-2 text-[11px] leading-5 text-[var(--ink-dim)]">
                  {meta.tokenGuide}
                </div>

                {/* Yuque Dual-Path Action Bar (VIP Token + Free Clip/Import) */}
                {c.id === "yuque" && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--emerald)]/35 bg-[var(--emerald-soft)]/50 p-2.5">
                    <a
                      href="https://www.yuque.com/settings/tokens"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#059669] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#10b981]"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      去语雀获取 Token（超级会员）
                      <ExternalLink className="h-3 w-3 opacity-80" />
                    </a>
                    <Link
                      href="/vault?import=cloud"
                      className="inline-flex items-center gap-1 rounded-lg border border-[var(--emerald)]/45 bg-[var(--bg-deep)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--emerald)] transition hover:bg-[var(--emerald)]/15"
                    >
                      免会员：剪藏 / 导出 MD 导入 →
                    </Link>
                    {c.configured && (
                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => runAction("yuque", "disconnect")}
                        className="ml-auto inline-flex items-center gap-1 rounded-md border border-red-500/35 bg-red-500/10 px-2 py-1 text-[11px] text-red-300 transition hover:bg-red-500/20 disabled:opacity-50"
                      >
                        {isDisconnecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />}
                        清除密钥
                      </button>
                    )}
                  </div>
                )}

                {/* Yuque Notes Option + Discovered Repos Pill Selector */}
                {c.id === "yuque" && (
                  <div className="space-y-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/85 p-3">
                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--ink-muted)]">
                      <input
                        type="checkbox"
                        checked={(drafts.yuque?.includeNotes ?? "true") !== "false"}
                        onChange={(e) =>
                          updateField("yuque", "includeNotes", e.target.checked ? "true" : "false")
                        }
                        className="h-3.5 w-3.5 accent-[var(--emerald)]"
                      />
                      <span>同时拉取「语雀小记 (Notes)」（盘中随手记与复盘碎片，推荐）</span>
                    </label>

                    {c.discoveredRepos && c.discoveredRepos.length > 0 && (
                      <div className="space-y-1.5 border-t border-[var(--border)] pt-2">
                        <div className="flex items-center justify-between text-[11px] text-[var(--ink-dim)]">
                          <span className="inline-flex items-center gap-1">
                            <BookOpen className="h-3.5 w-3.5 text-[var(--emerald)]" />
                            已发现知识库（点选指定同步；全不选 = 同步全部知识库）：
                          </span>
                          {selectedYuqueTokens.size > 0 && (
                            <button
                              type="button"
                              onClick={() => updateField("yuque", "namespace", "")}
                              className="text-[var(--emerald)] hover:underline"
                            >
                              清空勾选
                            </button>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {c.discoveredRepos.map((r) => {
                            const active =
                              selectedYuqueTokens.has(r.namespace.toLowerCase()) ||
                              selectedYuqueTokens.has(r.name.toLowerCase());
                            return (
                              <button
                                key={r.namespace}
                                type="button"
                                onClick={() => toggleYuqueRepo(r)}
                                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                                  active
                                    ? "border-[var(--emerald)] bg-[var(--emerald-soft)] font-medium text-[var(--emerald)]"
                                    : "border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--ink-muted)] hover:border-[var(--emerald)] hover:text-[var(--ink)]"
                                }`}
                              >
                                <span>{r.name}</span>
                                {typeof r.itemsCount === "number" && (
                                  <span className="text-[9px] opacity-70">({r.itemsCount})</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* YoudaoNote Discovered Folders Pill Selector */}
                {c.id === "youdao" && c.discoveredFolders && c.discoveredFolders.length > 0 && (
                  <div className="space-y-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/85 p-3">
                    <div className="flex items-center justify-between text-[11px] text-[var(--ink-dim)]">
                      <span className="inline-flex items-center gap-1">
                        <FolderOpen className="h-3.5 w-3.5 text-[#38bdf8]" />
                        已发现有道目录（点选指定同步；全不选 = 同步根目录 + 前 10 个文件夹）：
                      </span>
                      {selectedYoudaoTokens.size > 0 && (
                        <button
                          type="button"
                          onClick={() => updateField("youdao", "folderId", "")}
                          className="text-[var(--cyan)] hover:underline"
                        >
                          清空勾选
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {c.discoveredFolders.map((f) => {
                        const active =
                          selectedYoudaoTokens.has(f.id.toLowerCase()) ||
                          selectedYoudaoTokens.has(f.name.toLowerCase()) ||
                          (f.isRoot && (selectedYoudaoTokens.has("0") || selectedYoudaoTokens.has("根目录")));
                        return (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => toggleYoudaoFolder(f)}
                            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                              active
                                ? "border-[#38bdf8] bg-[#38bdf8]/15 font-medium text-[#38bdf8]"
                                : "border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--ink-muted)] hover:border-[#38bdf8] hover:text-[var(--ink)]"
                            }`}
                          >
                            <span>{f.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Dida365 Discovered Projects Pill Selector + Options */}
                {c.id === "dida365" && (
                  <div className="space-y-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/85 p-3">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-[var(--ink-muted)]">
                      <label className="inline-flex cursor-pointer items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={(drafts.dida365?.includeCompleted ?? "true") !== "false"}
                          onChange={(e) =>
                            updateField("dida365", "includeCompleted", e.target.checked ? "true" : "false")
                          }
                          className="h-3.5 w-3.5 accent-[var(--cyan)]"
                        />
                        <span>包含已完成的历史记录（推荐）</span>
                      </label>
                      <label className="inline-flex cursor-pointer items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={(drafts.dida365?.skipWelcome ?? "true") !== "false"}
                          onChange={(e) =>
                            updateField("dida365", "skipWelcome", e.target.checked ? "true" : "false")
                          }
                          className="h-3.5 w-3.5 accent-[var(--cyan)]"
                        />
                        <span>自动跳过官方「欢迎使用」教程</span>
                      </label>
                    </div>

                    {c.discoveredProjects && c.discoveredProjects.length > 0 && (
                      <div className="space-y-1.5 border-t border-[var(--border)] pt-2">
                        <div className="flex items-center justify-between text-[11px] text-[var(--ink-dim)]">
                          <span className="inline-flex items-center gap-1">
                            <ListChecks className="h-3.5 w-3.5 text-[var(--cyan)]" />
                            当前账号清单（点选指定同步；全不选 = 同步全部个人清单 + 收集箱）：
                          </span>
                          {selectedDidaTokens.size > 0 && (
                            <button
                              type="button"
                              onClick={() => updateField("dida365", "projectId", "")}
                              className="text-[var(--cyan)] hover:underline"
                            >
                              清空勾选
                            </button>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {c.discoveredProjects.map((p) => {
                            const active =
                              selectedDidaTokens.has(p.id.toLowerCase()) ||
                              selectedDidaTokens.has(p.name.toLowerCase()) ||
                              (p.isInbox && selectedDidaTokens.has("inbox"));
                            return (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => toggleDidaProject(p)}
                                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                                  active
                                    ? "border-[var(--cyan)] bg-[var(--cyan-soft)] font-medium text-[var(--cyan)]"
                                    : p.isWelcome
                                      ? "border-[var(--border)] bg-transparent text-[var(--ink-dim)] line-through opacity-65 hover:opacity-100"
                                      : "border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--ink-muted)] hover:border-[var(--accent)] hover:text-[var(--ink)]"
                                }`}
                              >
                                <span>{p.name}</span>
                                {p.kind === "NOTE" && (
                                  <span className="rounded bg-[var(--accent)]/20 px-1 text-[9px] text-[var(--accent)]">
                                    笔记
                                  </span>
                                )}
                                {p.isWelcome && <span className="text-[9px]">(官方教程)</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2.5">
                  {meta.fields
                    .filter((f) => {
                      if (c.id !== "feishu" || !f.feishuMode) return true;
                      const activeMode = drafts.feishu?.mode === "lark_cli" ? "lark_cli" : "open_api";
                      return f.feishuMode === activeMode;
                    })
                    .map((f) => (
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
                            f.secret && c.configured
                              ? c.authMode === "mcp_oauth"
                                ? "已通过官方 MCP OAuth 授权，留空即可"
                                : `已保存 (${c.maskedSecret})，留空不修改`
                              : f.placeholder
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
                    className={`rounded-lg border px-3 py-2 text-xs leading-5 ${
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
                    disabled={busyId !== null || (!c.configured && !(c.id === "feishu" && drafts.feishu?.mode === "lark_cli"))}
                    onClick={() => runAction(c.id, "test")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-1.5 text-xs font-medium text-[var(--ink-muted)] transition hover:border-[var(--cyan)] hover:text-[var(--cyan)] disabled:opacity-50"
                  >
                    {isTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
                    {c.id === "dida365"
                      ? "测试并刷新清单"
                      : c.id === "youdao"
                        ? "测试并浏览目录"
                        : c.id === "yuque"
                          ? "测试并浏览知识库"
                          : "测试连接"}
                  </button>
                  <button
                    type="button"
                    disabled={busyId !== null || (!c.configured && !(c.id === "feishu" && drafts.feishu?.mode === "lark_cli"))}
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
            雪球 / 印象笔记 / 微信公众号（推荐：富文本粘贴 · URL 抓取 · 浏览器一键剪藏）
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
