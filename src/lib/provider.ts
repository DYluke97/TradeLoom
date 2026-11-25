import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  callLocalCliAgent,
  detectLocalCliAgents,
  getCliAgentSpec,
  parseCustomCliArgs,
  resolveExecutableOnHost,
  validateCliModel,
  type CliAgentId,
} from "./cli-agents";
import { ensureWorkspace, fileExists, getWorkspacePaths, writeAtomic } from "./workspace";

export type ProviderMode = "api" | "cli";

export type ProviderConfig = {
  mode?: ProviderMode;
  url: string;
  model: string;
  apiKey: string;
  label?: string;
  cliAgentId?: CliAgentId;
  cliBinPath?: string;
  cliCustomArgs?: string;
};

export type MaskedProviderStatus = {
  configured: boolean;
  mode: "api" | "cli" | "none";
  source: "local-file" | "env" | "none";
  url: string;
  model: string;
  label: string;
  hasApiKey: boolean;
  maskedKey: string;
  cliAgentId?: CliAgentId;
  cliAgentName?: string;
  cliBinPath?: string;
  cliCustomArgs?: string;
};

export type ProviderPresetGroup = "china-cloud" | "global" | "local";

export type ProviderPreset = {
  id: string;
  label: string;
  group: ProviderPresetGroup;
  url: string;
  model: string;
  note?: string;
};

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  // 国内主流云厂商 & 国产模型
  {
    id: "zcode",
    label: "ZCode（智谱 GLM Coding 套餐）",
    group: "china-cloud",
    url: "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions",
    model: "glm-5.3",
    note: "智谱国内站 GLM Coding / ZCode 专属端点，填入智谱开放平台 Coding API Key",
  },
  {
    id: "zhipu",
    label: "智谱开放平台（BigModel）",
    group: "china-cloud",
    url: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    model: "glm-4-plus",
    note: "智谱标准余额 / 资源包通用端点",
  },
  {
    id: "deepseek",
    label: "DeepSeek 官方",
    group: "china-cloud",
    url: "https://api.deepseek.com/v1/chat/completions",
    model: "deepseek-chat",
    note: "官方支持 deepseek-chat 与 deepseek-reasoner",
  },
  {
    id: "volcengine",
    label: "火山引擎方舟（豆包 Ark）",
    group: "china-cloud",
    url: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    model: "doubao-1-5-pro-32k-250115",
    note: "模型名可填方舟模型 ID（如 doubao-seed-... / deepseek-v3）或推理接入点 ID（ep-xxxx）",
  },
  {
    id: "aliyun",
    label: "阿里云百炼（通义千问）",
    group: "china-cloud",
    url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    model: "qwen-plus",
    note: "阿里云 DashScope OpenAI 兼容端点，可选 qwen-plus / qwen-max / deepseek-v3",
  },
  {
    id: "tencent-hunyuan",
    label: "腾讯云混元（Hunyuan）",
    group: "china-cloud",
    url: "https://api.hunyuan.cloud.tencent.com/v1/chat/completions",
    model: "hunyuan-turbos-latest",
    note: "腾讯云混元官方 OpenAI 兼容端点，可选 hunyuan-turbos-latest / hunyuan-t1-latest",
  },
  {
    id: "tencent-lkeap",
    label: "腾讯云知识引擎（LKEAP）",
    group: "china-cloud",
    url: "https://api.lkeap.cloud.tencent.com/v1/chat/completions",
    model: "deepseek-v3",
    note: "腾讯云大模型知识引擎（托管 DeepSeek-V3 / R1 等）",
  },
  {
    id: "huaweicloud",
    label: "华为云 ModelArts MaaS",
    group: "china-cloud",
    url: "https://api.modelarts-maas.com/v1/chat/completions",
    model: "deepseek-v3",
    note: "华为云 ModelArts Studio MaaS 平台（亦支持 /openai/v1 与控制台对应模型名）",
  },
  {
    id: "baidu-qianfan",
    label: "百度智能云千帆（Qianfan）",
    group: "china-cloud",
    url: "https://qianfan.baidubce.com/v2/chat/completions",
    model: "deepseek-v3",
    note: "百度千帆 V2 兼容端点（API Key 形如 bce-v3/...，支持 ERNIE 与 DeepSeek 系列）",
  },
  {
    id: "moonshot",
    label: "月之暗面 Kimi",
    group: "china-cloud",
    url: "https://api.moonshot.cn/v1/chat/completions",
    model: "moonshot-v1-auto",
    note: "超长中文上下文，支持 moonshot-v1-auto / kimi-k2 系列",
  },
  {
    id: "siliconflow",
    label: "硅基流动（含免费池）",
    group: "china-cloud",
    url: "https://api.siliconflow.cn/v1/chat/completions",
    model: "deepseek-ai/DeepSeek-V3",
    note: "国内高性价比聚合平台，包含部分免费推理模型",
  },
  // 国际与聚合通道
  {
    id: "openai",
    label: "OpenAI",
    group: "global",
    url: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
  },
  {
    id: "zcode-global",
    label: "ZCode / Z.ai 国际站",
    group: "global",
    url: "https://api.z.ai/api/coding/paas/v4/chat/completions",
    model: "glm-5.3",
    note: "Z.ai 国际站 Coding Plan 专属端点",
  },
  {
    id: "gemini-openai",
    label: "Google AI Studio（免费额度）",
    group: "global",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-2.5-flash",
  },
  {
    id: "openrouter",
    label: "OpenRouter（多模型/免费池）",
    group: "global",
    url: "https://openrouter.ai/api/v1/chat/completions",
    model: "deepseek/deepseek-chat-v3-0324:free",
  },
  // 本机免费模型（免 API Key）
  {
    id: "ollama",
    label: "Ollama（本机免费，免 Key）",
    group: "local",
    url: "http://127.0.0.1:11434/v1/chat/completions",
    model: "qwen2.5:14b",
    note: "本机离线推理，API Key 留空即可",
  },
  {
    id: "lmstudio",
    label: "LM Studio（本机免费，免 Key）",
    group: "local",
    url: "http://127.0.0.1:1234/v1/chat/completions",
    model: "local-model",
    note: "启动 LM Studio Local Server 后免 Key 直连",
  },
] as const;

export function normalizeChatCompletionsUrl(parsed: URL): URL {
  const out = new URL(parsed.href);
  const cleanPath = out.pathname.replace(/\/+$/, "");
  if (/\/(chat\/completions|completions|responses)$/i.test(cleanPath)) return out;
  if (cleanPath === "") {
    out.pathname = "/v1/chat/completions";
    return out;
  }
  if (/(\/v\d+(?:alpha\d*|beta\d*)?|\/openai|\/compatible-mode\/v\d+|\/api\/v\d+|\/api\/paas\/v\d+)$/i.test(cleanPath)) {
    out.pathname = `${cleanPath}/chat/completions`;
    return out;
  }
  return out;
}

export function validateProviderUrl(rawUrl: string): { ok: true; href: string; isLocal: boolean } | { ok: false; error: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) return { ok: false, error: "API 地址不能为空" };
  try {
    const parsed = new URL(trimmed);
    const isLocal = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1";
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocal)) {
      return { ok: false, error: "仅允许 HTTPS 接口，或本机 http://127.0.0.1 / localhost" };
    }
    if (parsed.username || parsed.password) {
      return { ok: false, error: "请不要在 URL 中嵌入用户名或密码" };
    }
    const normalized = normalizeChatCompletionsUrl(parsed);
    return { ok: true, href: normalized.href, isLocal };
  } catch {
    return { ok: false, error: "API 地址不是合法的 URL" };
  }
}

export function maskSecret(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

async function readWorkspaceConfigDoc(): Promise<Record<string, unknown>> {
  const { configFile } = getWorkspacePaths();
  if (await fileExists(configFile)) {
    try {
      return JSON.parse(await readFile(configFile, "utf8")) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

export async function getOrCreateClipToken(): Promise<string> {
  const paths = await ensureWorkspace();
  const doc = await readWorkspaceConfigDoc();
  if (typeof doc.clipToken === "string" && /^[a-f0-9]{32,64}$/i.test(doc.clipToken)) {
    return doc.clipToken;
  }
  const token = randomBytes(16).toString("hex");
  doc.clipToken = token;
  await writeAtomic(paths.configFile, JSON.stringify(doc, null, 2));
  return token;
}

export async function verifyClipToken(candidate: string | null | undefined): Promise<boolean> {
  if (!candidate || typeof candidate !== "string") return false;
  const expected = await getOrCreateClipToken();
  const a = Buffer.from(candidate.trim(), "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function loadProviderConfig(): Promise<{ config: ProviderConfig | null; source: "local-file" | "env" | "none" }> {
  const { configFile } = getWorkspacePaths();
  if (await fileExists(configFile)) {
    try {
      const parsed = JSON.parse(await readFile(configFile, "utf8")) as { provider?: Partial<ProviderConfig> };
      const p = parsed.provider;
      if (p?.mode === "cli" && p.cliAgentId) {
        const spec = getCliAgentSpec(p.cliAgentId);
        if (spec) {
          const model = (p.model ?? "").trim();
          return {
            config: {
              mode: "cli",
              url: `cli://${spec.id}`,
              model: model || spec.id,
              apiKey: "",
              label: (p.label ?? "").trim() || (model ? `${spec.name} (${model})` : spec.name),
              cliAgentId: spec.id,
              cliBinPath: (p.cliBinPath ?? "").trim() || undefined,
              cliCustomArgs: (p.cliCustomArgs ?? "").trim() || undefined,
            },
            source: "local-file",
          };
        }
      }
      if (p?.url && p?.model) {
        const valid = validateProviderUrl(p.url);
        if (valid.ok && (valid.isLocal || Boolean(p.apiKey))) {
          return {
            config: {
              mode: "api",
              url: valid.href,
              model: p.model.trim(),
              apiKey: (p.apiKey ?? "").trim(),
              label: (p.label ?? "").trim() || p.model.trim(),
            },
            source: "local-file",
          };
        }
      }
    } catch {
      /* fall through */
    }
  }

  const envUrl = process.env.TRADELOOM_LLM_URL?.trim();
  const envModel = process.env.TRADELOOM_LLM_MODEL?.trim();
  const envKey = process.env.TRADELOOM_LLM_API_KEY?.trim() ?? "";
  if (envUrl && envModel) {
    const valid = validateProviderUrl(envUrl);
    if (valid.ok && (valid.isLocal || Boolean(envKey))) {
      return { config: { mode: "api", url: valid.href, model: envModel, apiKey: envKey, label: envModel }, source: "env" };
    }
  }
  return { config: null, source: "none" };
}

export async function getMaskedProviderStatus(): Promise<MaskedProviderStatus> {
  const { config, source } = await loadProviderConfig();
  if (!config) {
    return {
      configured: false,
      mode: "none",
      source: "none",
      url: "",
      model: "",
      label: "",
      hasApiKey: false,
      maskedKey: "",
    };
  }
  if (config.mode === "cli" && config.cliAgentId) {
    const spec = getCliAgentSpec(config.cliAgentId);
    return {
      configured: true,
      mode: "cli",
      source,
      url: `cli://${config.cliAgentId}`,
      model: config.model === config.cliAgentId ? "" : config.model,
      label: config.label || spec?.name || config.cliAgentId,
      hasApiKey: false,
      maskedKey: "",
      cliAgentId: config.cliAgentId,
      cliAgentName: spec?.name ?? config.cliAgentId,
      cliBinPath: config.cliBinPath ?? "",
      cliCustomArgs: config.cliCustomArgs ?? "",
    };
  }
  return {
    configured: true,
    mode: "api",
    source,
    url: config.url,
    model: config.model,
    label: config.label || config.model,
    hasApiKey: Boolean(config.apiKey),
    maskedKey: maskSecret(config.apiKey),
  };
}

export async function saveCliAgentProviderConfig(input: {
  agentId: string;
  model?: string;
  binPath?: string;
  customArgs?: string;
}): Promise<{ ok: true; status: MaskedProviderStatus } | { ok: false; error: string }> {
  const spec = getCliAgentSpec(input.agentId);
  if (!spec) {
    return { ok: false, error: `不支持的本机 Agent 类型：${input.agentId}` };
  }

  const validModel = validateCliModel(input.model);
  if (!validModel.ok) return validModel;

  const customBin = (input.binPath ?? "").trim();
  const customArgs = (input.customArgs ?? "").trim();

  if (spec.id === "custom") {
    if (!customBin) {
      return { ok: false, error: "使用自定义本机 CLI 时请填写可执行命令或绝对路径" };
    }
    const parsedArgs = parseCustomCliArgs(customArgs);
    if (!parsedArgs.ok) return parsedArgs;
  }

  const isWin = process.platform === "win32";
  const extra = isWin ? (spec.extraPathsWin ?? []) : (spec.extraPathsPosix ?? []);
  const resolved = customBin
    ? resolveExecutableOnHost(customBin)
    : spec.id === "custom"
      ? null
      : resolveExecutableOnHost([...spec.binaries], extra);
  if (!resolved) {
    return {
      ok: false,
      error:
        spec.id === "custom"
          ? `本机未找到可执行文件：${customBin}`
          : `本机未检测到 ${spec.name}（${spec.binaries.join(" / ")}），请先安装或手动填写可执行路径`,
    };
  }

  const paths = await ensureWorkspace();
  const existingDoc = await readWorkspaceConfigDoc();
  existingDoc.provider = {
    mode: "cli",
    cliAgentId: spec.id,
    model: validModel.model,
    cliBinPath: customBin || undefined,
    cliCustomArgs: spec.id === "custom" ? customArgs : undefined,
    url: `cli://${spec.id}`,
    apiKey: "",
    label: validModel.model ? `${spec.name} (${validModel.model})` : spec.name,
    updatedAt: new Date().toISOString(),
  };

  await writeAtomic(paths.configFile, JSON.stringify(existingDoc, null, 2));
  return { ok: true, status: await getMaskedProviderStatus() };
}

export { detectLocalCliAgents };

export async function saveProviderConfig(input: {
  url: string;
  model: string;
  apiKey?: string;
  keepExistingKey?: boolean;
  label?: string;
}): Promise<{ ok: true; status: MaskedProviderStatus } | { ok: false; error: string }> {
  const validUrl = validateProviderUrl(input.url);
  if (!validUrl.ok) return validUrl;
  const model = input.model.trim();
  if (!model || model.length > 200) return { ok: false, error: "请填写有效的模型名称" };

  let apiKey = (input.apiKey ?? "").trim();
  if (input.keepExistingKey && !apiKey) {
    const existing = await loadProviderConfig();
    if (existing.config?.mode !== "cli" && existing.config?.url) {
      try {
        const oldOrigin = new URL(existing.config.url).origin.toLowerCase();
        const newOrigin = new URL(validUrl.href).origin.toLowerCase();
        if (oldOrigin === newOrigin) {
          apiKey = existing.config.apiKey ?? "";
        } else if (!validUrl.isLocal) {
          return { ok: false, error: "更换 API 服务域名时请重新填写对应的 API Key（防止旧密钥跨域名外发）" };
        }
      } catch {
        /* require fresh key below */
      }
    }
  }
  if (!validUrl.isLocal && !apiKey) {
    return { ok: false, error: "远程 HTTPS API 必须填写 API Key（本机 Ollama / LM Studio 可留空）" };
  }

  const paths = await ensureWorkspace();
  const existingDoc = await readWorkspaceConfigDoc();
  existingDoc.provider = {
    mode: "api",
    url: validUrl.href,
    model,
    apiKey,
    label: (input.label ?? "").trim() || model,
    updatedAt: new Date().toISOString(),
  };

  await writeAtomic(paths.configFile, JSON.stringify(existingDoc, null, 2));
  return { ok: true, status: await getMaskedProviderStatus() };
}

export type ChatCompletionOutcome =
  | {
      ok: true;
      content: string;
      model: string;
      usage: { promptTokens: number | null; completionTokens: number | null };
    }
  | { ok: false; error: string };

export async function callChatCompletion(args: {
  config: ProviderConfig;
  system: string;
  user: string;
  jsonMode?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (info: { contentChars: number; reasoningChars: number }) => void;
}): Promise<ChatCompletionOutcome> {
  if (args.config.mode === "cli" && args.config.cliAgentId) {
    const cliModel = args.config.model && args.config.model !== args.config.cliAgentId ? args.config.model : "";
    return callLocalCliAgent({
      agentId: args.config.cliAgentId,
      system: args.system,
      user: args.user,
      model: cliModel,
      binPath: args.config.cliBinPath,
      customArgs: args.config.cliCustomArgs,
      jsonMode: args.jsonMode,
      timeoutMs: args.timeoutMs ?? 240_000,
      signal: args.signal,
      onProgress: args.onProgress,
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? 150_000);
  const onExternalAbort = () => controller.abort();
  if (args.signal) {
    if (args.signal.aborted) controller.abort();
    else args.signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (args.config.apiKey) headers.Authorization = `Bearer ${args.config.apiKey}`;

    const useStream = Boolean(args.onProgress);
    const body: Record<string, unknown> = {
      model: args.config.model,
      temperature: 0.2,
      stream: useStream,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
    };
    if (args.jsonMode) body.response_format = { type: "json_object" };

    const res = await fetch(args.config.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      const safeSnippet = text.slice(0, 240).replace(args.config.apiKey || "___NONE___", "[REDACTED]");
      const modelHint = /model\s*not\s*exist|model_not_found/i.test(safeSnippet)
        ? "（提示：请检查「设置」中的模型名称，例如 DeepSeek 官方为 deepseek-chat 或 deepseek-reasoner）"
        : "";
      return { ok: false, error: `模型接口返回 HTTP ${res.status}：${safeSnippet}${modelHint}` };
    }

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    if (useStream && res.body && contentType.includes("text/event-stream")) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let content = "";
      let reasoningChars = 0;
      let promptTokens: number | null = null;
      let completionTokens: number | null = null;
      let lastReportAt = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const chunk = JSON.parse(payload) as {
              choices?: { delta?: { content?: string; reasoning_content?: string }; message?: { content?: string } }[];
              usage?: { prompt_tokens?: number; completion_tokens?: number };
            };
            const delta = chunk.choices?.[0]?.delta;
            if (typeof delta?.reasoning_content === "string") reasoningChars += delta.reasoning_content.length;
            if (typeof delta?.content === "string") content += delta.content;
            else if (typeof chunk.choices?.[0]?.message?.content === "string") content += chunk.choices[0].message.content;
            if (typeof chunk.usage?.prompt_tokens === "number") promptTokens = chunk.usage.prompt_tokens;
            if (typeof chunk.usage?.completion_tokens === "number") completionTokens = chunk.usage.completion_tokens;

            const now = Date.now();
            if (args.onProgress && now - lastReportAt >= 250) {
              lastReportAt = now;
              args.onProgress({ contentChars: content.length, reasoningChars });
            }
          } catch {
            /* ignore SSE comment */
          }
        }
      }
      args.onProgress?.({ contentChars: content.length, reasoningChars });
      if (!content.trim()) return { ok: false, error: "模型流式返回了空内容" };
      return { ok: true, content, model: args.config.model, usage: { promptTokens, completionTokens } };
    }

    const text = await res.text();
    const parsed = JSON.parse(text) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) return { ok: false, error: "模型返回了空内容" };
    args.onProgress?.({ contentChars: content.length, reasoningChars: 0 });
    return {
      ok: true,
      content,
      model: args.config.model,
      usage: {
        promptTokens: typeof parsed.usage?.prompt_tokens === "number" ? parsed.usage.prompt_tokens : null,
        completionTokens: typeof parsed.usage?.completion_tokens === "number" ? parsed.usage.completion_tokens : null,
      },
    };
  } catch (err) {
    if (args.signal?.aborted) return { ok: false, error: "已手动取消本次提炼请求" };
    const msg = err instanceof Error ? err.message : String(err);
    const safeMsg = args.config.apiKey ? msg.replaceAll(args.config.apiKey, "[REDACTED]") : msg;
    return { ok: false, error: `请求大模型失败：${safeMsg}` };
  } finally {
    clearTimeout(timer);
    if (args.signal) args.signal.removeEventListener("abort", onExternalAbort);
  }
}