/** 整理画面群の構成(デザインの navItems / SCREENS に対応) */
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
      { key: "day", label: "カレンダー(日)" },
      { key: "week", label: "カレンダー(週)" },
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
