/** 整理画面群の構成(デザインの SCREENS / navItems に対応) */
export const ORGANIZE_GROUPS = [
  {
    label: "整理",
    screens: [
      { key: "inbox", label: "inbox" },
      { key: "assign", label: "3枠割り当て" },
    ],
  },
  {
    label: "予定",
    screens: [
      { key: "day", label: "カレンダー（日）" },
      { key: "week", label: "カレンダー（週）" },
    ],
  },
  {
    label: "一覧",
    screens: [
      { key: "projects", label: "プロジェクト" },
      { key: "waiting", label: "条件待ち" },
      { key: "someday", label: "いつか" },
      { key: "habits", label: "習慣" },
    ],
  },
] as const;

export type OrganizeScreenKey =
  (typeof ORGANIZE_GROUPS)[number]["screens"][number]["key"];

/** 折りたたみ中のナビに出すアイコン(デザインの NAVI。24px viewBox のパス) */
export const ORGANIZE_ICONS: Record<OrganizeScreenKey, string> = {
  inbox:
    "M4 13h4.5l1.5 3h4l1.5-3H20M5.5 6h13L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5z",
  assign: "M4 5h16M4 12h16M4 19h16M8 5v14",
  day: "M4.5 6.5h15v13h-15zM4.5 10.5h15M9 4v4M15 4v4",
  week: "M4.5 6.5h15v13h-15zM4.5 10.5h15M9 4v4M15 4v4M9.5 10.5v9M14.5 10.5v9",
  projects:
    "M3.5 7.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z",
  waiting: "M12 7.5V12l3 2M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0z",
  someday: "M5 8h14M5 8v10.5h14V8M5 8l1.5-3h11L19 8M10 12h4",
  habits:
    "M4 12a8 8 0 0 1 13.7-5.6L20 8.7M20 4v4.7h-4.7M20 12a8 8 0 0 1-13.7 5.6L4 15.3M4 20v-4.7h4.7",
};

export const DEFAULT_ORGANIZE_SCREEN: OrganizeScreenKey = "inbox";

export const ORGANIZE_SCREENS: readonly {
  key: OrganizeScreenKey;
  label: string;
}[] = ORGANIZE_GROUPS.flatMap((g) => [...g.screens]);

export function isOrganizeScreen(key: string): key is OrganizeScreenKey {
  return ORGANIZE_SCREENS.some((s) => s.key === key);
}

/** 詳細パネルを出す一覧系の画面(デザインの LISTK) */
const LIST_SCREENS: readonly OrganizeScreenKey[] = [
  "inbox",
  "projects",
  "waiting",
  "someday",
  "habits",
];

export const isListScreen = (key: OrganizeScreenKey) =>
  LIST_SCREENS.includes(key);

/** 日付ナビ(前へ/次へ/今日)を出す画面 */
export const hasDateNav = (key: OrganizeScreenKey) =>
  key === "assign" || key === "day" || key === "week";

export interface OrganizeCounts {
  inbox: number;
  assign: number;
  waiting: number;
  someday: number;
  habits: number;
}

/** ナビに出す件数。assign は日付未設定の next(完了済みを除く)。habits は有効な習慣(親)の数(一時停止中・終了を除く)。 */
export function countTasks(
  tasks: readonly { status: string; scheduled_date?: string | null }[],
  habits: readonly { active: boolean; ended?: boolean }[] = [],
): OrganizeCounts {
  const n = (f: (t: (typeof tasks)[number]) => boolean) =>
    tasks.filter(f).length;
  return {
    inbox: n((t) => t.status === "inbox"),
    assign: n((t) => t.status === "next" && !t.scheduled_date),
    waiting: n((t) => t.status === "waiting"),
    someday: n((t) => t.status === "someday"),
    habits: habits.filter((h) => h.active && !h.ended).length,
  };
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export const formatDay = (d: Date) =>
  `${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`;

export const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

/** 週の月曜日 */
export const mondayOf = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));

/** 日付ナビのラベル。週は「M月D日 – D日」。 */
export function dateNavLabel(key: OrganizeScreenKey, d: Date): string {
  if (key !== "week") return formatDay(d);
  const mon = mondayOf(d);
  const sun = addDays(mon, 6);
  return `${mon.getMonth() + 1}月${mon.getDate()}日 – ${sun.getDate()}日`;
}

/** 見出しの右に出す補足 */
export function screenSub(
  key: OrganizeScreenKey,
  counts: OrganizeCounts | null,
  date: Date,
): string {
  switch (key) {
    case "inbox":
      return counts ? `${counts.inbox}件 · 未整理` : "";
    case "assign":
      return counts ? `未割り当て ${counts.assign}件` : "";
    case "day":
      return formatDay(date);
    case "week": {
      const mon = mondayOf(date);
      return `${formatDay(mon)} – ${addDays(mon, 6).getDate()}日`;
    }
    case "waiting":
    case "someday":
      return counts ? `${counts[key]}件` : "";
    case "habits":
      return counts ? `${counts.habits}件 · 直近7回の実施状況` : "";
    default:
      return "";
  }
}
