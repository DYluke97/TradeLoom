# TradeLoom · 织脉 (Windows 便携包) — AI Agent 一键启动手册

本便携包内置完整 Node.js 运行时与 Next.js 生产服务，**无需目标机器安装 Node.js、pnpm 或 Docker**，可直接交给 Claude Code / Cursor / Antigravity / OpenClaw 等任意 AI Agent 一键启动。

## 1. 一键启动（非阻塞，自动后台常驻并输出 JSON）

```powershell
powershell -ExecutionPolicy Bypass -File .\start-agent.ps1
```

- 可选参数：`-Port 3200`（若 3200 被占用会自动顺延至 3201..3230）、`-OpenBrowser`（启动后自动打开浏览器）。
- 成功输出 JSON 示例：
  `{"ok":true,"reused":false,"url":"http://127.0.0.1:3200","ledgerUrl":"http://127.0.0.1:3200/ledger","pid":12345,"workspace":"..."}`

## 2. 健康检查与核心页面路由

- 健康检查：`GET http://127.0.0.1:<port>/api/vault` → HTTP `200`
- 总览工作台：`http://127.0.0.1:<port>/`
- 双链知识库 & 全息星图：`http://127.0.0.1:<port>/vault`
- A 股实盘账本 & K 线买卖点：`http://127.0.0.1:<port>/ledger`
- 阶段方法论提炼：`http://127.0.0.1:<port>/synthesize`
- 个人交易手册（二层树）：`http://127.0.0.1:<port>/manuals`
- 模型与 Skill 配置：`http://127.0.0.1:<port>/settings`

## 3. 一键停止后台服务

```powershell
powershell -ExecutionPolicy Bypass -File .\stop-agent.ps1
```

## 4. 本地数据与隐私边界

- 全部复盘原文、Obsidian 双链库、实盘账本与大模型 API Key 均仅保存在当前目录的 `workspace\` 下。
- 可直接在 Obsidian 桌面端选择「打开本地仓库」指向 `workspace\vault`。