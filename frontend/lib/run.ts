export type TimeSlot = "morning" | "afternoon" | "evening";

export interface RunTask {
  id: number;
  title: string;
  status: string;
  project_id: number | null;
  priority: number | null;
  estimate_minutes: number | null;
  time_slot: TimeSlot | null;
  fixed_at: string | null;
  memo: string | null;
}

export const SLOTS: { key: TimeSlot; label: string }[] = [
  { key: "morning", label: "午前中" },
  { key: "afternoon", label: "午後" },
  { key: "evening", label: "夜" },
];

export const SLOT_LABEL: Record<TimeSlot, string> = {
  morning: "午前中",
  afternoon: "午後",
  evening: "夜",
};

export function currentSlot(now: Date): TimeSlot {
  const h = now.getHours();
  return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}

export function formatMinutes(m: number): string {
  return m >= 60
    ? `${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ""}`
    : `${m}分`;
}

export function toDateParam(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function formatDateLabel(d: Date): string {
  const wd = "日月火水木金土"[d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日（${wd}）`;
}

export function formatClock(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface RunView {
  done: RunTask[];
  queue: RunTask[]; // 未完了。先頭が「いま着手」
  total: number;
  remainMinutes: number;
}

/** APIは時間帯→実行順で返すので、その順序を保ったまま完了/未完了に分ける。 */
export function buildRunView(tasks: RunTask[]): RunView {
  const done = tasks.filter((t) => t.status === "done");
  const queue = tasks.filter((t) => t.status !== "done");
  return {
    done,
    queue,
    total: tasks.length,
    remainMinutes: queue.reduce((a, t) => a + (t.estimate_minutes ?? 0), 0),
  };
}
