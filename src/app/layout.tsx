import type { Metadata } from "next";
import AppNav from "@/components/AppNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "TradeLoom · 交易复盘双链知识库与方法论沉淀工作台",
  description:
    "将零散复盘笔记汇聚为 Obsidian 双向链接知识库，按时间线阶段框选样本，配合内置短线/基本面 Skill 与自配大模型 API，沉淀方法演变时间轴与个人交易手册。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
        <AppNav />
        <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
