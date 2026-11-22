import type { Metadata } from "next";
import ObsidianShell from "@/components/ObsidianShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "TradeLoom · Obsidian 复盘双链知识库与个人交易手册工作台",
  description:
    "将零散复盘笔记汇聚为 Obsidian 双向链接知识库，按时间线阶段框选样本，配合内置短线/基本面 Skill 与自配大模型 API，沉淀方法演变时间轴与个人交易手册。",
};

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("tradeloom-theme");document.documentElement.dataset.theme=(t==="dark"||t==="light")?t:"light";}catch(e){document.documentElement.dataset.theme="light";}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="bg-[var(--bg)] text-[var(--ink)] antialiased">
        <ObsidianShell>{children}</ObsidianShell>
      </body>
    </html>
  );
}