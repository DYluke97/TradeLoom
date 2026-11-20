import { readFile } from "node:fs/promises";
import { ensureWorkspace, fileExists, getWorkspacePaths, writeAtomic } from "./workspace";

export type ProviderConfig = {
  url: string;
  model: string;
  apiKey: string;
  label?: string;
};

export type MaskedProviderStatus = {
  configured: boolean;
  source: "local-file" | "env" | "none";
  url: string;
  model: string;
  label: string;
  hasApiKey: boolean;
  maskedKey: string;
};

export const PROVIDER_PRESETS = [
  {
    id: "deepseek",
    label: "DeepSeek",
    url: "https://api.deepseek.com/v1/chat/completions",
    model: "deepseek-chat",
  },
  {
    id: "openai",
    label: "OpenAI",
    url: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
  },
  {
    id: "siliconflow",
    label: "硅基流动 SiliconFlow",
    url: "https://api.siliconflow.cn/v1/chat/completions",
    model: "deepseek-ai/DeepSeek-V3",
  },
  {
    id: "ollama",
    label: "Ollama（本机模型，可留空 Key）",
    url: "http://127.0.0.1:11434/v1/chat/completions",
    model: "qwen2.5:14b",
  },
] as const;

export function validateProviderUrl(rawUrl: string): { ok: true; href: string; isLocal: boolean } | { ok: false; error: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) return { ok: false, error: "API 地址不能为空" };
  try {
    const parsed = new URL(trimmed);
    const isLocal =
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "::1";
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocal)) {
      return { ok: false, error: "仅允许 HTTPS 接口，或本机 http://127.0.0.1 / localhost" };
    }
    if (parsed.username || parsed.password) {
      return { ok: false, error: "请不要在 URL 中嵌入用户名或密码" };
    }
    return { ok: true, href: parsed.href, isLocal };
  } catch {
    return { ok: false, error: "API 地址不是合法的 URL" };
  }
}

export function maskSecret(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

export async function loadProviderConfig(): Promise<{ config: ProviderConfig | null; source: "local-file" | "env" | "none" }> {
  const { configFile } = getWorkspacePaths();
  if (await fileExists(configFile)) {
    try {
      const parsed = JSON.parse(await readFile(configFile, "utf8")) as { provider?: Partial<ProviderConfig> };
      const p = parsed.provider;
      if (p?.url && p?.model) {
        const valid = validateProviderUrl(p.url);
        if (valid.ok && (valid.isLocal || Boolean(p.apiKey))) {
          return {
            config: {
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
      return {
        config: { url: valid.href, model: envModel, apiKey: envKey, label: envModel },
        source: "env",
      };
    }
  }

  return { config: null, source: "none" };
}

export async function getMaskedProviderStatus(): Promise<MaskedProviderStatus> {
  const { config, source } = await loadProviderConfig();
  if (!config) {
    return {
      configured: false,
      source: "none",
      url: "",
      model: "",
      label: "",
      hasApiKey: false,
      maskedKey: "",
    };
  }
  return {
    configured: true,
    source,
    url: config.url,
    model: config.model,
    label: config.label || config.model,
    hasApiKey: Boolean(config.apiKey),
    maskedKey: maskSecret(config.apiKey),
  };
}

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
    apiKey = existing.config?.apiKey ?? "";
  }
  if (!validUrl.isLocal && !apiKey) {
    return { ok: false, error: "远程 HTTPS API 必须填写 API Key（本机 Ollama 可留空）" };
  }

  const paths = await ensureWorkspace();
  let existingDoc: Record<string, unknown> = {};
  if (await fileExists(paths.configFile)) {
    try {
      existingDoc = JSON.parse(await readFile(paths.configFile, "utf8")) as Record<string, unknown>;
    } catch {
      existingDoc = {};
    }
  }

  existingDoc.provider = {
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
}): Promise<ChatCompletionOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? 90_000);
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (args.config.apiKey) headers.Authorization = `Bearer ${args.config.apiKey}`;

    const body: Record<string, unknown> = {
      model: args.config.model,
      temperature: 0.2,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
    };
    if (args.jsonMode) {
      body.response_format = { type: "json_object" };
    }

    const res = await fetch(args.config.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      const safeSnippet = text.slice(0, 240).replace(args.config.apiKey || "___NONE___", "[REDACTED]");
      return { ok: false, error: `模型接口返回 HTTP ${res.status}：${safeSnippet}` };
    }

    const parsed = JSON.parse(text) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      return { ok: false, error: "模型返回了空内容" };
    }

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
    const msg = err instanceof Error ? err.message : String(err);
    const safeMsg = args.config.apiKey ? msg.replaceAll(args.config.apiKey, "[REDACTED]") : msg;
    return { ok: false, error: `请求大模型失败：${safeMsg}` };
  } finally {
    clearTimeout(timer);
  }
}
