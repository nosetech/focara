/** 同じ日・枠のタスクを並べるための最小限の項目。 */
export interface Orderable {
  id: number;
  run_order: number | null;
  fixed_at?: string | null;
}

/**
 * 同日・同枠の並び順の規則(サーバーの `GET /schedule` と同じ)。
 * 予定時刻ありを先頭(開始時刻順)、なしは実行順(run_order 未設定は末尾)。
 */
export function compareOrder(a: Orderable, b: Orderable): number {
  if (!!a.fixed_at !== !!b.fixed_at) return a.fixed_at ? -1 : 1;
  if (a.fixed_at && b.fixed_at) {
    const d = new Date(a.fixed_at).getTime() - new Date(b.fixed_at).getTime();
    if (d) return d;
    return a.id - b.id;
  }
  return (a.run_order ?? Infinity) - (b.run_order ?? Infinity) || a.id - b.id;
}

/** 並び順の規則で並べ替えた配列を返す(元の配列は変えない)。 */
export function sortByOrder<T extends Orderable>(tasks: readonly T[]): T[] {
  return [...tasks].sort(compareOrder);
}
