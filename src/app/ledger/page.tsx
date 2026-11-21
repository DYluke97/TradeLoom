import { Suspense } from "react";
import LedgerWorkspace from "@/components/LedgerWorkspace";

export default function LedgerPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center text-xs text-[var(--ink-muted)]">
          正在加载实盘投资账本...
        </div>
      }
    >
      <LedgerWorkspace />
    </Suspense>
  );
}