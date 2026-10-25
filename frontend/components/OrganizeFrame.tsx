"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ORGANIZE_GROUPS, ORGANIZE_SCREENS } from "@/lib/organize";
import styles from "./OrganizeFrame.module.css";

/** 整理画面群の共通レイアウト。見出しと、一覧・カレンダーを並べられる広い領域を持つ。 */
export function OrganizeFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const current = ORGANIZE_SCREENS.find(
    (s) => pathname === `/organize/${s.key}`,
  );

  return (
    <div className={styles.frame}>
      <aside className={styles.subnav} aria-label="整理画面の切り替え">
        {ORGANIZE_GROUPS.map((g) => (
          <div key={g.label} className={styles.group}>
            <div className={styles.groupLabel}>{g.label}</div>
            {g.screens.map((s) => (
              <Link
                key={s.key}
                href={`/organize/${s.key}`}
                className={styles.subLink}
                aria-current={current?.key === s.key ? "page" : undefined}
              >
                {s.label}
              </Link>
            ))}
          </div>
        ))}
      </aside>
      <section className={styles.body}>
        <header className={styles.head}>
          <h1 className={styles.title}>{current?.label ?? "整理"}</h1>
        </header>
        <div className={styles.content}>{children}</div>
      </section>
    </div>
  );
}
