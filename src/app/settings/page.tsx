import { Suspense } from "react";
import SettingsWorkspace from "@/components/SettingsWorkspace";

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-sm text-[var(--ink-muted)]">正在加载设置面板...</div>}>
      <SettingsWorkspace />
    </Suspense>
  );
}
