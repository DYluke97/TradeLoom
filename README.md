# TradeLoom

> **将常年累月零散的复盘笔记（`.md / .txt / .docx / .html / .pdf`）汇聚为 Obsidian 双向链接知识库，按时间线阶段框选复盘样本，通过内置「短线博弈 / 基本面分析 Skill」配合你自配的大模型 API，沉淀不同阶段的方法演变时间轴与个人交易手册。**
>
> *Weave scattered trading reviews into an Obsidian bi-directional vault, methodology evolution timeline, and personal trading playbook.*

[![License: MIT](https://img.shields.io/badge/License-MIT-amber.svg)](./LICENSE)

---

## 核心特性

1. **多格式复盘汇聚 & 多年期 Obsidian 双链引擎（v2）**
   - 直接导入 `.md` / `.txt`（自动兼容 UTF-8 / GB18030 中文编码）/ `.docx` / `.html` / `.pdf`；
   - `.docx` / `.html` / `.txt` 自动转为干净 Markdown（保留原件至 `_inbox/`），`.pdf` 保留原件支持内嵌阅读并在提炼阶段按页提取文本；
   - **多年层级与自动概念聚拢**：即使常年积累的旧笔记没有手工 `#标签`，也会自动提取交易概念（情绪周期 / 退潮风控 / 买点结构 / 追高反例 / 行业景气 / 财务质量等）并生成标准 Obsidian 目录（`00-总览.md`、`10-时间轴/YYYY年.md`、`10-时间轴/YYYY-MM.md`、`10-每日/`、`20-卡片/`、`30-主题/`、`40-交易手册/`），既可在网页内浏览/安全编辑（SHA-256 乐观锁 + `.vault-history/` 自动备份），也可以直接用 **Obsidian 客户端**打开。
2. **Obsidian 桌面级视觉与交互工作台**
   - 复刻 Obsidian 标志性的暗黑工作台框架：左侧 44px 竖排 Ribbon + 顶部工作区标签栏 + 底部实时状态栏 + `Ctrl+K` 全局快速跳转面板；
   - 双链知识库内嵌 **可交互局部关系图谱（Local Graph）与全局关系图谱（Graph View）**，按节点类型分色，点击任意节点即刻跳转，并实时展示正向链接与反向链接（Backlinks）。
3. **时间线阶段框选 & 零消耗发送预检**
   - 支持按年份一键快捷框选、自定义日期区间与笔记类型筛选复盘样本；
   - 调用模型前先做 0 Token 预检，按 32,000 字上限整篇装箱（绝不截断半句），生成原文指纹与证据切片目录。
4. **内置可扩展 Skill 体系（`skills/*.md`）**
   - 内置 **短线博弈 Skill（五层判断链）**（情绪周期 / 主线梯队 / 个股身位 / 买点结构 / T+1 执行与反例）与 **基本面分析 Skill（五维框架）**（行业景气 / 商业壁垒 / 财务三表与现金流 / 估值锚 / 风险排雷与证伪）；
   - 任何人都可以在 `skills/` 目录新增 `.md` 文件扩展自己的交易流派（可转债、趋势波段、ETF 轮动等）。
5. **BYOK（自带 API Key）与 Local-First 隐私边界**
   - 无需数据库、无需注册账号；支持 DeepSeek、OpenAI、硅基流动、本机 Ollama 等所有 OpenAI-compatible 接口；
   - 你的复盘笔记、Obsidian Vault、交易手册与 API Key 全部保存在本地 `workspace/`（已写入 `.gitignore`）。
6. **强证据溯源防幻觉 & 手册自动回链 Vault**
   - 程序预先对原文切片生成 `evidence_id`，大模型只允许引用目录内 ID，服务端逐字回填引文并剔除无据条目；
   - 生成的「方法演变时间轴」与「个人交易手册」自动同步至 `workspace/vault/40-交易手册/`，与历史复盘卡片形成活体双向链接。

---

## 快速开始（1 分钟上手）

```bash
git clone <your-repo-url> tradeloom
cd tradeloom
pnpm install
pnpm dev
```

打开浏览器访问 `http://127.0.0.1:3200`：

1. 在首页点击 **「一键加载示例复盘库（6 篇）」**（纯合成脱敏样本），立即体验完整的 Obsidian 双链浏览与时间线框选；
2. 或直接前往 **「双链知识库」** 上传你自己的 `.md / .txt / .docx / .html / .pdf` 复盘笔记；
3. 前往 **「模型与 Skill」** 配置你的大模型 API Key（或本机 Ollama）并测试连通；
4. 前往 **「阶段提炼」** 框选时间段与 Skill，生成你的方法演变时间轴与个人交易手册。

---

## 目录结构

```text
tradeloom/
├── skills/                  # 内置与可扩展交易分析 Skill（Markdown + YAML frontmatter）
│   ├── short-term.md        # 短线博弈 Skill（五层判断链）
│   └── fundamental.md       # 基本面分析 Skill（五维框架）
├── samples/                 # 6 篇合成脱敏示例复盘笔记（跨度 2025-02 ~ 2025-10）
├── src/
│   ├── lib/
│   │   ├── convert.ts       # .md / .txt(GBK+UTF8) / .docx / .html 转换器
│   │   ├── pdf.ts           # PDF 逐页正文提取
│   │   ├── markdown.ts      # 安全 Markdown + [[双链]] + #标签解析器
│   │   ├── vault-builder.ts # 内置 Obsidian 双向链接知识库构建器
│   │   ├── vault.ts         # 知识库读写、导入、乐观锁安全编辑与备份
│   │   ├── skills.ts        # 动态 Skill 加载器
│   │   ├── provider.ts      # BYOK OpenAI-compatible 模型配置与调用
│   │   └── synthesis.ts     # 阶段预检、证据核验提炼与 Obsidian 手册导出
│   ├── app/                 # Next.js App Router 页面与 API
│   └── components/          # UI 组件
└── __tests__/               # Vitest 单元测试
```

---

## 环境变量（全部可选）

参考 [`.env.example`](./.env.example)：

- `TRADELOOM_WORKSPACE_DIR`：自定义本地工作区根目录（默认 `<repo>/workspace`）
- `TRADELOOM_SOURCE_DIR`：直接指向你现有的本地复盘笔记目录
- `TRADELOOM_LLM_URL` / `TRADELOOM_LLM_MODEL` / `TRADELOOM_LLM_API_KEY`：通过环境变量预配大模型（也可直接在网页 `/settings` 中填写）

---

## 开发与测试

```bash
pnpm typecheck   # TypeScript 严格类型检查
pnpm test        # 运行 Vitest 单元测试
pnpm build       # 生产构建校验
```

---

## 免责声明与开源协议

- 本项目仅用于个人复盘知识整理与方法论记录，不构成任何证券投资建议或买卖依据。
- 本项目采用 [MIT License](./LICENSE) 开源，欢迎二次开发与社区共建。
