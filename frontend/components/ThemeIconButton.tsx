"use client";

import { useSyncExternalStore } from "react";
import { getResolvedTheme, setTheme, subscribeTheme } from "@/lib/theme";
import styles from "./ThemeIconButton.module.css";

/** ヘッダ右上に置くアイコンだけのテーマ切り替えボタン(実行画面・整理画面で共用)。 */
export function ThemeIconButton() {
  const theme = useSyncExternalStore(
    subscribeTheme,
    getResolvedTheme,
    () => null,
  );
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className={styles.button}
      onClick={() => setTheme(next)}
      aria-label="テーマ切替"
      suppressHydrationWarning
    >
      {theme === "dark" ? (
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
        </svg>
      )}
    </button>
  );
}
