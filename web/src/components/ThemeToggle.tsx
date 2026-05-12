"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { ThemePreference } from "@/lib/preferences";

const STORAGE_KEY = "gojo-theme";

function applyTheme(theme: ThemePreference) {
  document.documentElement.dataset.theme = theme;
}

function getStoredTheme(fallbackTheme: ThemePreference): ThemePreference {
  if (typeof window === "undefined") {
    return fallbackTheme;
  }
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : fallbackTheme;
}

function subscribe(callback: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      callback();
    }
  };

  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

export default function ThemeToggle({ initialTheme = "dark" }: { initialTheme?: ThemePreference }) {
  const theme = useSyncExternalStore(
    subscribe,
    () => getStoredTheme(initialTheme),
    () => initialTheme
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function setTheme(themeValue: ThemePreference) {
    applyTheme(themeValue);
    window.localStorage.setItem(STORAGE_KEY, themeValue);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: STORAGE_KEY,
        newValue: themeValue,
      }),
    );
  }

  function toggleTheme() {
    setTheme(theme === "dark" ? "light" : "dark");
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      <span className="theme-toggle__icon" aria-hidden="true">
        {theme === "dark" ? "◐" : "◑"}
      </span>
      <span>{theme === "dark" ? "Dark Mode" : "Light Mode"}</span>
    </button>
  );
}
