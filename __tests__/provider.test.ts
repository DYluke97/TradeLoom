import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { saveProviderConfig, validateProviderUrl } from "@/lib/provider";
import { middleware } from "@/middleware";

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
      ["https://open.bigmodel.cn/api/coding/paas/v4", "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions"],
      ["https://api.z.ai/api/coding/paas/v4", "https://api.z.ai/api/coding/paas/v4/chat/completions"],
      ["https://api.hunyuan.cloud.tencent.com/v1", "https://api.hunyuan.cloud.tencent.com/v1/chat/completions"],
      ["https://api.lkeap.cloud.tencent.com/v1", "https://api.lkeap.cloud.tencent.com/v1/chat/completions"],
      ["https://api.modelarts-maas.com/v1", "https://api.modelarts-maas.com/v1/chat/completions"],
      ["https://api.modelarts-maas.com/openai/v1", "https://api.modelarts-maas.com/openai/v1/chat/completions"],
      ["https://qianfan.baidubce.com/v2", "https://qianfan.baidubce.com/v2/chat/completions"],
      ["https://api.moonshot.cn/v1", "https://api.moonshot.cn/v1/chat/completions"],
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

  it("refuses to reuse stored API key when switching provider origin and blocks cross-site/rebinding API calls", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "tradeloom-prov-"));
    const prev = process.env.TRADELOOM_WORKSPACE_DIR;
    process.env.TRADELOOM_WORKSPACE_DIR = tmp;
    try {
      const saved = await saveProviderConfig({
        url: "https://api.deepseek.com/v1/chat/completions",
        model: "deepseek-chat",
        apiKey: "sk-test-1234567890",
      });
      expect(saved.ok).toBe(true);

      // Same origin model switch is allowed to keep key
      const sameOrigin = await saveProviderConfig({
        url: "https://api.deepseek.com/v1/chat/completions",
        model: "deepseek-reasoner",
        keepExistingKey: true,
      });
      expect(sameOrigin.ok).toBe(true);

      // Different remote origin MUST NOT silently reuse old API key
      const diffOrigin = await saveProviderConfig({
        url: "https://evil.example.com/v1/chat/completions",
        model: "gpt-4o",
        keepExistingKey: true,
      });
      expect(diffOrigin.ok).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.TRADELOOM_WORKSPACE_DIR;
      else process.env.TRADELOOM_WORKSPACE_DIR = prev;
      await rm(tmp, { recursive: true, force: true });
    }

    // Middleware blocks DNS rebinding Host and cross-site CSRF mutations while allowing same-origin & clip token route
    const rebindReq = new NextRequest("http://127.0.0.1:3200/api/vault", {
      method: "GET",
      headers: { host: "attacker-rebind.com:3200" },
    });
    expect(middleware(rebindReq).status).toBe(403);

    const csrfReq = new NextRequest("http://127.0.0.1:3200/api/vaults", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3200",
        origin: "https://evil.example.com",
        "sec-fetch-site": "cross-site",
      },
    });
    expect(middleware(csrfReq).status).toBe(403);

    const sameOriginReq = new NextRequest("http://127.0.0.1:3200/api/vaults", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3200",
        origin: "http://127.0.0.1:3200",
        "sec-fetch-site": "same-origin",
      },
    });
    expect(middleware(sameOriginReq).status).toBe(200);

    const clipReq = new NextRequest("http://127.0.0.1:3200/api/vault/clip", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3200",
        origin: "https://xueqiu.com",
        "sec-fetch-site": "cross-site",
      },
    });
    expect(middleware(clipReq).status).toBe(200);
  });
});
