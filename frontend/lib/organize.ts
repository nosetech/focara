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

/** ナビに出す件数。assign は日付未設定の next(完了済みを除く)。 */
export function countTasks(
  tasks: readonly { status: string; scheduled_date?: string | null }[],
): OrganizeCounts {
  const n = (f: (t: (typeof tasks)[number]) => boolean) =>
    tasks.filter(f).length;
  return {
    inbox: n((t) => t.status === "inbox"),
    assign: n((t) => t.status === "next" && !t.scheduled_date),
    waiting: n((t) => t.status === "waiting"),
    someday: n((t) => t.status === "someday"),
    habits: n((t) => t.status === "habit"),
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
