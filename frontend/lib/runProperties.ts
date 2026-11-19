import {
  propertyBody,
  toDraft,
  type PropertyType,
  type TaskProperty,
} from "./taskDetail.ts";

/** 実行画面の入力欄1行。value は入力中の文字列、saved は最後に保存した(または取得した)値。 */
export interface RunPropertyRow {
  id: number;
  key: string;
  value_type: PropertyType;
  unit: string;
  value: string;
  saved: string;
  error: string | null;
  saving: boolean;
  /** 直近の保存が成功したか(「保存済み」の表示用) */
  justSaved: boolean;
}

export function toRows(props: TaskProperty[]): RunPropertyRow[] {
  return props.map((p) => {
    const d = toDraft(p);
    return {
      id: p.id,
      key: p.key,
      value_type: p.value_type,
      unit: d.unit,
      value: d.value,
      saved: d.value,
      error: null,
      saving: false,
      justSaved: false,
    };
  });
}

/** 数値欄の入力を整える。全角の数字・記号は半角にし、前後の空白を除く。 */
export function normalizeValue(type: PropertyType, value: string): string {
  return type === "number" ? value.normalize("NFKC").trim() : value;
}

/**
 * 入力値の検証。エラーメッセージ(問題なければ null)を返す。
 * 値が空のときは、型を問わず「入力なし」として扱いエラーにしない(入力は任意)。
 */
export function validateValue(
  type: PropertyType,
  key: string,
  value: string,
): string | null {
  const v = normalizeValue(type, value);
  if (v.trim() === "") return null;
  const body = propertyBody({
    localId: "",
    id: null,
    key,
    value: v,
    value_type: type,
    unit: "",
  });
  return body && "error" in body ? body.error : null;
}

/** 保存が必要か。空の数値は保存できないので、保存済みと同じ扱いにする。 */
export function needsSave(r: RunPropertyRow): boolean {
  if (r.value === r.saved) return false;
  if (r.value_type === "number" && r.value.trim() === "") return false;
  return true;
}

/** 完了を止めるエラーがあるか。 */
export function blocksCompletion(rows: RunPropertyRow[]): boolean {
  return rows.some((r) => r.error !== null);
}

export type PropertyStatus = "idle" | "editing" | "saving" | "saved" | "error";

export function overallStatus(
  rows: RunPropertyRow[],
  focusedId: number | null,
): PropertyStatus {
  if (rows.some((r) => r.error !== null)) return "error";
  if (rows.some((r) => r.saving)) return "saving";
  if (focusedId !== null) return "editing";
  if (rows.some((r) => r.justSaved)) return "saved";
  return "idle";
}

export const STATUS_LABEL: Record<PropertyStatus, string> = {
  idle: "自動で保存されます",
  editing: "入力中",
  saving: "保存中…",
  saved: "保存済み",
  error: "未保存",
};
