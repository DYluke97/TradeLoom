"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const SESSION_KEY = "tradeloom-intro-seen";

export default function BrandSplashIntro({
  replaySignal = 0,
  onDone,
}: {
  replaySignal?: number;
  onDone?: () => void;
}) {
  const [phase, setPhase] = useState<"hidden" | "playing" | "exiting">("hidden");
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const dismiss = useCallback(() => {
    setPhase("exiting");
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      /* ignore */
    }
    window.setTimeout(() => {
      setPhase("hidden");
      onDoneRef.current?.();
    }, 280);
  }, []);

  useEffect(() => {
    const forceReplay = replaySignal > 0;
    let alreadySeen = false;
    try {
      alreadySeen = sessionStorage.getItem(SESSION_KEY) === "1";
    } catch {
      /* ignore */
    }

    if (alreadySeen && !forceReplay) {
      setPhase("hidden");
      return;
    }

    setPhase("playing");
    const exitTimer = window.setTimeout(() => {
      setPhase("exiting");
    }, 1550);
    const hideTimer = window.setTimeout(() => {
      setPhase("hidden");
      try {
        sessionStorage.setItem(SESSION_KEY, "1");
      } catch {
        /* ignore */
      }
      onDoneRef.current?.();
    }, 2000);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(hideTimer);
    };
  }, [replaySignal]);

  useEffect(() => {
    if (phase === "hidden") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === " " || e.key === "Enter") {
        dismiss();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, dismiss]);

  if (phase === "hidden") return null;

  return (
    <div
      role="dialog"
      aria-label="TradeLoom 开场动画"
      onClick={dismiss}
      className={`fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-[#0b0d12] text-[#f2f5fa] transition-opacity duration-500 ${
        phase === "exiting" ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      {/* Subtle architectural dot backdrop */}
      <div
        className="pointer-events-none absolute inset-0 opacity-45"
        style={{
          backgroundImage: "radial-gradient(rgba(148,163,184,0.16) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />
      <div className="pointer-events-none absolute top-1/2 left-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#5b9bff]/22 blur-3xl" />

      <div className="relative flex flex-col items-center px-6 text-center select-none">
        {/* Animated Weaving Prism Mark (Machined Square Frame) */}
        <svg viewBox="0 0 120 120" className="h-24 w-24" aria-hidden="true">
          {/* Outer sharp architectural frame */}
          <rect
            x="14"
            y="14"
            width="92"
            height="92"
            rx="6"
            fill="#11141c"
            stroke="#5b9bff"
            strokeOpacity="0.65"
            strokeWidth="1.6"
            style={{ ["--dash-len" as string]: "380" }}
            className="tl-draw-stroke"
          />
          {/* Crosshair T loom warp & weft */}
          <path
            d="M36 40h48M60 40v42"
            fill="none"
            stroke="#f4f6fa"
            strokeWidth="3.8"
            strokeLinecap="square"
            style={{ ["--dash-len" as string]: "110", animationDelay: "180ms" }}
            className="tl-draw-stroke"
          />
          {/* Ascending woven signal curve */}
          <path
            d="M34 78l16-14 16 10 20-21"
            fill="none"
            stroke="#5b9bff"
            strokeWidth="3.4"
            strokeLinecap="square"
            strokeLinejoin="miter"
            style={{ ["--dash-len" as string]: "130", animationDelay: "360ms" }}
            className="tl-draw-stroke"
          />
          {/* Three glowing pillar nodes */}
          <circle cx="34" cy="78" r="3.4" fill="#5b9bff" className="tl-node-pop" style={{ animationDelay: "520ms" }} />
          <circle cx="66" cy="74" r="3.4" fill="#f5a623" className="tl-node-pop" style={{ animationDelay: "660ms" }} />
          <circle cx="86" cy="53" r="4.2" fill="#2dd4bf" className="tl-node-pop" style={{ animationDelay: "800ms" }} />
        </svg>

        <div className="tl-fade-up mt-5" style={{ animationDelay: "420ms" }}>
          <div className="flex items-center justify-center gap-2.5">
            <span className="text-2xl font-light tracking-[0.08em] text-[#f4f6fa] sm:text-3xl">TradeLoom</span>
            <span className="rounded-[2px] border border-[#5b9bff]/40 bg-[#5b9bff]/12 px-2 py-0.5 text-[11px] font-normal tracking-[0.22em] text-[#93c0ff]">
              织脉
            </span>
          </div>
          <p className="mt-2.5 text-xs font-light tracking-[0.08em] text-[#96a2b6] sm:text-sm">
            把零散复盘，织成经得起实盘检验的交易系统
          </p>
        </div>

        <div className="tl-fade-up mt-7 flex items-center gap-2 font-mono text-[10px] tracking-widest text-[#6b7485]" style={{ animationDelay: "700ms" }}>
          <span>NOTES</span>
          <span>×</span>
          <span>LEDGER</span>
          <span>×</span>
          <span>PLAYBOOK</span>
        </div>

        <span className="mt-8 text-[11px] text-[#6b7485]/80">点击任意位置跳过</span>
      </div>
    </div>
  );
}
