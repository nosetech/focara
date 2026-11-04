import type { TimeSlot } from "./run.ts";
import { formatClock, toDateParam } from "./run.ts";
import { slotForTime } from "./fixed.ts";
import { MONTH_DAYS, WEEKDAYS } from "./taskDetail.ts";

/** 親(習慣)の直近の実施状況。今日以前の子を新しい順に返す。 */
export interface HabitOccurrence {
  task_id: number;
  occurrence_date: string;
  status: string;
}

/** GET /api/habits の1件。 */
export interface Habit {
  id: number;
  title: string;
  project_id: number | null;
  priority: number | null;
  estimate_minutes: number | null;
  memo: string | null;
  time_slot: TimeSlot | null;
  /** 予定時刻(ローカル時刻の HH:MM)。終了だけの指定は無い。 */
  fixed_start_time: string | null;
  fixed_end_time: string | null;
  properties: string[];
  recurrence_type: "weekly" | "monthly" | "yearly";
  recurrence_weekdays: number | null;
  recurrence_month_day: number | null;
  recurrence_month: number | null;
  recurrence_day: number | null;
  recurrence_end_type: "none" | "date" | "count";
  recurrence_end_date: string | null;
  recurrence_end_count: number | null;
  start_date: string;
  active: boolean;
  recent: HabitOccurrence[];
  created_at: string;
  updated_at: string;
}

export const ALL_WEEKDAYS_MASK = 127;

/** 繰り返しルール。毎日は「全曜日の週次」としてAPIに送る。 */
export type HabitRule =
  | { type: "daily" }
  | { type: "weekly"; days: number[] }
  | { type: "monthly"; mday: number | null } // null = 月末
  | { type: "yearly"; month: number; day: number };

export type HabitEnd =
  | { type: "none" }
  | { type: "count"; count: number | null }
  | { type: "date"; date: string };

/** 作成・編集シートの編集値。 */
export interface HabitDraft {
  title: string;
  projectId: number | null;
  priority: number | null;
  estimate: number | null;
  slot: TimeSlot | null;
  fixedStart: string;
  fixedEnd: string;
  /** プロパティの項目名(値は子タスクで入力する) */
  properties: string[];
  rule: HabitRule;
  start: string;
  end: HabitEnd;
}

const weekdaysFromMask = (mask: number) =>
  WEEKDAYS.map((_, i) => i).filter((i) => (mask >> i) & 1);
const weekdaysToMask = (days: readonly number[]) =>
  days.reduce((m, i) => m | (1 << i), 0);

export function ruleFromHabit(h: Habit): HabitRule {
  if (h.recurrence_type === "weekly") {
    const mask = h.recurrence_weekdays ?? 0;
    return mask === ALL_WEEKDAYS_MASK
      ? { type: "daily" }
      : { type: "weekly", days: weekdaysFromMask(mask) };
  }
  if (h.recurrence_type === "monthly")
    return {
      type: "monthly",
      mday: h.recurrence_month_day === -1 ? null : h.recurrence_month_day,
    };
  return {
    type: "yearly",
    month: h.recurrence_month ?? 1,
    day: h.recurrence_day ?? 1,
  };
}

/** 「毎週 月・水・金」のような短いルール表記。 */
export function ruleText(r: HabitRule): string {
  switch (r.type) {
    case "daily":
      return "毎日";
    case "weekly": {
      // 月曜始まりで並べる
      const d = [...r.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
      if (d.length === 7) return "毎日";
      if ([...d].sort().join() === "1,2,3,4,5") return "平日(月〜金)";
      return `毎週 ${d.map((i) => WEEKDAYS[i]).join("・")}`;
    }
    case "monthly":
      return `毎月 ${r.mday == null ? "月末" : `${r.mday}日`}`;
    case "yearly":
      return `毎年 ${r.month}月${r.day}日`;
  }
}

export const habitRuleText = (h: Habit) => ruleText(ruleFromHabit(h));

export function endFromHabit(h: Habit): HabitEnd {
  if (h.recurrence_end_type === "count")
    return { type: "count", count: h.recurrence_end_count };
  if (h.recurrence_end_type === "date")
    return { type: "date", date: h.recurrence_end_date ?? "" };
  return { type: "none" };
}

export function draftFromHabit(h: Habit): HabitDraft {
  return {
    title: h.title,
    projectId: h.project_id,
    priority: h.priority,
    estimate: h.estimate_minutes,
    slot: h.time_slot,
    fixedStart: h.fixed_start_time ?? "",
    fixedEnd: h.fixed_end_time ?? "",
    properties: [...h.properties],
    rule: ruleFromHabit(h),
    start: h.start_date,
    end: endFromHabit(h),
  };
}

/** 新規作成の初期値。inboxのタスクから作る場合は seed で項目を引き継ぐ。 */
export function emptyDraft(
  today: Date,
  seed: Partial<HabitDraft> = {},
): HabitDraft {
  return {
    title: "",
    projectId: null,
    priority: 2,
    estimate: 15,
    slot: "morning",
    fixedStart: "",
    fixedEnd: "",
    properties: [],
    rule: { type: "daily" },
    start: toDateParam(today),
    end: { type: "none" },
    ...seed,
  };
}

/** 種類を切り替えたときのルールの初期値。開始日の曜日・日にち・月日を使う。 */
export function defaultRule(
  type: HabitRule["type"],
  start: string,
  prev: HabitRule,
): HabitRule {
  if (type === prev.type) return prev;
  const d = new Date(`${start}T00:00`);
  const base = Number.isNaN(d.getTime()) ? new Date() : d;
  switch (type) {
    case "daily":
      return { type };
    case "weekly":
      return { type, days: [base.getDay()] };
    case "monthly":
      return { type, mday: base.getDate() };
    case "yearly":
      return { type, month: base.getMonth() + 1, day: base.getDate() };
  }
}

export const maxDayOfMonth = (month: number) => MONTH_DAYS[month - 1] ?? 31;

export type HabitBody = Record<string, string | number | string[] | null>;

/** プロパティ項目名の検証。問題があればメッセージを返す。 */
export function propertyError(keys: readonly string[]): string | null {
  const names = keys.map((k) => k.trim());
  if (names.some((k) => !k)) return "プロパティの名前を入力してください";
  if (new Set(names).size !== names.length)
    return "プロパティの名前が重複しています";
  return null;
}

/** 予定時刻の検証。問題があればメッセージを返す。 */
export function fixedTimeError(start: string, end: string): string | null {
  const ok = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  if (start && !ok(start)) return "開始時刻が正しくありません";
  if (end && !ok(end)) return "終了時刻が正しくありません";
  if (end && !start) return "開始時刻を入力してください";
  if (end && end <= start) return "終了時刻は開始時刻より後にしてください";
  return null;
}

/** 予定時刻の表示。「09:00–10:00」「09:00–」、無ければ空文字。 */
export function fixedTimeText(start: string, end: string): string {
  if (!start) return "";
  return `${start}–${end}`;
}

/** 編集値 → POST/PATCH /api/habits の本文。不正なら error。 */
export function draftBody(
  d: HabitDraft,
): { body: HabitBody } | { error: string } {
  const title = d.title.trim();
  if (!title) return { error: "習慣の名前を入力してください" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.start))
    return { error: "開始日を選んでください" };
  if (d.rule.type === "weekly" && d.rule.days.length === 0)
    return { error: "曜日を1つ以上選んでください" };
  if (d.end.type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.end.date))
      return { error: "終了日を選んでください" };
    if (d.end.date < d.start)
      return { error: "終了日は開始日以降にしてください" };
  }
  if (d.end.type === "count" && !(d.end.count != null && d.end.count >= 1))
    return { error: "回数は1以上で入力してください" };

  const fixedErr = fixedTimeError(d.fixedStart, d.fixedEnd);
  if (fixedErr) return { error: fixedErr };
  const propErr = propertyError(d.properties);
  if (propErr) return { error: propErr };

  const r = d.rule;
  return {
    body: {
      title,
      fixed_start_time: d.fixedStart || null,
      fixed_end_time: d.fixedEnd || null,
      properties: d.properties.map((k) => k.trim()),
      project_id: d.projectId,
      priority: d.priority,
      estimate_minutes: d.estimate,
      time_slot: d.slot,
      recurrence_type:
        r.type === "daily" || r.type === "weekly"
          ? "weekly"
          : r.type === "monthly"
            ? "monthly"
            : "yearly",
      recurrence_weekdays:
        r.type === "daily"
          ? ALL_WEEKDAYS_MASK
          : r.type === "weekly"
            ? weekdaysToMask(r.days)
            : null,
      recurrence_month_day:
        r.type === "monthly" ? (r.mday == null ? -1 : r.mday) : null,
      recurrence_month: r.type === "yearly" ? r.month : null,
      recurrence_day: r.type === "yearly" ? r.day : null,
      recurrence_end_type: d.end.type,
      recurrence_end_date: d.end.type === "date" ? d.end.date : null,
      recurrence_end_count: d.end.type === "count" ? d.end.count : null,
      start_date: d.start,
    },
  };
}

const SLOT_NAME: Record<TimeSlot, string> = {
  morning: "午前中",
  afternoon: "午後",
  evening: "夜",
};
export const slotName = (s: TimeSlot | null) => (s ? SLOT_NAME[s] : "枠なし");

const slash = (iso: string) => iso.replace(/-/g, "/");

/** 終了条件の説明。累計回数のときは現在の実施回数も添える。 */
export function endText(end: HabitEnd, total: number): string {
  if (end.type === "count")
    return `累計${end.count ?? "—"}回で終了(現在 ${total}回)`;
  if (end.type === "date") return `${slash(end.date)} まで`;
  return "終了なし";
}

/** シート下部の要約。 */
export function draftSummary(d: HabitDraft, total: number): string {
  const time = fixedTimeText(d.fixedStart, d.fixedEnd);
  const when = time ? `${time}に作成` : `${slotName(d.slot)}に作成`;
  return `${ruleText(d.rule)} · ${when} · ${slash(d.start)} から · ${endText(d.end, total)}`;
}

export type DotState = "done" | "miss" | "today";

/** 直近の実施状況(古い順)。今日の未実施は「today」、過去の未完了は「miss」。 */
export function recentDots(
  recent: readonly HabitOccurrence[],
  today: Date,
): DotState[] {
  const t = toDateParam(today);
  return [...recent]
    .sort((a, b) => a.occurrence_date.localeCompare(b.occurrence_date))
    .map((o) =>
      o.status === "done" ? "done" : o.occurrence_date >= t ? "today" : "miss",
    );
}

export function dotCounts(dots: readonly DotState[]) {
  return {
    done: dots.filter((x) => x === "done").length,
    total: dots.filter((x) => x !== "today").length,
  };
}

export const DOT_TITLE: Record<DotState, string> = {
  done: "実施",
  miss: "未実施",
  today: "今日(未実施)",
};

/** 一覧で扱う共通の行(絞り込み・並び替えは inbox と同じ関数を使う)。 */
export function asListRow(h: Habit) {
  return { ...h, status: h.active ? "habit" : "paused" };
}

/**
 * タスクから習慣を作るときの初期値(プロパティ名と予定時刻)。値は引き継がない。
 * 予定時刻は同じ日の開始・終了だけを引き継ぎ、終了が開始以前なら終了は捨てる。
 */
export function seedFromTask(
  task: { fixed_at: string | null; fixed_end_at: string | null },
  propertyKeys: readonly string[],
): Partial<HabitDraft> {
  const keys = [...new Set(propertyKeys.map((k) => k.trim()).filter(Boolean))];
  const seed: Partial<HabitDraft> = { properties: keys };
  if (!task.fixed_at) return seed;
  const start = formatClock(task.fixed_at);
  let end = task.fixed_end_at ? formatClock(task.fixed_end_at) : "";
  if (end <= start) end = "";
  return {
    ...seed,
    fixedStart: start,
    fixedEnd: end,
    slot: slotForTime(start),
  };
}
