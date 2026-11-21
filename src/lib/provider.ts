import { randomBytes, timingSafeEqual } from "node:crypto";
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
  { id: "deepseek", label: "DeepSeek", url: "https://api.deepseek.com/v1/chat/completions", model: "deepseek-chat" },
  { id: "openai", label: "OpenAI", url: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini" },
  { id: "siliconflow", label: "硅基流动 SiliconFlow", url: "https://api.siliconflow.cn/v1/chat/completions", model: "deepseek-ai/DeepSeek-V3" },
  { id: "ollama", label: "Ollama（本机模型，可留空 Key）", url: "http://127.0.0.1:11434/v1/chat/completions", model: "qwen2.5:14b" },
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
      return { config: { url: valid.href, model: envModel, apiKey: envKey, label: envModel }, source: "env" };
    }
  }
  return { config: null, source: "none" };
}

export async function getMaskedProviderStatus(): Promise<MaskedProviderStatus> {
  const { config, source } = await loadProviderConfig();
  if (!config) {
    return { configured: false, source: "none", url: "", model: "", label: "", hasApiKey: false, maskedKey: "" };
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
  const existingDoc = await readWorkspaceConfigDoc();
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
  signal?: AbortSignal;
  onProgress?: (info: { contentChars: number; reasoningChars: number }) => void;
}): Promise<ChatCompletionOutcome> {
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