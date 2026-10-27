"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { apiFetch } from "@/lib/api";
import { DEFAULT_FILTERS } from "@/lib/inbox";
import {
  ORGANIZE_GROUPS,
  ORGANIZE_SCREENS,
  addDays,
  countTasks,
  dateNavLabel,
  hasDateNav,
  isListScreen,
  screenSub,
  type OrganizeCounts,
  type OrganizeScreenKey,
} from "@/lib/organize";
import { OrganizeContext, type OrganizeProject } from "./OrganizeContext";
import { ThemeToggle } from "./ThemeToggle";
import { Toast, type ToastMessage } from "./Toast";
import { BrandLogo } from "./BrandLogo";
import styles from "./OrganizeShell.module.css";

const KEYS = [
  { k: "J / K", l: "移動" },
  { k: "X", l: "選択" },
  { k: "1", l: "次にやる" },
  { k: "2", l: "いつか" },
  { k: "3", l: "条件待ち" },
  { k: "4", l: "習慣" },
  { k: "N", l: "inboxに追加" },
  { k: "Esc", l: "選択解除" },
];

const STATUS_OPTIONS = [
  { v: "inbox", l: "未整理" },
  { v: "next", l: "次にやる" },
  { v: "waiting", l: "条件待ち" },
  { v: "someday", l: "いつか" },
  { v: "habit", l: "習慣" },
];

const PRIORITY_OPTIONS = ["高", "中", "低"];

const SORT_OPTIONS = [
  { v: "default", l: "並び順: 追加順" },
  { v: "pri", l: "優先度順" },
  { v: "est", l: "見積もりが短い順" },
  { v: "project", l: "プロジェクト順" },
];

const TOAST_MS = 4000;

const chevron = (d: string) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
  >
    <path d={d} />
  </svg>
);

/** 整理画面群の共通レイアウト(ナビ・見出し・ツールバー・本文・詳細パネル)。 */
export function OrganizeShell({
  children,
  onQuickAdd,
}: {
  children: ReactNode;
  onQuickAdd: () => void;
}) {
  const pathname = usePathname();
  const current = ORGANIZE_SCREENS.find(
    (s) => pathname === `/organize/${s.key}`,
  );
  const screen: OrganizeScreenKey = current?.key ?? "inbox";

  const [navOpen, setNavOpen] = useState(false);
  const [date, setDate] = useState(() => new Date());
  const [counts, setCounts] = useState<OrganizeCounts | null>(null);
  const [projects, setProjects] = useState<OrganizeProject[]>([]);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [panelEl, setPanelEl] = useState<HTMLElement | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showToast = useCallback((next: ToastMessage) => {
    clearTimeout(toastTimer.current);
    setToast(next);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const refreshCounts = useCallback(() => {
    apiFetch<{ status: string; scheduled_date?: string | null }[]>("/tasks")
      .then((tasks) => setCounts(countTasks(tasks)))
      .catch(() => {});
  }, []);

  const refreshProjects = useCallback(() => {
    apiFetch<OrganizeProject[]>("/projects")
      .then(setProjects)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshCounts();
    refreshProjects();
  }, [pathname, refreshCounts, refreshProjects]);

  // ナビを開いたまま画面を移動したら閉じる(モバイル)
  useEffect(() => setNavOpen(false), [pathname]);

  const step = screen === "week" ? 7 : 1;
  const hasFilter = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS);
  const list = isListScreen(screen);
  const sub = screenSub(screen, counts, date);

  const select = (
    key: keyof typeof filters,
    label: string,
    options: { v: string; l: string }[],
  ) => (
    <select
      key={key}
      className={styles.filter}
      value={filters[key]}
      aria-label={label}
      data-active={
        filters[key] !== "" && filters[key] !== "default" ? "" : undefined
      }
      onChange={(e) => setFilters({ ...filters, [key]: e.target.value })}
    >
      {options.map((o) => (
        <option key={o.v} value={o.v}>
          {o.l}
        </option>
      ))}
    </select>
  );

  const countOf = (key: OrganizeScreenKey) => {
    if (!counts || key === "projects" || key === "day" || key === "week")
      return "";
    return counts[key] || "";
  };

  return (
    <div className={styles.shell}>
      {navOpen && (
        <div className={styles.backdrop} onClick={() => setNavOpen(false)} />
      )}

      <nav
        className={styles.nav}
        data-open={navOpen ? "" : undefined}
        aria-label="メインナビゲーション"
      >
        <div className={styles.brand}>
          <BrandLogo />
          Focara
        </div>
        <Link href="/" className={styles.navLink}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
          >
            <path d="M7 5l11 7-11 7z" />
          </svg>
          実行画面
        </Link>
        <button className={styles.addButton} onClick={onQuickAdd}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>inboxに追加</span>
          <kbd className={styles.kbd}>N</kbd>
        </button>
        {ORGANIZE_GROUPS.map((g) => (
          <div key={g.label} className={styles.group}>
            <div className={styles.groupLabel}>{g.label}</div>
            {g.screens.map((s) => (
              <Link
                key={s.key}
                href={`/organize/${s.key}`}
                className={styles.navItem}
                aria-current={screen === s.key ? "page" : undefined}
              >
                <span>{s.label}</span>
                <span className={styles.count}>{countOf(s.key)}</span>
              </Link>
            ))}
          </div>
        ))}
        <div className={styles.spacer} />
        <ThemeToggle />
      </nav>

      <main className={styles.main}>
        <div className={styles.head}>
          <div className={styles.titleRow}>
            <button
              className={styles.menuButton}
              aria-label="メニュー"
              onClick={() => setNavOpen(true)}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
              >
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <div className={styles.titles}>
              <h1 className={styles.title}>{current?.label ?? "整理"}</h1>
              <span className={styles.sub}>{sub}</span>
            </div>
          </div>
          <div className={styles.toolbar}>
            {hasDateNav(screen) && (
              <div className={styles.dateNav}>
                <button
                  className={styles.iconButton}
                  aria-label="前へ"
                  onClick={() => setDate(addDays(date, -step))}
                >
                  {chevron("M15 6l-6 6 6 6")}
                </button>
                <span className={styles.dateLabel}>
                  {dateNavLabel(screen, date)}
                </span>
                <button
                  className={styles.iconButton}
                  aria-label="次へ"
                  onClick={() => setDate(addDays(date, step))}
                >
                  {chevron("M9 6l6 6-6 6")}
                </button>
                <button
                  className={styles.today}
                  onClick={() => setDate(new Date())}
                >
                  今日
                </button>
              </div>
            )}
            {list && (
              <>
                {select("status", "ステータス", [
                  { v: "", l: "ステータス: すべて" },
                  ...STATUS_OPTIONS,
                ])}
                {screen !== "projects" &&
                  select("project", "プロジェクト", [
                    { v: "", l: "プロジェクト: すべて" },
                    ...projects.map((p) => ({ v: String(p.id), l: p.name })),
                    { v: "none", l: "なし" },
                  ])}
                {select("pri", "優先度", [
                  { v: "", l: "優先度: すべて" },
                  ...PRIORITY_OPTIONS.map((p) => ({ v: p, l: p })),
                ])}
                {select("sort", "並び順", SORT_OPTIONS)}
                {hasFilter && (
                  <button
                    className={styles.clear}
                    onClick={() => setFilters(DEFAULT_FILTERS)}
                  >
                    絞り込みを解除
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        <div className={styles.content}>
          <OrganizeContext.Provider
            value={{
              filters,
              clearFilters: () => setFilters(DEFAULT_FILTERS),
              projects,
              refreshProjects,
              panelEl,
              date,
              setDate,
              refreshCounts,
              showToast,
              openQuickAdd: onQuickAdd,
            }}
          >
            {children}
          </OrganizeContext.Provider>
        </div>

        {screen === "inbox" && (
          <div className={styles.keys}>
            {KEYS.map((k) => (
              <span key={k.k} className={styles.key}>
                <kbd>{k.k}</kbd>
                {k.l}
              </span>
            ))}
          </div>
        )}
      </main>

      {list && (
        <aside className={styles.panel} ref={setPanelEl}>
          {screen !== "inbox" && (
            <div className={styles.panelEmpty}>
              行を選択すると
              <br />
              ここに詳細が表示されます
            </div>
          )}
        </aside>
      )}

      <Toast toast={toast} />

      <button
        className={styles.fab}
        onClick={onQuickAdd}
        aria-label="inboxに追加"
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  );
}
