import type { TimeSlot } from "./run";

export interface AssignTask {
  id: number;
  title: string;
  status: string;
  project_id: number | null;
  estimate_minutes: number | null;
  scheduled_date: string | null;
  time_slot: TimeSlot | null;
  run_order: number | null;
}

/** 割り当て先。none は未割り当て(候補)。 */
export type Column = TimeSlot | "none";

export const COLUMNS: { key: Column; label: string }[] = [
  { key: "none", label: "未割り当て" },
  { key: "morning", label: "午前中" },
  { key: "afternoon", label: "午後" },
  { key: "evening", label: "夜" },
];

/** 候補(次にやるタスクのうち日付未設定のもの) */
export const isCandidate = (t: AssignTask) =>
  t.status === "next" && !t.scheduled_date;

/** 枠の中のタスクを実行順に並べる(サーバーの並びと同じ: run_order 未設定は末尾) */
export function slotTasks(
  scheduled: readonly AssignTask[],
  slot: TimeSlot,
): AssignTask[] {
  return scheduled
    .filter((t) => t.time_slot === slot)
    .sort(
      (a, b) =>
        (a.run_order ?? Infinity) - (b.run_order ?? Infinity) || a.id - b.id,
    );
}

/** 見積もりの合計(分) */
export const totalEstimate = (tasks: readonly AssignTask[]) =>
  tasks.reduce((sum, t) => sum + (t.estimate_minutes ?? 0), 0);

/** ドロップ後の枠内の並び。index は挿入位置(未指定なら末尾)。 */
export function insertAt(
  ids: readonly number[],
  id: number,
  index?: number,
): number[] {
  const rest = ids.filter((x) => x !== id);
  const i = index === undefined ? rest.length : Math.min(index, rest.length);
  return [...rest.slice(0, i), id, ...rest.slice(i)];
}
