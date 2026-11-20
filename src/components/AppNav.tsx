"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Compass, FolderGit2, Layers, Settings } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "总览", icon: Compass },
  { href: "/vault", label: "双链知识库", icon: FolderGit2 },
  { href: "/synthesize", label: "阶段提炼", icon: Layers },
  { href: "/manuals", label: "交易手册", icon: BookOpen },
  { href: "/settings", label: "模型与 Skill", icon: Settings },
];

export default function AppNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--accent)]/40 bg-[var(--accent-soft)] text-sm font-bold text-[var(--accent)]">
            TL
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-wide text-[var(--ink)]">TradeLoom</div>
            <div className="hidden text-[11px] text-[var(--ink-muted)] sm:block">
              复盘双链知识库 · 方法论沉淀工作台
            </div>
          </div>
        </Link>

        <nav className="flex items-center gap-1 overflow-x-auto">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition ${
                  active
                    ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)] ring-1 ring-[var(--accent)]/30"
                    : "text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        <span className="hidden rounded-full border border-[var(--border)] px-2.5 py-0.5 text-[11px] text-[var(--ink-dim)] md:inline-block">
          MIT · Local-First
        </span>
      </div>
    </header>
  );
}
