export interface InboxTask {
  id: number;
  title: string;
  status: string;
  project_id: number | null;
  priority: number | null;
  estimate_minutes: number | null;
  created_at: string;
}

export interface OrganizeFilters {
  status: string;
  project: string;
  pri: string;
  sort: string;
}

export const DEFAULT_FILTERS: OrganizeFilters = {
  status: "",
  project: "",
  pri: "",
  sort: "default",
};

/** 優先度は数値が小さいほど高い(1=高 / 2=中 / 3=低)。未設定は null。 */
export const PRIORITIES = [
  { value: 1, label: "高" },
  { value: 2, label: "中" },
  { value: 3, label: "低" },
] as const;

export const priorityLabel = (p: number | null) =>
  PRIORITIES.find((x) => x.value === p)?.label ?? "";

/** inbox から振り分けられるステータス(デザインの S4。キーボードの 1〜4 に対応) */
export const TRIAGE_STATUSES = [
  { status: "next", label: "次にやる", key: "1" },
  { status: "someday", label: "いつか", key: "2" },
  { status: "waiting", label: "条件待ち", key: "3" },
  { status: "habit", label: "習慣", key: "4" },
] as const;

export const formatEstimate = (m: number | null) =>
  !m
    ? ""
    : m >= 60
      ? `${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ""}`
      : `${m}分`;

/** 追加日(M/D) */
export function formatAdded(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 絞り込みと並び替え。並び替えは安定(同値は追加順のまま)。 */
export function filterInbox<T extends InboxTask>(
  tasks: readonly T[],
  f: OrganizeFilters,
  projectName: (id: number | null) => string,
): T[] {
  const l = tasks.filter(
    (t) =>
      (!f.status || t.status === f.status) &&
      (!f.project ||
        (f.project === "none"
          ? t.project_id === null
          : String(t.project_id) === f.project)) &&
      (!f.pri || priorityLabel(t.priority) === f.pri),
  );
  const rank = (t: T) => t.priority ?? Infinity;
  if (f.sort === "pri") l.sort((a, b) => rank(a) - rank(b));
  else if (f.sort === "est")
    l.sort(
      (a, b) =>
        (a.estimate_minutes ?? Infinity) - (b.estimate_minutes ?? Infinity),
    );
  else if (f.sort === "project")
    l.sort((a, b) =>
      projectName(a.project_id).localeCompare(projectName(b.project_id), "ja"),
    );
  return l;
}

/** 振り分けAPI(POST /tasks/{id}/transition)の本文。条件待ちは待ち条件が必須。 */
export function transitionBody(status: string, waitCondition?: string) {
  return status === "waiting"
    ? { status, wait_condition: waitCondition?.trim() || null }
    : { status };
}

/** 振り分け後のフォーカス位置(消えた分を詰め、末尾を超えないようにする) */
export const nextFocus = (focus: number, remaining: number) =>
  Math.min(focus, Math.max(0, remaining - 1));
