import { sortByOrder } from "./order.ts";

export type TimeSlot = "morning" | "afternoon" | "evening";

export interface RunTask {
  id: number;
  title: string;
  status: string;
  project_id: number | null;
  priority: number | null;
  estimate_minutes: number | null;
  time_slot: TimeSlot | null;
  fixed_at: string | null;
  memo: string | null;
  scheduled_date: string | null;
  run_order: number | null;
  fixed_end_at: string | null;
  /** 習慣(親)から生成された子タスクなら親の id */
  habit_id: number | null;
}

export const SLOTS: { key: TimeSlot; label: string }[] = [
  { key: "morning", label: "午前中" },
  { key: "afternoon", label: "午後" },
  { key: "evening", label: "夜" },
];

export const SLOT_LABEL: Record<TimeSlot, string> = {
  morning: "午前中",
  afternoon: "午後",
  evening: "夜",
};

export function currentSlot(now: Date): TimeSlot {
  const h = now.getHours();
  return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}

export function formatMinutes(m: number): string {
  return m >= 60
    ? `${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ""}`
    : `${m}分`;
}

export function toDateParam(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function formatDateLabel(d: Date): string {
  const wd = "日月火水木金土"[d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日（${wd}）`;
}

export function formatClock(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 現在時刻の表示(HH:MM)。 */
export function formatNow(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 進捗バーの割合(0〜100)。総数0なら0。 */
export function progressPercent(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

export interface RunView {
  done: RunTask[];
  queue: RunTask[]; // 未完了。先頭が「いま着手」
  total: number;
  remainMinutes: number;
}

const SLOT_RANK: Record<TimeSlot, number> = {
  morning: 0,
  afternoon: 1,
  evening: 2,
};

/** 枠(午前中→午後→夜、未設定は末尾)→ 実行順(予定時刻ありは、その位置の中で開始順)に並べる。 */
export function sortRunTasks(tasks: readonly RunTask[]): RunTask[] {
  const rank = (t: RunTask) => (t.time_slot ? SLOT_RANK[t.time_slot] : 99);
  const slots = new Map<number, RunTask[]>();
  for (const t of tasks) {
    const r = rank(t);
    slots.set(r, [...(slots.get(r) ?? []), t]);
  }
  return [...slots.keys()]
    .sort((a, b) => a - b)
    .flatMap((r) => sortByOrder(slots.get(r) ?? []));
}

/** APIと同じ並び(枠→予定時刻→実行順)にそろえたうえで、完了/未完了に分ける。 */
export function buildRunView(input: RunTask[]): RunView {
  const tasks = sortRunTasks(input);
  const done = tasks.filter((t) => t.status === "done");
  // キャンセルした習慣の子は、完了と同様にキューから外し、進捗の母数にも含めない
  const live = tasks.filter((t) => t.status !== "cancelled");
  const queue = live.filter((t) => t.status !== "done");
  return {
    done,
    queue,
    total: live.length,
    remainMinutes: queue.reduce((a, t) => a + (t.estimate_minutes ?? 0), 0),
  };
}

/** 後回しを元に戻すためのPATCH本文。移動前の位置と日時固定を復元する。 */
/** 後回し: 現在の時間帯の最後に移動する(時間帯はクライアントの時計で決める)。 */
export function postponeBody(now: Date) {
  return { target: "end_of_day", time_slot: currentSlot(now) };
}

export function restoreBody(t: RunTask) {
  return {
    scheduled_date: t.scheduled_date,
    time_slot: t.time_slot,
    run_order: t.run_order,
    fixed_at: t.fixed_at,
    fixed_end_at: t.fixed_end_at,
  };
}

export const SWIPE_THRESHOLD = 96;

/**
 * 左方向はそのまま追従させる。右方向は、キャンセルできる(習慣の子)ときだけ追従し、
 * それ以外は抵抗をかける。
 */
export function dragOffset(dx: number, canCancel = false): number {
  return dx > 0 && !canCancel ? dx * 0.2 : dx;
}

/** キャンセルできるのは習慣の子タスクのみ。 */
export function canCancel(t: { habit_id: number | null }): boolean {
  return t.habit_id != null;
}

/** 未完了が残っていて、dayEndHour(時)以降になっている(「やる」を選んだ後は除く)。 */
export function isDayOver(
  now: Date,
  queueLength: number,
  resumed: boolean,
  dayEndHour: number,
) {
  return queueLength > 0 && !resumed && now.getHours() >= dayEndHour;
}

/** 予定を変える: 指定日の午前中へ。 */
export function moveBody(date: string) {
  return { target: "date", scheduled_date: date, time_slot: "morning" };
}

/** 予定を変える: いつかへ。日付・枠・日時固定を外す。 */
export function somedayBody() {
  return {
    status: "someday",
    scheduled_date: null,
    time_slot: null,
    run_order: null,
    fixed_at: null,
    fixed_end_at: null,
  };
}

export function tomorrowParam(d: Date): string {
  return toDateParam(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1));
}
