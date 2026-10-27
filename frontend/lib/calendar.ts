import { addDays, mondayOf } from "./organize.ts";
import { toDateParam, type TimeSlot } from "./run.ts";

/** カレンダーに出すタスク。fixed_at があれば日時が決まる予定。 */
export interface CalendarTask {
  id: number;
  title: string;
  status: string;
  project_id: number | null;
  estimate_minutes: number | null;
  scheduled_date: string | null;
  time_slot: TimeSlot | null;
  run_order: number | null;
  fixed_at: string | null;
  fixed_end_at: string | null;
}

/** 基準日を含む週(月〜日)の日付。 */
export const weekDays = (d: Date): Date[] => {
  const mon = mondayOf(d);
  return [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(mon, i));
};

/** 表示範囲の日付(日表示は1日、週表示は7日)。 */
export const rangeDays = (mode: "day" | "week", d: Date): Date[] =>
  mode === "week" ? weekDays(d) : [d];

/** 日付と枠でタスクを絞る。予定は開始時刻順で先頭、タスクは実行順。 */
export function cellTasks(
  tasks: readonly CalendarTask[],
  day: string,
  slot: TimeSlot,
): CalendarTask[] {
  return tasks
    .filter((t) => t.scheduled_date === day && t.time_slot === slot)
    .sort((a, b) => {
      if (!!a.fixed_at !== !!b.fixed_at) return a.fixed_at ? -1 : 1;
      if (a.fixed_at && b.fixed_at)
        return (
          new Date(a.fixed_at).getTime() - new Date(b.fixed_at).getTime() ||
          a.id - b.id
        );
      return (
        (a.run_order ?? Infinity) - (b.run_order ?? Infinity) || a.id - b.id
      );
    });
}

/** 日付だけの枠(時間帯未設定)のタスクを除いた、日の件数。 */
export const dayCount = (tasks: readonly CalendarTask[], day: string) =>
  tasks.filter((t) => t.scheduled_date === day).length;

/** カレンダー上で動かせるのは日時が決まっていないタスクだけ。 */
export const isMovable = (t: CalendarTask) => !t.fixed_at;

/** 週表示のセルに出す最大件数(予定を除く) */
export const WEEK_CELL_LIMIT = 3;

/** 表示範囲の日付(YYYY-MM-DD)をカンマで連ねた文字列。再取得の判定に使う。 */
export const rangeKey = (mode: "day" | "week", d: Date): string =>
  rangeDays(mode, d).map(toDateParam).join(",");
