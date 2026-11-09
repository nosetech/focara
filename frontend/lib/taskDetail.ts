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
  // 日付は空(クリア)も許す
  if (
    d.value_type === "date" &&
    d.value !== "" &&
    !/^\d{4}-\d{2}-\d{2}$/.test(d.value)
  )
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
] as const;

export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** 各月の最大日数(2月は閏年を考慮して29日)。 */
export const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** 条件待ちとして保存できる条件か(空・空白のみは保存できない)。 */
export function canSaveWaiting(cond: string): boolean {
  return cond.trim() !== "";
}

/** 条件待ちへ変更する PATCH ボディ。条件が空なら null(保存しない)。 */
export function waitingBody(
  cond: string,
): { status: "waiting"; wait_condition: string } | null {
  return canSaveWaiting(cond)
    ? { status: "waiting", wait_condition: cond.trim() }
    : null;
}

/**
 * タスク名の編集を確定したときの扱い。
 * 前後の空白は取り除く。空なら保存せず編集前の値に戻す。変更がなければ保存しない。
 */
export function commitTitle(
  draft: string,
  saved: string,
): { title: string; save: boolean } {
  const value = draft.trim();
  if (value === "") return { title: saved, save: false };
  return { title: value, save: value !== saved };
}
