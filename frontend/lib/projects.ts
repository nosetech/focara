import type { InboxTask } from "./inbox";

export interface ProjectTask extends InboxTask {
  project_order: number | null;
  scheduled_date: string | null;
  time_slot: string | null;
}

export interface ProjectSummary {
  id: number;
  name: string;
  description: string | null;
}

/** 詳細での表示順。完了は最後にまとめる(デザインのグループ順)。 */
export const PROJECT_GROUPS = [
  { status: "next", label: "次にやる" },
  { status: "waiting", label: "条件待ち" },
  { status: "someday", label: "いつか" },
  { status: "habit", label: "習慣" },
  { status: "inbox", label: "inbox" },
  { status: "done", label: "完了" },
] as const;

/** 進捗。習慣は繰り返すものなので件数に含めない(デザインと同じ)。 */
export function projectProgress(tasks: readonly ProjectTask[]) {
  const counted = tasks.filter((t) => t.status !== "habit");
  const done = counted.filter((t) => t.status === "done").length;
  return {
    done,
    total: counted.length,
    pct: counted.length ? Math.round((done / counted.length) * 100) : 0,
  };
}

/** プロジェクト内の並び順(project_order の昇順、未設定は末尾、同値は追加順)。 */
export function byProjectOrder(tasks: readonly ProjectTask[]): ProjectTask[] {
  return [...tasks].sort(
    (a, b) =>
      (a.project_order ?? Infinity) - (b.project_order ?? Infinity) ||
      a.id - b.id,
  );
}

export function groupByStatus(tasks: readonly ProjectTask[]) {
  const ordered = byProjectOrder(tasks);
  return PROJECT_GROUPS.map((g) => ({
    ...g,
    tasks: ordered.filter((t) => t.status === g.status),
  })).filter((g) => g.tasks.length > 0);
}

/**
 * id のタスクを同じグループ内で delta(-1=上 / 1=下)だけ動かしたあとの、
 * プロジェクト全体の並び順(タスクID)。動かせない場合は null。
 */
export function movedOrder(
  tasks: readonly ProjectTask[],
  id: number,
  delta: -1 | 1,
): number[] | null {
  const ordered = byProjectOrder(tasks);
  const at = ordered.findIndex((t) => t.id === id);
  if (at < 0) return null;
  const status = ordered[at].status;
  let to = at + delta;
  while (ordered[to] && ordered[to].status !== status) to += delta;
  if (!ordered[to]) return null;
  const ids = ordered.map((t) => t.id);
  [ids[at], ids[to]] = [ids[to], ids[at]];
  return ids;
}
