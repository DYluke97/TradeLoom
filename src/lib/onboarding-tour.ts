"use client";

import { useEffect, useState } from "react";

export const TOUR_ACTIVE_KEY = "tradeloom-tour-active";
export const TOUR_DISMISSED_KEY = "tradeloom-tour-dismissed";
export const TOUR_EVENT = "tradeloom:tour-changed";

export function isTourDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(TOUR_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function isTourActive(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (sessionStorage.getItem(TOUR_DISMISSED_KEY) === "1") return false;
    return sessionStorage.getItem(TOUR_ACTIVE_KEY) === "1";
  } catch {
    return false;
  }
}

export function startGuidedTour(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(TOUR_DISMISSED_KEY);
    sessionStorage.setItem(TOUR_ACTIVE_KEY, "1");
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(TOUR_EVENT, { detail: { active: true, dismissed: false } }));
}

export function endGuidedTour(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(TOUR_ACTIVE_KEY);
    sessionStorage.setItem(TOUR_DISMISSED_KEY, "1");
    // Strip ?tour=1 from current URL cleanly so URL searchParams never re-lock the tour bar
    const url = new URL(window.location.href);
    if (url.searchParams.has("tour")) {
      url.searchParams.delete("tour");
      const next = `${url.pathname}${url.searchParams.toString() ? `?${url.searchParams.toString()}` : ""}${url.hash}`;
      window.history.replaceState(null, "", next);
    }
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(TOUR_EVENT, { detail: { active: false, dismissed: true } }));
}

export function useTourDismissed(): boolean {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(isTourDismissed());
    const onChange = (e: Event) => {
      const custom = e as CustomEvent<{ dismissed?: boolean }>;
      if (typeof custom.detail?.dismissed === "boolean") {
        setDismissed(custom.detail.dismissed);
      } else {
        setDismissed(isTourDismissed());
      }
    };
    window.addEventListener(TOUR_EVENT, onChange);
    return () => window.removeEventListener(TOUR_EVENT, onChange);
  }, []);

  return dismissed;
}

export function useGuidedTour(paramTour = false): boolean {
  const [active, setActive] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const alreadyDismissed = isTourDismissed();
    setDismissed(alreadyDismissed);

    if (paramTour && !alreadyDismissed) {
      startGuidedTour();
      setActive(true);
    } else {
      setActive(isTourActive());
    }

    const onChange = (e: Event) => {
      const custom = e as CustomEvent<{ active?: boolean; dismissed?: boolean }>;
      if (typeof custom.detail?.dismissed === "boolean") {
        setDismissed(custom.detail.dismissed);
      } else {
        setDismissed(isTourDismissed());
      }
      if (typeof custom.detail?.active === "boolean") {
        setActive(custom.detail.active);
      } else {
        setActive(isTourActive());
      }
    };
    window.addEventListener(TOUR_EVENT, onChange);
    return () => window.removeEventListener(TOUR_EVENT, onChange);
  }, [paramTour]);

  if (dismissed) return false;
  return active || paramTour;
}
