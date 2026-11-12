/** 同じ日・枠のタスクを並べるための最小限の項目。 */
export interface Orderable {
  id: number;
  run_order: number | null;
  fixed_at?: string | null;
}

const time = (t: Orderable) => new Date(t.fixed_at as string).getTime();

/**
 * run_order 順に並んだ配列のうち、予定時刻ありのタスクを、自分たちが占める位置の中で
 * 開始時刻順(同時刻は id 順)に入れ替える。予定時刻なしのタスクの位置は動かさない。
 * サーバーの `GET /schedule` と同じ規則。
 */
export function arrangeFixed<T extends Orderable>(items: readonly T[]): T[] {
  const fixed = items
    .filter((t) => t.fixed_at)
    .sort((a, b) => time(a) - time(b) || a.id - b.id);
  let n = 0;
  return items.map((t) => (t.fixed_at ? fixed[n++] : t));
}

/** run_order 順(未設定は末尾、同値は id 順)の比較。 */
export const compareRunOrder = (a: Orderable, b: Orderable): number =>
  (a.run_order ?? Infinity) - (b.run_order ?? Infinity) || a.id - b.id;

/** 同日・同枠のタスクを並べ替えた配列を返す(元の配列は変えない)。 */
export function sortByOrder<T extends Orderable>(tasks: readonly T[]): T[] {
  return arrangeFixed([...tasks].sort(compareRunOrder));
}
