# TradeLoom · 织脉 `v1.2.0` 正式版发布说明（曜石终端与 Agent 原生版）

> **Local-First 投研复盘双链知识库 × A 股实盘投资账本 × Agent 原生交易方法论演化引擎**

- **Windows 免安装绿色便携包**：`TradeLoom-v1.2.0-win-x64.zip`（**63.17 MB**，内置独立 `Node.js` 运行时、原生无黑框 `TradeLoom.exe` 启动器，以及完整 Local MCP Server 桥接脚本与标准 `SKILL.md`）
- **隐私门禁校验**：`workspace=0 files`、`symlinks=0`（严格排除一切个人笔记、实盘交割单与 API Key）
- **SHA-256 校验值**：`7e0d1d4a3a278568f994ae9fe5d8c3eba5ea7ae185a803ca8b49c644288d8eb9`

---

## `v1.2.0` 核心升级一览

### 1. 曜石投研终端质感 × 方正极细精密排版
- 默认启用 **Obsidian 曜石暗色投研终端**（顶栏一键切换温润纸本亮色主题），确立独立的 4 通道语义色板：**复盘钴蓝 / 概念青绿 / 实盘琥珀 / 手册翡翠 / 风控珊瑚红**。
- 全站收紧为 **`2px–4px` 方正锐利倒角**，去圆弧、去冗杂装饰，配合轻量化细笔画字体层级与 `tabular-nums` 等宽量化数字对齐，凸显专业投研终端质感。

### 2. 100% 全画幅沉浸星图 × 右侧玻璃预览抽屉（`/vault?view=graph`）
- 进入星图视图自动收折左右固定边栏与冗余小图谱，释放 100% 全视口 **4 环同心星轨双链图谱**（`中心总览 MOC → 主题星核环 → 年度档案环 → 月度时间索引环 → 复盘原件外环`）。
- 新增 **悬浮玻璃 HUD**、**节点即时搜索定位**、曲线引力脉冲连线与绽放入场动效。
- **单击节点**直接从右侧滑出 **380px 悬浮玻璃预览抽屉**（同屏查看复盘正文、当日实盘交割锚点与相连节点漫游胶囊，不打断星图浏览）；**双击节点**或点按钮切入完整阅读与编辑模式。

### 3. 零 API 门槛：三通路 AI 凝练引擎（16+ 本机 CLI Agent + 免 API 协作 + 17 项云厂商 API）
- **① 本机 CLI Agent 免 Key 直连（16 款内置 + 自定义模板）**：自动扫描本机已安装的 **Claude Code、OpenAI Codex CLI、Gemini CLI、Antigravity CLI（`agy` 原生 `--input-format stream-json --output-format stream-json` 无上限标准输入通道）、ZCode CLI（`--mode plan` 只读沙盒）、Cursor Agent、OpenCode、Kimi CLI、Qwen Code、腾讯 CodeBuddy、iFlow、OpenClaw、GitHub Copilot、Goose、AWS Kiro、Aider** 及**自定义本机 CLI**，直接复用现有订阅额度凝练手册。
- **② 免 API 网页 / 订阅协作闭环**：在 `/synthesize` 一键复制完整证据提示词包或下载 `.txt` 附件发给 ChatGPT / Claude / DeepSeek / Kimi / 豆包网页版，粘贴回复后自动完成容错 JSON 提取与服务端 `evidence_id` 逐字防幻觉校验落盘。
- **③ 17 项国内主流云厂商与本机模型 API 预设**：新增 **ZCode（智谱 GLM Coding 套餐国内/国际站）、火山引擎方舟 Ark、阿里云百炼、腾讯云混元 & LKEAP、华为云 ModelArts MaaS、百度千帆、月之暗面 Kimi、Google AI Studio、OpenRouter**，以及免 Key 的本机 **Ollama / LM Studio**。

### 4. 外部 Agent 双向接入（Local MCP Server + 标准 `SKILL.md`）
- 原生提供 **Streamable HTTP MCP（`http://127.0.0.1:3200/api/mcp`）** 与零依赖 **Stdio 桥接脚本（`scripts/tradeloom-mcp-server.mjs`）**，开放 9 个标准 MCP 工具，支持外部 AI Agent 直接检索知识库、读取实盘绩效、写入复盘文档、拉取证据包并提交防幻觉交易手册。
- 新增 `docs/tradeloom-agent-skill/SKILL.md` 通用 Agent 技能包，在设置页提供一键复制本机真实路径 JSON 配置与在线连通自检。

### 5. 单次提炼容量 6.25× 大幅扩容
- 单次外发装箱字数上限从 `80,000` 字大幅提升至 **默认 `500,000` 字**，并在工作台提供 **四档容量切换（20 万 / 50 万 / 120 万 / 300 万字全量）**，单次勾选文档上限扩至 **1,500 篇**，充分适配 200K–1M+ 长上下文大模型。

### 6. 零概念负担冷启动与渐进式引导体验修复
- 隐藏示范库心智负担，冷启动呈现全新品牌织脉开场动画 → 极简命名激活主库 → 大画幅多渠道累计入库 + 全局唯一「开始织脉」按钮 → 两级云端同步中心（9 平台卡片矩阵 → 单平台同步专页）。
- 修复渐进式引导顶栏「跳过引导，展开全部菜单」在 `?tour=1` 下点击无效的问题，现可一键即时展开完整顶栏菜单并记住用户偏好。

---

## Windows 便携版 30 秒上手 / 无损升级

1. 下载 `TradeLoom-v1.2.0-win-x64.zip` 并**完整解压到普通目录**（如桌面或 `D:\TradeLoom`）。
2. 双击 **`TradeLoom.exe`**，2~5 秒后自动拉起本地引擎并打开独立桌面窗口。
3. **从 `v1.0.0` 无损升级**：将旧版本目录下的 `workspace\` 文件夹整体复制到新版解压目录即可无损继承全部复盘、双链、实盘账本、连接器授权与交易手册。
