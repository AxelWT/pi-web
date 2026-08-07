"use client";

import { useCallback, useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function getServerSnapshot(): Theme {
  return "light";
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggleTheme = useCallback(() => {
    const next: Theme = getSnapshot() === "dark" ? "light" : "dark";
    const root = document.documentElement;

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const animate = !reduceMotion;

    if (animate) {
      root.classList.add("theme-transition");
    }

    if (next === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    try {
      localStorage.setItem("pi-theme", next);
    } catch {
      // ignore storage errors (private mode, quota, etc.)
    }
    listeners.forEach((cb) => cb());

    if (animate) {
      window.setTimeout(() => root.classList.remove("theme-transition"), 220);
    }
  }, []);

  return { theme, toggleTheme, isDark: theme === "dark" };
}
