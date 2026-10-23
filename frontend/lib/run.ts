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
  recurrence_type: string | null;
  recurrence_end_type: string;
  recurrence_end_count: number | null;
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

export interface RunView {
  done: RunTask[];
  queue: RunTask[]; // 未完了。先頭が「いま着手」
  total: number;
  remainMinutes: number;
}

/** APIは時間帯→実行順で返すので、その順序を保ったまま完了/未完了に分ける。 */
export function buildRunView(tasks: RunTask[]): RunView {
  const done = tasks.filter((t) => t.status === "done");
  const queue = tasks.filter((t) => t.status !== "done");
  return {
    done,
    queue,
    total: tasks.length,
    remainMinutes: queue.reduce((a, t) => a + (t.estimate_minutes ?? 0), 0),
  };
}

/** 完了すると次の回が生成されるか(回数指定の最終回は生成されない)。 */
export function spawnsNext(t: RunTask): boolean {
  if (t.recurrence_type == null) return false;
  return !(
    t.recurrence_end_type === "count" && (t.recurrence_end_count ?? 0) <= 1
  );
}

/** 後回しを元に戻すためのPATCH本文。移動前の位置と日時固定を復元する。 */
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

/** 右方向は抵抗をかけ、左方向はそのまま追従させる。 */
export function dragOffset(dx: number): number {
  return dx > 0 ? dx * 0.2 : dx;
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
