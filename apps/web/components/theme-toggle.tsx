"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "dark" | "light";

const STORAGE_KEY = "aer-theme";

/** Inline, render-blocking script that sets the theme before first paint to avoid a flash. */
export const themeInitScript = `(()=>{try{var t=localStorage.getItem("${STORAGE_KEY}");var d=t?t==="dark":true;document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** SSR renders the dark default ("Security Console"); the init script reconciles before paint. */
function getServerSnapshot(): Theme {
  return "dark";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isDark = theme === "dark";

  function toggle() {
    const next: Theme = isDark ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable — toggle still applies for the session */
    }
    listeners.forEach((l) => l());
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${isDark ? "light" : "dark"} theme`}
      title={
        isDark
          ? "Security Console · switch to Archive Paper"
          : "Archive Paper · switch to Security Console"
      }
      className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground outline-none transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {isDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
    </button>
  );
}
