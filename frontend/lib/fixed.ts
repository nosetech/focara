import { currentSlot, formatClock, type TimeSlot } from "./run.ts";

/** 日時が決まる予定の編集値。date は YYYY-MM-DD、start / end は HH:MM(ローカル時刻)。 */
export interface FixedDraft {
  date: string;
  start: string;
  end: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO日時をローカルの日付・時刻に分ける。 */
export function splitFixed(
  fixedAt: string | null,
  fixedEndAt: string | null,
  scheduledDate: string | null,
): FixedDraft {
  const clock = (iso: string | null) => (iso ? formatClock(iso) : "");
  const d = fixedAt ? new Date(fixedAt) : null;
  const date = d
    ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    : (scheduledDate ?? "");
  return { date, start: clock(fixedAt), end: clock(fixedEndAt) };
}

export function slotForTime(time: string): TimeSlot {
  return currentSlot(new Date(`2000-01-01T${time}`));
}

export type FixedResult =
  | { error: string }
  | {
      body: {
        scheduled_date?: string;
        fixed_at: string | null;
        fixed_end_at: string | null;
      };
      slot: TimeSlot | null;
    };

/** 編集値をAPIの本文に変換する。開始が空なら日時指定を外す。 */
export function fixedBody(d: FixedDraft): FixedResult {
  if (!d.start) {
    if (d.end) return { error: "開始時刻を入力してください" };
    return { body: { fixed_at: null, fixed_end_at: null }, slot: null };
  }
  if (!d.date) return { error: "日付を選んでください" };
  const at = new Date(`${d.date}T${d.start}`);
  if (Number.isNaN(at.getTime())) return { error: "日時が正しくありません" };
  let endAt: Date | null = null;
  if (d.end) {
    endAt = new Date(`${d.date}T${d.end}`);
    if (endAt.getTime() <= at.getTime())
      return { error: "終了時刻は開始時刻より後にしてください" };
  }
  return {
    body: {
      scheduled_date: d.date,
      fixed_at: at.toISOString(),
      fixed_end_at: endAt ? endAt.toISOString() : null,
    },
    slot: slotForTime(d.start),
  };
}

interface FixedTask {
  id: number;
  fixed_at: string | null;
  fixed_end_at: string | null;
  estimate_minutes: number | null;
}

/** 予定の終了時刻(ms)。終了が未指定なら見積もり分、それも無ければ開始と同じ。 */
function endMs(t: FixedTask, start: number): number {
  if (t.fixed_end_at) return new Date(t.fixed_end_at).getTime();
  return start + (t.estimate_minutes ?? 0) * 60_000;
}

/** 時間が重なる日時予定の id を返す。 */
export function overlappingIds(tasks: readonly FixedTask[]): Set<number> {
  const items = tasks
    .filter((t) => t.fixed_at)
    .map((t) => {
      const s = new Date(t.fixed_at as string).getTime();
      return { id: t.id, s, e: endMs(t, s) };
    });
  const out = new Set<number>();
  for (const a of items)
    for (const b of items) {
      if (a.id >= b.id) continue;
      if (a.s === b.s || (a.s < b.e && b.s < a.e)) {
        out.add(a.id);
        out.add(b.id);
      }
    }
  return out;
}

/** 「10:00–11:00」「10:00〜」の形に整える。 */
export function formatRange(
  fixedAt: string,
  fixedEndAt: string | null,
): string {
  return fixedEndAt
    ? `${formatClock(fixedAt)}–${formatClock(fixedEndAt)}`
    : `${formatClock(fixedAt)}〜`;
}
