"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ThemeToggle } from "./ThemeToggle";
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

  return (
    <div className={styles.shell}>
      <nav className={styles.sidebar} aria-label="メインナビゲーション">
        <div className={styles.brand}>Focara</div>
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
    </div>
  );
}
