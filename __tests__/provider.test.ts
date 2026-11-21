import { describe, expect, it } from "vitest";
import { validateProviderUrl } from "@/lib/provider";

describe("provider URL validation & OpenAI base URL normalization", () => {
  it("normalizes root base URLs to /v1/chat/completions", () => {
    const r1 = validateProviderUrl("https://api.deepseek.com/");
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.href).toBe("https://api.deepseek.com/v1/chat/completions");

    const r2 = validateProviderUrl("http://127.0.0.1:11434");
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.isLocal).toBe(true);
      expect(r2.href).toBe("http://127.0.0.1:11434/v1/chat/completions");
    }
  });

  it("appends /chat/completions to versioned or OpenAI-compatible base paths", () => {
    const cases: Array<[string, string]> = [
      ["https://api.deepseek.com/v1", "https://api.deepseek.com/v1/chat/completions"],
      ["https://api.openai.com/v1/", "https://api.openai.com/v1/chat/completions"],
      ["https://dashscope.aliyuncs.com/compatible-mode/v1", "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"],
      ["https://ark.cn-beijing.volces.com/api/v3", "https://ark.cn-beijing.volces.com/api/v3/chat/completions"],
      ["https://open.bigmodel.cn/api/paas/v4", "https://open.bigmodel.cn/api/paas/v4/chat/completions"],
      ["https://generativelanguage.googleapis.com/v1beta/openai", "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"],
    ];
    for (const [input, expected] of cases) {
      const res = validateProviderUrl(input);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.href).toBe(expected);
    }
  });

  it("leaves full chat/completions endpoints unchanged and blocks insecure remote HTTP", () => {
    const full = validateProviderUrl("https://api.deepseek.com/v1/chat/completions");
    expect(full.ok).toBe(true);
    if (full.ok) expect(full.href).toBe("https://api.deepseek.com/v1/chat/completions");

    const insecure = validateProviderUrl("http://api.deepseek.com/v1/chat/completions");
    expect(insecure.ok).toBe(false);
  });
});
