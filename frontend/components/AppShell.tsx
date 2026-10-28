"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { OrganizeShell } from "./OrganizeShell";
import { QuickAdd } from "./QuickAdd";
import { ThemeToggle } from "./ThemeToggle";
import { Brand } from "./Brand";
import styles from "./AppShell.module.css";

const NAV_ITEMS = [
  {
    href: "/",
    label: "実行",
    icon: <path d="M7 5l11 7-11 7z" />,
  },
  {
    href: "/organize",
    label: "整理",
    icon: <path d="M4 6h16M4 12h16M4 18h10" />,
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const [quickAdd, setQuickAdd] = useState(false);

  // デスクトップ: N キーでクイック追加を開く(入力中は無視)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "n" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.isComposing) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      setQuickAdd(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 整理画面群はデザイン固有のナビ・レイアウトを持つ
  if (pathname.startsWith("/organize")) {
    return (
      <>
        <OrganizeShell onQuickAdd={() => setQuickAdd(true)}>
          {children}
        </OrganizeShell>
        {quickAdd && <QuickAdd onClose={() => setQuickAdd(false)} />}
      </>
    );
  }

  return (
    <div className={styles.shell}>
      <nav className={styles.sidebar} aria-label="メインナビゲーション">
        <Brand
          className={styles.brand}
          nameClassName={styles.brandName}
          versionClassName={styles.brandVersion}
        />
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={styles.sideLink}
            aria-current={isActive(item.href) ? "page" : undefined}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              {item.icon}
            </svg>
            {item.label}
          </Link>
        ))}
        <button
          className={styles.sideLink}
          onClick={() => setQuickAdd(true)}
          aria-label="inboxに追加"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          inboxに追加
          <kbd className={styles.kbd}>N</kbd>
        </button>
        <div className={styles.spacer} />
        <ThemeToggle />
      </nav>

      <main className={styles.main}>{children}</main>

      <nav className={styles.bottomNav} aria-label="メインナビゲーション">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={styles.bottomLink}
            aria-current={isActive(item.href) ? "page" : undefined}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              {item.icon}
            </svg>
            {item.label}
          </Link>
        ))}
        <ThemeToggle />
      </nav>

      <button
        className={styles.fab}
        onClick={() => setQuickAdd(true)}
        aria-label="inboxに追加"
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      {quickAdd && <QuickAdd onClose={() => setQuickAdd(false)} />}
    </div>
  );
}
