export type PropertyType = "string" | "number" | "date";

export interface TaskProperty {
  id: number;
  task_id: number;
  key: string;
  value: string | null;
  value_type: PropertyType;
  unit: string | null;
}

/** 編集中の行。まだ保存されていない行は id が null。 */
export interface PropertyDraft {
  localId: string;
  id: number | null;
  key: string;
  value: string;
  value_type: PropertyType;
  unit: string;
}

export const PROPERTY_TYPES: { key: PropertyType; label: string }[] = [
  { key: "string", label: "文字" },
  { key: "number", label: "数値" },
  { key: "date", label: "日付" },
];

export function toDraft(p: TaskProperty): PropertyDraft {
  return {
    localId: `p${p.id}`,
    id: p.id,
    key: p.key,
    value: p.value ?? "",
    value_type: p.value_type,
    unit: p.unit ?? "",
  };
}

export function newDraft(seq: number): PropertyDraft {
  return {
    localId: `n${seq}`,
    id: null,
    key: "",
    value: "",
    value_type: "string",
    unit: "",
  };
}

export type PropertyBody =
  | {
      key: string;
      value: string | number;
      value_type: PropertyType;
      unit: string | null;
    }
  | { error: string };

/** 行をAPIの本文に変換する。名前が空の行は保存対象外(null)。 */
export function propertyBody(d: PropertyDraft): PropertyBody | null {
  const key = d.key.trim();
  if (!key) return null;
  const unit = d.value_type === "number" ? d.unit.trim() || null : null;
  if (d.value_type === "number") {
    const raw = d.value.trim();
    const num = Number(raw);
    if (raw === "" || !Number.isFinite(num))
      return { error: "数値を入力してください" };
    return { key, value: num, value_type: "number", unit };
  }
  if (d.value_type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(d.value))
    return { error: "日付を選んでください" };
  return { key, value: d.value, value_type: d.value_type, unit };
}

export type SaveState = "saved" | "saving" | "error";

export const SAVE_LABEL: Record<SaveState, string> = {
  saved: "保存済み",
  saving: "保存中…",
  error: "保存できませんでした",
};

export const STATUS_CHIPS = [
  { key: "inbox", label: "inbox" },
  { key: "next", label: "次にやる" },
  { key: "someday", label: "いつか" },
  { key: "waiting", label: "条件待ち" },
  { key: "habit", label: "習慣" },
] as const;

export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** 各月の最大日数(2月は閏年を考慮して29日)。 */
export const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export type RepeatType = "weekly" | "monthly" | "yearly";
export type RepeatEndType = "none" | "date" | "count";

/** 繰り返しの編集値。days は曜日(0=日〜6=土)、mday は月次の日にち(null=月末)。 */
export interface RepeatDraft {
  type: RepeatType;
  days: number[];
  mday: number | null;
  month: number;
  day: number;
  endType: RepeatEndType;
  endDate: string;
  endCount: number | null;
}

export interface RepeatSource {
  recurrence_type: string | null;
  recurrence_weekdays: number | null;
  recurrence_month_day: number | null;
  recurrence_month: number | null;
  recurrence_day: number | null;
  recurrence_end_type: string;
  recurrence_end_date: string | null;
  recurrence_end_count: number | null;
}

function baseDate(date: string | null): Date {
  const d = date ? new Date(`${date}T00:00`) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** 種類を選んだときの初期値。日付(未設定なら今日)の曜日・日にち・月日を使う。 */
export function defaultRepeat(
  type: RepeatType,
  date: string | null,
  prev?: Pick<RepeatDraft, "endType" | "endDate" | "endCount">,
): RepeatDraft {
  const d = baseDate(date);
  return {
    type,
    days: [d.getDay()],
    mday: d.getDate(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    endType: prev?.endType ?? "none",
    endDate: prev?.endDate ?? "",
    endCount: prev?.endCount ?? null,
  };
}

export function weekdaysFromMask(mask: number): number[] {
  return WEEKDAYS.map((_, i) => i).filter((i) => (mask >> i) & 1);
}

export function weekdaysToMask(days: readonly number[]): number {
  return days.reduce((m, i) => m | (1 << i), 0);
}

export function repeatFromTask(t: RepeatSource): RepeatDraft | null {
  const type = t.recurrence_type as RepeatType | null;
  if (!type) return null;
  const base = defaultRepeat(type, null);
  return {
    ...base,
    days: type === "weekly" ? weekdaysFromMask(t.recurrence_weekdays ?? 0) : [],
    mday:
      type === "monthly"
        ? t.recurrence_month_day === -1
          ? null
          : (t.recurrence_month_day ?? base.mday)
        : base.mday,
    month: t.recurrence_month ?? base.month,
    day: t.recurrence_day ?? base.day,
    endType: t.recurrence_end_type as RepeatEndType,
    endDate: t.recurrence_end_date ?? "",
    endCount: t.recurrence_end_count,
  };
}

export type RepeatBody =
  { error: string } | { body: Record<string, string | number | null> };

/** 編集値を PUT /tasks/{id}/recurrence の本文に変換する。終了条件が未入力ならエラー。 */
export function repeatBody(r: RepeatDraft): RepeatBody {
  if (r.type === "weekly" && r.days.length === 0)
    return { error: "曜日を1つ以上選んでください" };
  if (r.endType === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(r.endDate))
    return { error: "終了日を選んでください" };
  if (r.endType === "count" && !(r.endCount != null && r.endCount >= 1))
    return { error: "回数を1以上で入力してください" };
  return {
    body: {
      recurrence_type: r.type,
      recurrence_weekdays: r.type === "weekly" ? weekdaysToMask(r.days) : null,
      recurrence_month_day:
        r.type === "monthly" ? (r.mday == null ? -1 : r.mday) : null,
      recurrence_month: r.type === "yearly" ? r.month : null,
      recurrence_day: r.type === "yearly" ? r.day : null,
      recurrence_end_type: r.endType,
      recurrence_end_date: r.endType === "date" ? r.endDate : null,
      recurrence_end_count: r.endType === "count" ? r.endCount : null,
    },
  };
}

/** 「毎週 月・水・金 · 終了日なし」のような説明文。 */
export function repeatSummary(r: RepeatDraft): string {
  let s = "";
  if (r.type === "weekly") {
    const d = [...r.days].sort((a, b) => a - b);
    s =
      d.length === 7
        ? "毎日"
        : d.join() === "1,2,3,4,5"
          ? "平日(月〜金)"
          : `毎週 ${d.map((i) => WEEKDAYS[i]).join("・")}`;
  } else if (r.type === "monthly") {
    s = `毎月 ${r.mday == null ? "月末" : `${r.mday}日`}`;
  } else {
    s = `毎年 ${r.month}月${r.day}日`;
  }
  if (r.endType === "date" && r.endDate)
    s += ` · ${r.endDate.replace(/-/g, "/")} まで`;
  else if (r.endType === "count" && r.endCount) s += ` · ${r.endCount}回で終了`;
  else s += " · 終了日なし";
  return s;
}
