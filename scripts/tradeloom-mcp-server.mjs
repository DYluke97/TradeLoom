#!/usr/bin/env node
/**
 * TradeLoom Local MCP Server (stdio bridge -> local TradeLoom /api/mcp).
 * Zero external dependencies. Supports both newline-delimited JSON-RPC 2.0 (standard MCP stdio)
 * and Content-Length framed JSON-RPC messages.
 *
 * Environment variables:
 *   TRADELOOM_URL  Base URL of the local TradeLoom instance (default: http://127.0.0.1:3200)
 */

const BASE_URL = (process.env.TRADELOOM_URL || "http://127.0.0.1:3200").replace(/\/+$/, "");
const MCP_ENDPOINT = `${BASE_URL}/api/mcp`;

let rawBuffer = Buffer.alloc(0);
let useContentLengthFraming = false;

function writeMessage(obj) {
  const json = JSON.stringify(obj);
  if (useContentLengthFraming) {
    const body = Buffer.from(json, "utf8");
    process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
    process.stdout.write(body);
  } else {
    process.stdout.write(`${json}\n`);
  }
}

async function dispatchJsonRpc(payload) {
  let req;
  try {
    req = JSON.parse(payload);
  } catch {
    writeMessage({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Invalid JSON received on stdio" },
    });
    return;
  }

  // Notifications have no id and expect no response
  const isNotification = req && typeof req === "object" && !("id" in req);

  try {
    const res = await fetch(MCP_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(req),
    });

    if (res.status === 204 || res.status === 202) {
      return;
    }

    const text = await res.text();
    if (!text.trim()) return;

    const parsed = JSON.parse(text);
    if (!isNotification) {
      writeMessage(parsed);
    }
  } catch (err) {
    if (isNotification) return;
    const msg = err instanceof Error ? err.message : String(err);
    writeMessage({
      jsonrpc: "2.0",
      id: req?.id ?? null,
      error: {
        code: -32000,
        message: `无法连接本地 TradeLoom 服务 (${MCP_ENDPOINT})，请确认 TradeLoom 已启动：${msg}`,
      },
    });
  }
}

let queue = Promise.resolve();
function enqueue(payload) {
  queue = queue.then(() => dispatchJsonRpc(payload)).catch(() => {});
}

function drainBuffer() {
  while (rawBuffer.length > 0) {
    // Check for Content-Length framed message
    const headStr = rawBuffer.slice(0, Math.min(rawBuffer.length, 64)).toString("utf8");
    if (/^Content-Length:\s*\d+/i.test(headStr)) {
      useContentLengthFraming = true;
      const sepIdx = rawBuffer.indexOf("\r\n\r\n");
      const sepLen = sepIdx >= 0 ? 4 : rawBuffer.indexOf("\n\n") >= 0 ? 2 : -1;
      const headerEnd = sepIdx >= 0 ? sepIdx : rawBuffer.indexOf("\n\n");
      if (headerEnd < 0 || sepLen < 0) return;

      const headerText = rawBuffer.slice(0, headerEnd).toString("utf8");
      const m = /Content-Length:\s*(\d+)/i.exec(headerText);
      if (!m) {
        rawBuffer = rawBuffer.slice(headerEnd + sepLen);
        continue;
      }
      const len = Number(m[1]);
      const total = headerEnd + sepLen + len;
      if (rawBuffer.length < total) return;

      const body = rawBuffer.slice(headerEnd + sepLen, total).toString("utf8");
      rawBuffer = rawBuffer.slice(total);
      if (body.trim()) enqueue(body.trim());
      continue;
    }

    // Standard MCP newline-delimited JSON-RPC
    const nlIdx = rawBuffer.indexOf(0x0a);
    if (nlIdx < 0) return;
    const line = rawBuffer.slice(0, nlIdx).toString("utf8").trim();
    rawBuffer = rawBuffer.slice(nlIdx + 1);
    if (line) enqueue(line);
  }
}

process.stdin.on("data", (chunk) => {
  rawBuffer = Buffer.concat([rawBuffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
  drainBuffer();
});

process.stdin.on("error", () => {});
process.stdin.resume();
