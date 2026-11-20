import { Suspense } from "react";
import VaultWorkspace from "@/components/VaultWorkspace";

export default function VaultPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-sm text-[var(--ink-muted)]">正在打开双链知识库...</div>}>
      <VaultWorkspace />
    </Suspense>
  );
}
