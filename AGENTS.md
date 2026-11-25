# TradeLoom 项目顶层规则与协作记忆（AGENTS.md）

本文件位于仓库根目录，作为所有 AI Agent（Antigravity / Claude Code / Codex / OpenCode / Cursor 等）在 `E:\TradeLoom` 工作区内的顶层强约束与持续记忆。

---

## 1. 文件落盘与工作区边界（强约束）

- **一切文档与产物必须留在工作区 `E:\TradeLoom` 内**：
  - 设计方案、架构规划、评审文档、路线图等一律写入 `E:\TradeLoom\docs/`（如 `docs/v1.2-visual-and-graph-design-plan.md`）。
  - 辅助脚本写入 `E:\TradeLoom\scripts/`。
  - **禁止**将设计方案、报告或项目相关文件写入 C 盘 `.gemini` 对话产物目录（Artifact Dir）、系统 Temp 或桌面。
- 面向用户的本地运行时数据全部隔离在 `E:\TradeLoom\workspace/`（已被 `.gitignore` 忽略）。

---

## 2. 验证、重置与本地服务规范

- **完整校验闭环**：每次代码修改完成后，按顺序执行：
  1. `pnpm typecheck`（`tsc --noEmit`）
  2. `pnpm test`（`vitest run`）
  3. `pnpm build`（`next build`）
- **动线与交互调试默认清零重置**：
  - 涉及新手冷启动、引导动线、UI 改版或配置项调整时，构建完成后默认清零 `E:\TradeLoom\workspace` 下的本地库、复盘、账本与配置（`vaults/`、`.trash/`、`sources/`、`vault/`、`manuals/`、`vaults.json`、`config.json`、`connectors.json`、`concepts.json`、`ledger/ledger.json`），**仅保留 `ledger/market-cache` 行情缓存**，保证每次都从 `isFreshInstall: true` 从 0 体验。
- **常驻服务重启与实测**：
  - 本地服务监听 `http://127.0.0.1:3200`（`TRADELOOM_WORKSPACE_DIR=E:\TradeLoom\workspace`），须使用**常驻后台守护模式**启动，重启前确认彻底清理占用 3200 端口的旧 `node.exe` 进程，重启后实测核心页面与 API 返回 `200`。

---

## 3. 已拍板的产品与体验原则

- **零概念负担冷启动**：
  - 前端彻底隐藏「体验示范库」入口，新用户只面对自己的知识库；建库步骤不做交易流派强制选择题，默认激活 `default` 主库。
  - 保持 **多渠道纯入库（文件拖拽 / 粘贴正文 / 网页链接 / 两级云端同步中心）+ 全局唯一「开始织脉」按钮** 的分离设计。
  - 首次使用期间启用渐进式解锁导航（隐藏常规顶栏 Tab，直到产出第 1 份手册或用户主动点「跳过引导，展开全部菜单」）。
- **无 API 门槛与 Agent 优先**：
  - 凝练引擎保持 **3 条通路并列**：① 本机 CLI Agent 免 Key 直连（含 Claude / Codex / Gemini / ZCode / agy / OpenCode 等 16+ 款及自定义 CLI）；② 免 API 网页/订阅协作（一键复制提示词包 / 下载 `.txt` → 贴回防幻觉校验落库）；③ OpenAI 兼容 API（含 ZCode、火山引擎、阿里云、腾讯云、华为云、百度千帆、DeepSeek 及本机 Ollama / LM Studio）。
  - 持续维护 Local MCP Server（`/api/mcp` + `scripts/tradeloom-mcp-server.mjs`）与 `docs/tradeloom-agent-skill/SKILL.md`。
- **安全底线**：
  - 严禁向大模型发送绝对资金金额与券商账号（仅传脱敏百分比/比率）。
  - 本地 CLI Agent 调用必须在隔离空临时目录运行，长提示词走 `stdin` 或临时文件（规避 Windows 32KB 命令行上限并防 shell 注入）；ZCode 等默认高权限 CLI 必须显式指定只读模式（如 `--mode plan`）。
