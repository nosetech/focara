"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { OrganizeShell } from "./OrganizeShell";
import { QuickAdd } from "./QuickAdd";
import { ThemeToggle } from "./ThemeToggle";
import { Brand } from "./Brand";
import { ShellContext } from "./ShellContext";
import { SidebarToggle } from "./SidebarToggle";
import { useSidebarCollapse } from "./useSidebarCollapse";
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
  const side = useSidebarCollapse();

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

  // 実行画面はデザイン上サイドバーを持たない(操作はヘッダーに置く)
  const isRun = pathname === "/";

  return (
    <ShellContext.Provider value={{ openQuickAdd: () => setQuickAdd(true) }}>
      <div className={styles.shell} data-run={isRun ? "" : undefined}>
        <div
          className={styles.sidebarSlot}
          data-collapsed={side.collapsed ? "" : undefined}
        >
          <nav
            className={styles.sidebar}
            data-icon-only={side.iconOnly ? "" : undefined}
            data-peek={side.peek ? "" : undefined}
            aria-label="メインナビゲーション"
            onMouseEnter={side.collapsed ? side.onEnter : undefined}
            onMouseLeave={side.collapsed ? side.onLeave : undefined}
          >
            <Brand
              className={styles.brand}
              versionClassName={styles.brandVersion}
            />
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={styles.sideLink}
                title={item.label}
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
                <span className={styles.label}>{item.label}</span>
              </Link>
            ))}
            <button
              className={styles.sideLink}
              onClick={() => setQuickAdd(true)}
              title="inboxに追加(N)"
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
              <span className={styles.label}>inboxに追加</span>
              <kbd className={`${styles.kbd} ${styles.label}`}>N</kbd>
            </button>
            <div className={styles.spacer} />
            <ThemeToggle />
            <SidebarToggle
              collapsed={side.collapsed}
              onToggle={side.toggle}
              className={`${styles.themeButton} ${styles.collapseButton}`}
              labelClassName={styles.label}
            />
          </nav>
        </div>

        <main className={styles.main}>{children}</main>

        {!isRun && (
          <>
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
          </>
        )}

        {quickAdd && <QuickAdd onClose={() => setQuickAdd(false)} />}
      </div>
    </ShellContext.Provider>
  );
}
