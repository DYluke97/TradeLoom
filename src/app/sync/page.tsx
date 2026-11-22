import { Suspense } from "react";
import CloudConnectorsPanel from "@/components/CloudConnectorsPanel";

export default function SyncPage() {
  return (
    <Suspense fallback={<div className="py-10 text-center text-xs text-[var(--ink-dim)]">正在加载云端同步中心...</div>}>
      <CloudConnectorsPanel />
    </Suspense>
  );
}