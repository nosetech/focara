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
