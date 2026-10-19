"use client";

import { useSyncExternalStore } from "react";
import {
  getResolvedTheme,
  setTheme,
  subscribeTheme,
  type ThemeMode,
} from "@/lib/theme";
import styles from "./AppShell.module.css";

// SSR時は判定できないので、ハイドレーション後にクライアント側の値へ切り替わる
const getServerTheme = (): ThemeMode | null => null;

export function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribeTheme,
    getResolvedTheme,
    getServerTheme,
  );
  const next: ThemeMode = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className={styles.themeButton}
      onClick={() => setTheme(next)}
      aria-label={
        next === "dark" ? "ダークモードに切り替え" : "ライトモードに切り替え"
      }
      suppressHydrationWarning
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
      </svg>
      <span suppressHydrationWarning>
        {theme === "dark" ? "ライトモード" : "ダークモード"}
      </span>
    </button>
  );
}
