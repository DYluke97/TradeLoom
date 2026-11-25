import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type CliAgentId =
  | "claude"
  | "codex"
  | "gemini"
  | "agy"
  | "opencode"
  | "cursor-agent"
  | "zcode"
  | "kimi"
  | "qwen"
  | "codebuddy"
  | "iflow"
  | "copilot"
  | "openclaw"
  | "goose"
  | "kiro-cli"
  | "aider"
  | "custom";

export type CliAgentCategory = "flagship" | "china" | "open-ecosystem" | "custom";

export type CliAgentSpec = {
  id: CliAgentId;
  name: string;
  vendor: string;
  category: CliAgentCategory;
  badge: string;
  description: string;
  binaries: string[];
  extraPathsWin?: string[];
  extraPathsPosix?: string[];
  defaultModelHint: string;
  installHint: string;
  supportsModelFlag: boolean;
  docsUrl?: string;
};

export type DetectedCliAgent = {
  id: CliAgentId;
  name: string;
  vendor: string;
  category: CliAgentCategory;
  badge: string;
  description: string;
  installed: boolean;
  resolvedPath: string | null;
  defaultModelHint: string;
  installHint: string;
  supportsModelFlag: boolean;
  docsUrl?: string;
};

export type CliInvocationRequest = {
  agentId: CliAgentId;
  system: string;
  user: string;
  model?: string;
  binPath?: string;
  customArgs?: string;
  jsonMode?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (info: { contentChars: number; reasoningChars: number }) => void;
};

export type CliInvocationOutcome =
  | {
      ok: true;
      content: string;
      model: string;
      usage: { promptTokens: number | null; completionTokens: number | null };
    }
  | { ok: false; error: string };

const SAFE_MODEL_RE = /^[a-zA-Z0-9._:/@#+-]{1,140}$/;
const UNSAFE_CMD_METACHARS_RE = /[&|;<>^%!\r\n`]/;
const ANSI_ESCAPE_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

export const CLI_AGENT_SPECS: readonly CliAgentSpec[] = [
  {
    id: "claude",
    name: "Claude Code",
    vendor: "Anthropic",
    category: "flagship",
    badge: "Pro / Max 订阅免 Key",
    description: "Anthropic 官方命令行 Agent，已登录账号后直接用订阅额度完成深度方法论提炼。",
    binaries: ["claude"],
    extraPathsWin: ["%USERPROFILE%\\.claude\\local\\claude.exe", "%LOCALAPPDATA%\\Programs\\claude\\claude.exe"],
    extraPathsPosix: ["~/.claude/local/claude", "~/.local/bin/claude"],
    defaultModelHint: "留空使用默认模型（如 claude-sonnet-4-6 / opus）",
    installHint: "npm i -g @anthropic-ai/claude-code && claude login",
    supportsModelFlag: true,
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code",
  },
  {
    id: "codex",
    name: "OpenAI Codex CLI",
    vendor: "OpenAI",
    category: "flagship",
    badge: "ChatGPT Plus / Pro 订阅",
    description: "OpenAI 官方终端 Agent，通过只读 exec 模式输出干净结果文件，免填 API Key。",
    binaries: ["codex"],
    extraPathsWin: ["%APPDATA%\\npm\\codex.cmd", "%LOCALAPPDATA%\\Programs\\codex\\codex.exe"],
    extraPathsPosix: ["~/.local/bin/codex"],
    defaultModelHint: "留空使用默认模型（如 gpt-5.4 / o3）",
    installHint: "npm i -g @openai/codex && codex login",
    supportsModelFlag: true,
    docsUrl: "https://github.com/openai/codex",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    vendor: "Google",
    category: "flagship",
    badge: "Google 账号免费额度 / AI Pro",
    description: "Google 官方开源终端 Agent，支持 Google 账号直登，自带大上下文窗口。",
    binaries: ["gemini"],
    extraPathsWin: ["%APPDATA%\\npm\\gemini.cmd"],
    extraPathsPosix: ["~/.local/bin/gemini"],
    defaultModelHint: "留空使用默认模型（如 gemini-2.5-pro）",
    installHint: "npm i -g @google/gemini-cli && gemini",
    supportsModelFlag: true,
    docsUrl: "https://github.com/google-gemini/gemini-cli",
  },
  {
    id: "agy",
    name: "Antigravity CLI (agy)",
    vendor: "Google Antigravity",
    category: "flagship",
    badge: "Antigravity 本地直连",
    description: "Google Antigravity 官方 CLI，内置沙盒非交互 print 模式，支持多模型切换。",
    binaries: ["agy", "antigravity"],
    extraPathsWin: ["%LOCALAPPDATA%\\agy\\bin\\agy.exe", "%USERPROFILE%\\.agy\\bin\\agy.exe"],
    extraPathsPosix: ["~/.local/bin/agy", "/usr/local/bin/agy"],
    defaultModelHint: "留空使用当前默认模型",
    installHint: "安装 Antigravity CLI 并完成登录",
    supportsModelFlag: true,
  },
  {
    id: "cursor-agent",
    name: "Cursor Agent CLI",
    vendor: "Cursor",
    category: "flagship",
    badge: "Cursor 订阅免 Key",
    description: "Cursor 官方 CLI Agent，直接复用你已登录的 Cursor 订阅额度与模型池。",
    binaries: ["cursor-agent"],
    extraPathsWin: ["%LOCALAPPDATA%\\cursor-agent\\cursor-agent.exe", "%LOCALAPPDATA%\\Programs\\cursor-agent\\cursor-agent.exe"],
    extraPathsPosix: ["~/.local/bin/cursor-agent"],
    defaultModelHint: "留空使用默认模型（如 sonnet-4 / gpt-5）",
    installHint: "安装 Cursor CLI 并执行 cursor-agent login",
    supportsModelFlag: true,
    docsUrl: "https://docs.cursor.com/cli",
  },
  {
    id: "opencode",
    name: "OpenCode CLI",
    vendor: "OpenCode",
    category: "open-ecosystem",
    badge: "多模型 / 免费模型支持",
    description: "开源终端 Agent，支持一键挂载任意已授权模型与订阅通道，按附件安全传递长复盘。",
    binaries: ["opencode"],
    extraPathsWin: ["%USERPROFILE%\\bin\\opencode.cmd", "%USERPROFILE%\\.opencode\\bin\\opencode.exe"],
    extraPathsPosix: ["~/.opencode/bin/opencode", "~/.local/bin/opencode"],
    defaultModelHint: "留空使用默认，或填 provider/model",
    installHint: "安装 opencode 并执行 opencode auth",
    supportsModelFlag: true,
    docsUrl: "https://opencode.ai",
  },
  {
    id: "zcode",
    name: "ZCode CLI (智谱 Z.ai)",
    vendor: "智谱 AI / Z.ai",
    category: "china",
    badge: "GLM Coding 套餐 / 开源 ADE",
    description: "智谱 Z.ai 官方开源编程 Agent（zai-org/ZCode），自动以只读 plan 模式在隔离沙盒分析长复盘。",
    binaries: ["zcode"],
    extraPathsWin: [
      "%APPDATA%\\npm\\zcode.cmd",
      "%LOCALAPPDATA%\\Programs\\zcode\\zcode.exe",
      "%USERPROFILE%\\.local\\bin\\zcode.exe",
    ],
    extraPathsPosix: ["~/.local/bin/zcode", "/usr/local/bin/zcode"],
    defaultModelHint: "由 ZCode 配置决定（如 GLM-5.3 / GLM-5.4）",
    installHint: "安装 zai-org/ZCode CLI 并完成登录/模型配置",
    supportsModelFlag: false,
    docsUrl: "https://github.com/zai-org/ZCode",
  },
  {
    id: "kimi",
    name: "Kimi CLI",
    vendor: "月之暗面 Moonshot",
    category: "china",
    badge: "国产长文本 · 会员免 Key",
    description: "Kimi 官方命令行 Agent，长上下文中文复盘理解极佳，直接复用 Kimi 账号登录态。",
    binaries: ["kimi"],
    extraPathsWin: ["%USERPROFILE%\\.local\\bin\\kimi.exe"],
    extraPathsPosix: ["~/.local/bin/kimi"],
    defaultModelHint: "留空使用默认模型（如 kimi-k2）",
    installHint: "安装 Kimi CLI 并登录账号",
    supportsModelFlag: true,
  },
  {
    id: "qwen",
    name: "Qwen Code CLI",
    vendor: "阿里云通义千问",
    category: "china",
    badge: "国产开源 · OAuth 免费额度",
    description: "通义千问官方终端 Agent，支持 Qwen OAuth 免费登录额度与超长中文窗口。",
    binaries: ["qwen"],
    extraPathsWin: ["%APPDATA%\\npm\\qwen.cmd"],
    extraPathsPosix: ["~/.local/bin/qwen"],
    defaultModelHint: "留空使用默认模型（如 qwen3-coder-plus）",
    installHint: "npm i -g @qwen-code/qwen-code && qwen",
    supportsModelFlag: true,
    docsUrl: "https://github.com/QwenLM/qwen-code",
  },
  {
    id: "codebuddy",
    name: "腾讯 CodeBuddy CLI",
    vendor: "Tencent",
    category: "china",
    badge: "国内直连 · 微信/腾讯账号",
    description: "腾讯云代码助手官方命令行 Agent，国内网络稳定直连，兼容无头 print 输出。",
    binaries: ["codebuddy"],
    extraPathsWin: ["%APPDATA%\\npm\\codebuddy.cmd"],
    extraPathsPosix: ["~/.local/bin/codebuddy"],
    defaultModelHint: "留空使用默认模型",
    installHint: "npm i -g @tencent-ai/codebuddy-code",
    supportsModelFlag: true,
  },
  {
    id: "iflow",
    name: "iFlow 心流 CLI",
    vendor: "心流 iFlow",
    category: "china",
    badge: "国内免费多模型额度",
    description: "面向国内开发者的免费终端 Agent，内置 DeepSeek / Qwen / Kimi 等多模型通道。",
    binaries: ["iflow"],
    extraPathsWin: ["%APPDATA%\\npm\\iflow.cmd"],
    extraPathsPosix: ["~/.local/bin/iflow"],
    defaultModelHint: "留空使用默认模型",
    installHint: "npm i -g @iflow-ai/iflow-cli && iflow",
    supportsModelFlag: true,
  },
  {
    id: "openclaw",
    name: "OpenClaw Agent",
    vendor: "OpenClaw",
    category: "open-ecosystem",
    badge: "个人全能 Agent",
    description: "热门本地个人 AI Agent，自动读取临时复盘任务包并复用你已配置的网关模型。",
    binaries: ["openclaw"],
    extraPathsWin: ["%APPDATA%\\npm\\openclaw.cmd"],
    extraPathsPosix: ["~/.local/bin/openclaw"],
    defaultModelHint: "由 OpenClaw 自身配置决定",
    installHint: "npm i -g openclaw",
    supportsModelFlag: false,
  },
  {
    id: "copilot",
    name: "GitHub Copilot CLI",
    vendor: "GitHub",
    category: "flagship",
    badge: "Copilot 订阅免 Key",
    description: "GitHub Copilot 独立命令行 Agent，复用 GitHub Copilot Pro / Business 订阅。",
    binaries: ["copilot"],
    extraPathsWin: ["%APPDATA%\\npm\\copilot.cmd", "%LOCALAPPDATA%\\Programs\\copilot\\copilot.exe"],
    extraPathsPosix: ["~/.local/bin/copilot"],
    defaultModelHint: "留空使用默认（如 claude-sonnet-4 / gpt-5）",
    installHint: "npm i -g @github/copilot && copilot login",
    supportsModelFlag: true,
  },
  {
    id: "goose",
    name: "Goose CLI",
    vendor: "Block",
    category: "open-ecosystem",
    badge: "开源多通道 Agent",
    description: "Block 开源桌面/终端 Agent，通过 `-i` 附件模式无损处理大规模复盘文档。",
    binaries: ["goose"],
    extraPathsWin: ["%USERPROFILE%\\.local\\bin\\goose.exe"],
    extraPathsPosix: ["~/.local/bin/goose"],
    defaultModelHint: "由 goose configure 配置决定",
    installHint: "安装 Block Goose CLI 并完成 goose configure",
    supportsModelFlag: false,
  },
  {
    id: "kiro-cli",
    name: "AWS Kiro CLI",
    vendor: "Amazon",
    category: "flagship",
    badge: "AWS Builder ID / Pro",
    description: "Amazon Kiro 官方终端 Agent，支持非交互模式直接读取复盘证据并输出手册。",
    binaries: ["kiro-cli"],
    extraPathsWin: ["%USERPROFILE%\\.local\\bin\\kiro-cli.exe"],
    extraPathsPosix: ["~/.local/bin/kiro-cli"],
    defaultModelHint: "留空使用默认模型",
    installHint: "安装 kiro-cli 并执行 kiro-cli login",
    supportsModelFlag: true,
  },
  {
    id: "aider",
    name: "Aider CLI",
    vendor: "Aider",
    category: "open-ecosystem",
    badge: "开源终端编程 Agent",
    description: "成熟开源 CLI Agent，支持 `--message-file` 无损载入超长复盘上下文。",
    binaries: ["aider"],
    extraPathsWin: ["%USERPROFILE%\\.local\\bin\\aider.exe"],
    extraPathsPosix: ["~/.local/bin/aider"],
    defaultModelHint: "留空使用默认配置，或填模型名",
    installHint: "pipx install aider-chat",
    supportsModelFlag: true,
  },
  {
    id: "custom",
    name: "自定义本机 CLI Agent",
    vendor: "任意兼容命令行",
    category: "custom",
    badge: "扩展任意未来 Agent",
    description: "填写任意本机可执行命令与参数模板（通过 stdin 或 `{prompt_file}` 传入完整提示词）。",
    binaries: [],
    defaultModelHint: "可在参数模板中自行指定",
    installHint: "填写本机 CLI 路径，例如 C:\\tools\\my-agent.exe",
    supportsModelFlag: false,
  },
] as const;

export function getCliAgentSpec(agentId: string | undefined | null): CliAgentSpec | null {
  if (!agentId) return null;
  return CLI_AGENT_SPECS.find((s) => s.id === agentId) ?? null;
}

function getHostHomeDir(): string {
  // Dynamic lookup prevents Next.js output file tracing (NFT) from globbing the host user profile directory at build time.
  const env = process.env;
  const fromEnv = env["USERPROFILE"] || env["HOME"];
  if (fromEnv) return fromEnv;
  const fnName = "homedir" as const;
  return os[fnName]();
}

function joinHostPath(...parts: string[]): string {
  const fnName = "join" as const;
  return path[fnName](...parts);
}

function expandEnvAndHome(rawPath: string): string {
  const home = getHostHomeDir();
  const env = process.env;
  let out = rawPath.replace(/^~(?=[\\/]|$)/, home);
  out = out.replace(/%([^%]+)%/g, (_, key: string) => env[key] ?? "");
  return path.normalize(out);
}

function isExecutableFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function getCommonExtraDirs(): string[] {
  const home = getHostHomeDir();
  const env = process.env;
  if (process.platform === "win32") {
    const appData = env["APPDATA"] ?? "";
    const localAppData = env["LOCALAPPDATA"] ?? "";
    const dirs = [
      appData ? joinHostPath(appData, "npm") : "",
      localAppData ? joinHostPath(localAppData, "pnpm") : "",
      localAppData ? joinHostPath(localAppData, "agy", "bin") : "",
      localAppData ? joinHostPath(localAppData, "cursor-agent") : "",
      localAppData ? joinHostPath(localAppData, "Microsoft", "WinGet", "Links") : "",
      joinHostPath(home, ".local", "bin"),
      joinHostPath(home, "bin"),
      joinHostPath(home, ".claude", "local"),
      joinHostPath(home, ".opencode", "bin"),
      joinHostPath(home, ".bun", "bin"),
      joinHostPath(home, ".cargo", "bin"),
      joinHostPath(home, "scoop", "shims"),
    ];
    return Array.from(new Set(dirs.filter(Boolean)));
  }
  const dirs = [
    joinHostPath(home, ".local", "bin"),
    joinHostPath(home, "bin"),
    joinHostPath(home, ".claude", "local"),
    joinHostPath(home, ".opencode", "bin"),
    joinHostPath(home, ".bun", "bin"),
    joinHostPath(home, ".cargo", "bin"),
    joinHostPath(home, ".npm-global", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  return Array.from(new Set(dirs.filter(Boolean)));
}

export function resolveExecutableOnHost(
  commandOrNames: string | string[],
  extraCandidates: string[] = [],
): string | null {
  const names = Array.isArray(commandOrNames) ? commandOrNames : [commandOrNames];
  const isWin = process.platform === "win32";
  const pathDirs = (process.env["PATH"] ?? "")
    .split(path.delimiter)
    .map((d) => d.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
  const allDirs = Array.from(new Set([...pathDirs, ...getCommonExtraDirs()]));

  const winExts = [".exe", ".cmd", ".bat", ".com"];

  for (const rawName of names) {
    const trimmed = rawName.trim();
    if (!trimmed) continue;

    // Explicit path
    if (trimmed.includes("/") || trimmed.includes("\\") || path.isAbsolute(trimmed)) {
      const expanded = expandEnvAndHome(trimmed);
      if (isExecutableFile(expanded)) return expanded;
      if (isWin && !/\.[a-z0-9]+$/i.test(expanded)) {
        for (const ext of winExts) {
          if (isExecutableFile(expanded + ext)) return expanded + ext;
        }
      }
      continue;
    }

    for (const dir of allDirs) {
      if (isWin) {
        const hasExt = /\.[a-z0-9]+$/i.test(trimmed);
        if (hasExt) {
          const full = joinHostPath(dir, trimmed);
          if (isExecutableFile(full)) return full;
        } else {
          for (const ext of winExts) {
            const full = joinHostPath(dir, `${trimmed}${ext}`);
            if (isExecutableFile(full)) return full;
          }
        }
      } else {
        const full = joinHostPath(dir, trimmed);
        if (isExecutableFile(full)) return full;
      }
    }
  }

  for (const rawCandidate of extraCandidates) {
    const expanded = expandEnvAndHome(rawCandidate);
    if (expanded && isExecutableFile(expanded)) return expanded;
  }

  return null;
}

export function detectLocalCliAgents(): DetectedCliAgent[] {
  const isWin = process.platform === "win32";
  return CLI_AGENT_SPECS.map((spec) => {
    if (spec.id === "custom") {
      return {
        id: spec.id,
        name: spec.name,
        vendor: spec.vendor,
        category: spec.category,
        badge: spec.badge,
        description: spec.description,
        installed: false,
        resolvedPath: null,
        defaultModelHint: spec.defaultModelHint,
        installHint: spec.installHint,
        supportsModelFlag: spec.supportsModelFlag,
        docsUrl: spec.docsUrl,
      };
    }

    const extra = isWin ? (spec.extraPathsWin ?? []) : (spec.extraPathsPosix ?? []);
    const resolvedPath = resolveExecutableOnHost([...spec.binaries], extra);
    return {
      id: spec.id,
      name: spec.name,
      vendor: spec.vendor,
      category: spec.category,
      badge: spec.badge,
      description: spec.description,
      installed: Boolean(resolvedPath),
      resolvedPath,
      defaultModelHint: spec.defaultModelHint,
      installHint: spec.installHint,
      supportsModelFlag: spec.supportsModelFlag,
      docsUrl: spec.docsUrl,
    };
  });
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, "");
}

export function parseNdjsonStreamOutput(raw: string): {
  recognized: boolean;
  content: string;
  error?: string;
  usage?: { promptTokens: number | null; completionTokens: number | null };
} {
  const cleaned = stripAnsi(raw).replace(/\r\n?/g, "\n").trim();
  if (!cleaned) return { recognized: false, content: "" };
  const lines = cleaned.split("\n").map((l) => l.trim()).filter(Boolean);
  let recognized = false;
  let deltaBuf = "";
  let finalResponse = "";
  let finalError: string | undefined;
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;

  for (const line of lines) {
    if (!line.startsWith("{") || !line.endsWith("}")) continue;
    try {
      const evt = JSON.parse(line) as Record<string, unknown>;
      if (typeof evt.event !== "string") continue;
      recognized = true;
      if (evt.event === "step_update" && evt.step_update && typeof evt.step_update === "object") {
        const su = evt.step_update as Record<string, unknown>;
        if (typeof su.text_delta === "string") deltaBuf += su.text_delta;
      } else if (evt.event === "result" && evt.result && typeof evt.result === "object") {
        const res = evt.result as Record<string, unknown>;
        if (typeof res.response === "string") finalResponse = res.response;
        if (typeof res.error === "string" && res.error.trim()) finalError = res.error.trim();
        if (res.usage && typeof res.usage === "object") {
          const u = res.usage as Record<string, unknown>;
          if (typeof u.input_tokens === "number") promptTokens = u.input_tokens;
          if (typeof u.output_tokens === "number") completionTokens = u.output_tokens;
        }
      }
    } catch {
      /* ignore non-JSON log line */
    }
  }

  return {
    recognized,
    content: (finalResponse || deltaBuf).trim(),
    error: finalError,
    usage: { promptTokens, completionTokens },
  };
}

/**
 * Unwraps common CLI structured envelopes (e.g. `{"type":"result","result":"..."}` or agy NDJSON stream-json)
 * while leaving raw TradeLoom synthesis JSON untouched.
 */
export function unwrapCliTextOutput(raw: string): string {
  const ndjson = parseNdjsonStreamOutput(raw);
  if (ndjson.recognized && ndjson.content) return ndjson.content;

  const cleaned = stripAnsi(raw).replace(/\r\n?/g, "\n").trim();
  if (!cleaned) return "";

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      if ("overview" in parsed || "manual" in parsed || "timeline" in parsed) {
        return cleaned;
      }
      if (typeof parsed.result === "string" && parsed.result.trim()) return parsed.result.trim();
      if (typeof parsed.response === "string" && parsed.response.trim()) return parsed.response.trim();
      if (typeof parsed.text === "string" && parsed.text.trim()) return parsed.text.trim();
      if (typeof parsed.content === "string" && parsed.content.trim()) return parsed.content.trim();
    }
  } catch {
    /* not a single wrapper JSON; return cleaned text directly */
  }
  return cleaned;
}

export function parseCustomCliArgs(raw: string): { ok: true; args: string[] } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, args: [] };
  if (UNSAFE_CMD_METACHARS_RE.test(trimmed)) {
    return { ok: false, error: "自定义参数中不允许包含 shell 管道或控制符（& | ; < > ^ % ! `）" };
  }
  const out: string[] = [];
  let cur = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (quote) return { ok: false, error: "自定义参数存在未闭合的引号" };
  if (cur) out.push(cur);
  return { ok: true, args: out };
}

export function validateCliModel(model: string | undefined): { ok: true; model: string } | { ok: false; error: string } {
  const trimmed = (model ?? "").trim();
  if (!trimmed) return { ok: true, model: "" };
  if (!SAFE_MODEL_RE.test(trimmed)) {
    return { ok: false, error: "模型名称仅允许字母、数字及 . _ : / @ # + - 字符" };
  }
  return { ok: true, model: trimmed };
}

export function buildCliCombinedPrompt(system: string, user: string, jsonMode?: boolean): string {
  const sections: string[] = [
    "【重要执行边界】仅基于下方提供的文本材料完成分析并直接输出最终答案。严禁调用任何工具、严禁读写文件系统、严禁执行命令或联网检索。",
    "",
  ];
  if (system.trim()) {
    sections.push("===== 系统规则 =====", system.trim(), "");
  }
  sections.push("===== 任务输入 =====", user.trim());
  if (jsonMode) {
    sections.push("", "【最终输出要求】请仅输出一个合法的 JSON 对象，不要附加额外寒暄或解释。");
  }
  return sections.join("\n");
}

export type BuiltCliPlan = {
  args: string[];
  stdinText: string | null;
  outputFile?: string;
  needsPromptFile: boolean;
};

export function buildCliInvocationPlan(params: {
  agentId: CliAgentId;
  model: string;
  promptFile: string;
  outputFile: string;
  combinedPrompt: string;
  customArgs?: string[];
}): BuiltCliPlan {
  const { agentId, model, promptFile, outputFile, combinedPrompt, customArgs } = params;
  const shortFileDirective =
    "请完整阅读附件或输入中的交易复盘材料与规则，仅做纯文本分析，严格按要求直接输出结果，不要调用任何工具。";
  const shortStdinDirective =
    "请严格按标准输入中的规则与材料直接输出最终结果，不要调用任何工具或读写文件。";

  switch (agentId) {
    case "claude": {
      const args = ["--output-format", "text"];
      if (model) args.push("--model", model);
      args.push("-p");
      return { args, stdinText: combinedPrompt, needsPromptFile: false };
    }
    case "codex": {
      const args = ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "-o", outputFile];
      if (model) args.push("-m", model);
      args.push("-");
      return { args, stdinText: combinedPrompt, outputFile, needsPromptFile: false };
    }
    case "gemini": {
      const args = ["--output-format", "text"];
      if (model) args.push("-m", model);
      args.push("-p", shortStdinDirective);
      return { args, stdinText: combinedPrompt, needsPromptFile: false };
    }
    case "agy": {
      // agy --input-format stream-json reads arbitrarily large prompts from stdin as NDJSON without hitting
      // Windows 32KB argv limit and without requiring interactive file-read tool permissions.
      const args = ["--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands", "--sandbox"];
      if (model) args.push("--model", model);
      const ndjsonPayload = `${JSON.stringify({ event: "user", message: { role: "user", content: combinedPrompt } })}\n`;
      return { args, stdinText: ndjsonPayload, needsPromptFile: false };
    }
    case "opencode": {
      const args = ["run", "--format", "default", "--archived", "-f", promptFile];
      if (model) args.push("-m", model);
      args.push(shortFileDirective);
      return { args, stdinText: null, needsPromptFile: true };
    }
    case "cursor-agent": {
      const args = ["--output-format", "text"];
      if (model) args.push("--model", model);
      args.push("-p");
      return { args, stdinText: combinedPrompt, needsPromptFile: false };
    }
    case "zcode": {
      const args = [
        "--mode",
        "plan",
        "--cwd",
        path.dirname(promptFile),
        "--prompt",
        `请完整阅读当前工作目录下的 ${path.basename(promptFile)} 文件，并严格按其中的交易复盘规则直接输出合法 JSON 对象，不要修改任何文件或执行命令。`,
      ];
      return { args, stdinText: null, needsPromptFile: true };
    }
    case "kimi": {
      const args = ["--output-format", "text"];
      if (model) args.push("--model", model);
      args.push("--print");
      return { args, stdinText: combinedPrompt, needsPromptFile: false };
    }
    case "qwen": {
      const args = ["--output-format", "text"];
      if (model) args.push("-m", model);
      args.push("-p", shortStdinDirective);
      return { args, stdinText: combinedPrompt, needsPromptFile: false };
    }
    case "codebuddy": {
      const args = ["--output-format", "text"];
      if (model) args.push("--model", model);
      args.push("-p");
      return { args, stdinText: combinedPrompt, needsPromptFile: false };
    }
    case "iflow": {
      const args = ["-p", shortStdinDirective];
      if (model) args.push("-m", model);
      return { args, stdinText: combinedPrompt, needsPromptFile: false };
    }
    case "copilot": {
      const args = ["-p", shortStdinDirective, "-s"];
      if (model) args.push("--model", model);
      return { args, stdinText: combinedPrompt, needsPromptFile: false };
    }
    case "openclaw": {
      const args = [
        "agent",
        "--local",
        "--message",
        `请读取当前目录中的 ${path.basename(promptFile)} 文件并严格按要求输出结果，不要执行外部命令。`,
      ];
      return { args, stdinText: null, needsPromptFile: true };
    }
    case "goose": {
      const args = ["run", "-i", promptFile, "--no-session"];
      return { args, stdinText: null, needsPromptFile: true };
    }
    case "kiro-cli": {
      const args = ["chat", "--no-interactive"];
      if (model) args.push("--model", model);
      return { args, stdinText: combinedPrompt, needsPromptFile: false };
    }
    case "aider": {
      const args = ["--no-git", "--no-auto-commits", "--no-stream", "--yes-always", "--message-file", promptFile];
      if (model) args.push("--model", model);
      return { args, stdinText: null, needsPromptFile: true };
    }
    case "custom": {
      const rawArgs = customArgs ?? [];
      let usesFile = false;
      const expanded = rawArgs.map((a) => {
        if (a.includes("{prompt_file}")) {
          usesFile = true;
          return a.replaceAll("{prompt_file}", promptFile);
        }
        return a;
      });
      return {
        args: expanded,
        stdinText: usesFile ? null : combinedPrompt,
        needsPromptFile: usesFile,
      };
    }
  }
}

function quoteWinCmdArg(arg: string): string {
  if (!arg) return '""';
  const safe = arg.replace(/"/g, '\\"');
  return /[\s"]/.test(safe) ? `"${safe}"` : safe;
}

function terminateChildProcess(pid: number | undefined, killFallback: () => void): void {
  if (!pid) {
    killFallback();
    return;
  }
  if (process.platform === "win32") {
    try {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.unref();
    } catch {
      killFallback();
    }
  } else {
    killFallback();
  }
}

export async function callLocalCliAgent(req: CliInvocationRequest): Promise<CliInvocationOutcome> {
  const spec = getCliAgentSpec(req.agentId);
  if (!spec) {
    return { ok: false, error: `不支持的本机 CLI Agent 类型：${req.agentId}` };
  }

  const validModel = validateCliModel(req.model);
  if (!validModel.ok) return validModel;

  let parsedCustomArgs: string[] = [];
  if (req.agentId === "custom") {
    const parsed = parseCustomCliArgs(req.customArgs ?? "");
    if (!parsed.ok) return parsed;
    parsedCustomArgs = parsed.args;
  }

  const isWin = process.platform === "win32";
  const extraPaths = isWin ? (spec.extraPathsWin ?? []) : (spec.extraPathsPosix ?? []);
  const resolvedBin = req.binPath?.trim()
    ? resolveExecutableOnHost(req.binPath.trim())
    : spec.id === "custom"
      ? null
      : resolveExecutableOnHost([...spec.binaries], extraPaths);

  if (!resolvedBin) {
    return {
      ok: false,
      error:
        spec.id === "custom"
          ? "未找到自定义 CLI 可执行文件，请检查填写的命令或绝对路径是否存在。"
          : `本机未检测到 ${spec.name}（${spec.binaries.join(" / ")}）。安装提示：${spec.installHint}`,
    };
  }

  const sandboxDir = await mkdtemp(path.join(os.tmpdir(), "tradeloom-cli-"));
  const promptFile = path.join(sandboxDir, "prompt.txt");
  const outputFile = path.join(sandboxDir, "output.txt");

  try {
    const combinedPrompt = buildCliCombinedPrompt(req.system, req.user, req.jsonMode);
    const plan = buildCliInvocationPlan({
      agentId: req.agentId,
      model: validModel.model,
      promptFile,
      outputFile,
      combinedPrompt,
      customArgs: parsedCustomArgs,
    });

    if (plan.needsPromptFile) {
      await writeFile(promptFile, combinedPrompt, "utf8");
    }

    const timeoutMs = req.timeoutMs ?? 240_000;
    const isWinCmdShim = isWin && /\.(cmd|bat)$/i.test(resolvedBin);

    const execResult = await new Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean; aborted: boolean }>(
      (resolve, reject) => {
        const child = isWinCmdShim
          ? spawn(
              process.env.ComSpec || "cmd.exe",
              ["/d", "/s", "/c", `"${[quoteWinCmdArg(resolvedBin), ...plan.args.map(quoteWinCmdArg)].join(" ")}"`],
              {
                cwd: sandboxDir,
                stdio: ["pipe", "pipe", "pipe"],
                windowsHide: true,
                windowsVerbatimArguments: true,
                env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
              },
            )
          : spawn(resolvedBin, plan.args, {
              cwd: sandboxDir,
              stdio: ["pipe", "pipe", "pipe"],
              shell: false,
              windowsHide: true,
              env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
            });

        let stdout = "";
        let stderr = "";
        let timedOut = false;
        let aborted = false;
        let lastReportAt = 0;

        const timer = setTimeout(() => {
          timedOut = true;
          terminateChildProcess(child.pid, () => child.kill("SIGTERM"));
        }, timeoutMs);

        const onAbort = () => {
          aborted = true;
          terminateChildProcess(child.pid, () => child.kill("SIGTERM"));
        };
        if (req.signal) {
          if (req.signal.aborted) {
            onAbort();
          } else {
            req.signal.addEventListener("abort", onAbort, { once: true });
          }
        }

        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");

        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
          const now = Date.now();
          if (req.onProgress && now - lastReportAt >= 250) {
            lastReportAt = now;
            req.onProgress({ contentChars: stdout.length, reasoningChars: 0 });
          }
        });
        child.stderr.on("data", (chunk: string) => {
          stderr += chunk;
        });

        child.on("error", (err) => {
          clearTimeout(timer);
          if (req.signal) req.signal.removeEventListener("abort", onAbort);
          reject(err);
        });

        child.on("close", (code) => {
          clearTimeout(timer);
          if (req.signal) req.signal.removeEventListener("abort", onAbort);
          resolve({ code, stdout, stderr, timedOut, aborted });
        });

        if (plan.stdinText !== null) {
          child.stdin.write(plan.stdinText, "utf8");
        }
        child.stdin.end();
      },
    );

    if (execResult.aborted) {
      return { ok: false, error: "已手动取消本次本机 Agent 提炼请求" };
    }
    if (execResult.timedOut) {
      return { ok: false, error: `本机 ${spec.name} 响应超时（>${Math.round(timeoutMs / 1000)}s），请检查是否需要交互登录或缩小样本范围` };
    }

    let rawContent = "";
    if (plan.outputFile && existsSync(plan.outputFile)) {
      rawContent = await readFile(plan.outputFile, "utf8").catch(() => "");
    }
    if (!rawContent.trim()) {
      rawContent = execResult.stdout;
    }

    const ndjson = parseNdjsonStreamOutput(rawContent);
    if (ndjson.recognized && ndjson.error && !ndjson.content) {
      return {
        ok: false,
        error: `${spec.name} 返回错误：${ndjson.error}`,
      };
    }

    const content = unwrapCliTextOutput(rawContent);
    if (execResult.code !== 0 && !content) {
      const errSnippet = stripAnsi(execResult.stderr || execResult.stdout).trim().slice(0, 320);
      return {
        ok: false,
        error: `${spec.name} 执行失败（退出码 ${execResult.code}）：${errSnippet || "请先在终端确认该 Agent 已完成账号登录"}`,
      };
    }

    if (!content) {
      const errSnippet = stripAnsi(execResult.stderr).trim().slice(0, 240);
      return {
        ok: false,
        error: `${spec.name} 返回了空内容${errSnippet ? `（${errSnippet}）` : "，请先在终端运行一次该 CLI 确认已登录授权"}`,
      };
    }

    req.onProgress?.({ contentChars: content.length, reasoningChars: 0 });
    const modelTag = validModel.model ? `cli:${spec.id}/${validModel.model}` : `cli:${spec.id}`;
    return {
      ok: true,
      content,
      model: modelTag,
      usage: ndjson.usage ?? { promptTokens: null, completionTokens: null },
    };
  } catch (err) {
    return {
      ok: false,
      error: `启动本机 ${spec.name} 失败：${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    await rm(sandboxDir, { recursive: true, force: true }).catch(() => {});
  }
}
