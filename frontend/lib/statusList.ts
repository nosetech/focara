import type { AssignTask } from "./assign";
import type { InboxTask } from "./inbox";

export type ListStatus = "waiting" | "someday" | "habit";

export interface ListTask extends InboxTask {
  scheduled_date: string | null;
  time_slot: AssignTask["time_slot"];
  wait_condition: string | null;
  wait_until: string | null;
  recurrence_type: "weekly" | "monthly" | "yearly" | null;
  recurrence_weekdays: number | null;
  recurrence_month_day: number | null;
  recurrence_month: number | null;
  recurrence_day: number | null;
  recurrence_end_type: "none" | "date" | "count";
  recurrence_end_date: string | null;
  recurrence_end_count: number | null;
}

export const LIST_COPY: Record<
  ListStatus,
  { label: string; emptyTitle: string; emptyText: string }
> = {
  waiting: {
    label: "条件待ち",
    emptyTitle: "待っているタスクはありません",
    emptyText:
      "人からの返信や日時など、条件がそろうのを待つタスクがここに並びます。",
  },
  someday: {
    label: "いつか",
    emptyTitle: "いつかやるタスクはありません",
    emptyText: "すぐには着手しないアイデアや目標を、ここに置いておけます。",
  },
  habit: {
    label: "習慣",
    emptyTitle: "習慣はまだありません",
    emptyText:
      "繰り返すタスクを「習慣」にすると、実施状況がここに記録されます。",
  },
};

/** 曜日ビットマスク(bit0=日 ... bit6=土)の表示順 */
export const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
export const ALL_WEEKDAYS = 127;

export const toggleWeekday = (mask: number, i: number) => mask ^ (1 << i);

/** 繰り返しルールの短い表記。未設定は「繰り返しなし」。 */
export function recurrenceLabel(t: ListTask): string {
  switch (t.recurrence_type) {
    case "weekly": {
      const mask = t.recurrence_weekdays ?? 0;
      if (mask === ALL_WEEKDAYS) return "毎日";
      const days = WEEKDAY_LABELS.filter((_, i) => (mask >> i) & 1);
      return `毎週 ${days.join("")}`;
    }
    case "monthly":
      return t.recurrence_month_day === -1
        ? "毎月 月末"
        : `毎月 ${t.recurrence_month_day}日`;
    case "yearly":
      return `毎年 ${t.recurrence_month}月${t.recurrence_day}日`;
    default:
      return "繰り返しなし";
  }
}

export const SLOT_LABEL = {
  morning: "午前中",
  afternoon: "午後",
  evening: "夜",
};

/** 直近7日の実施状況。1=実施 / 0=未実施 / null=今日(未実施)。末尾が今日。 */
export function recentHistory(
  title: string,
  logs: readonly { task_title: string; action: string; created_at: string }[],
  today: Date,
): (1 | 0 | null)[] {
  const key = (d: Date) =>
    `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const done = new Set(
    logs
      .filter((l) => l.task_title === title && l.action === "completed")
      .map((l) => key(new Date(l.created_at))),
  );
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (6 - i));
    if (done.has(key(d))) return 1;
    return i === 6 ? null : 0;
  });
}

/** ISO日時 → datetime-local 用(ローカル時刻、分まで) */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 待ち日時の表示(M/D HH:mm) */
export function formatWaitUntil(iso: string | null): string {
  const v = toLocalInput(iso);
  return v
    ? `${Number(v.slice(5, 7))}/${Number(v.slice(8, 10))} ${v.slice(11)}`
    : "";
}

export interface RuleDraft {
  type: "weekly" | "monthly" | "yearly";
  weekdays: number;
  monthDay: string;
  month: string;
  day: string;
  endType: "none" | "date" | "count";
  endDate: string;
  endCount: string;
}

export function toRuleDraft(t: ListTask): RuleDraft {
  return {
    type: t.recurrence_type ?? "weekly",
    weekdays: t.recurrence_weekdays ?? ALL_WEEKDAYS,
    monthDay: String(t.recurrence_month_day ?? 1),
    month: String(t.recurrence_month ?? 1),
    day: String(t.recurrence_day ?? 1),
    endType: t.recurrence_end_type,
    endDate: t.recurrence_end_date ?? "",
    endCount: String(t.recurrence_end_count ?? 1),
  };
}

/** 下書き → PUT /tasks/{id}/recurrence の本文。不正なら error。 */
export function ruleBody(
  d: RuleDraft,
): { body: Record<string, unknown> } | { error: string } {
  const int = (s: string) => (/^-?\d+$/.test(s.trim()) ? Number(s) : NaN);
  const body: Record<string, unknown> = {
    recurrence_type: d.type,
    recurrence_end_type: d.endType,
  };
  if (d.type === "weekly") {
    if (d.weekdays < 1 || d.weekdays > ALL_WEEKDAYS)
      return { error: "曜日を1つ以上選んでください" };
    body.recurrence_weekdays = d.weekdays;
  } else if (d.type === "monthly") {
    const v = int(d.monthDay);
    if (!(v === -1 || (v >= 1 && v <= 31)))
      return { error: "日にちは1〜31か月末を指定してください" };
    body.recurrence_month_day = v;
  } else {
    const m = int(d.month);
    const day = int(d.day);
    if (!(m >= 1 && m <= 12 && day >= 1 && day <= 31))
      return { error: "月日を正しく指定してください" };
    body.recurrence_month = m;
    body.recurrence_day = day;
  }
  if (d.endType === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.endDate))
      return { error: "終了日を選んでください" };
    body.recurrence_end_date = d.endDate;
  } else if (d.endType === "count") {
    const c = int(d.endCount);
    if (!(c >= 1)) return { error: "回数は1以上で指定してください" };
    body.recurrence_end_count = c;
  }
  return { body };
}

/** 待ち条件の保存本文。条件も日時も空は不可。 */
export function waitBody(
  condition: string,
  until: string,
):
  | { wait_condition: string | null; wait_until: string | null }
  | { error: string } {
  const c = condition.trim();
  if (!c && !until) return { error: "待ち条件か待ち日時を入力してください" };
  return {
    wait_condition: c || null,
    wait_until: until ? new Date(until).toISOString() : null,
  };
}
