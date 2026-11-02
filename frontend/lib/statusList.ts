import type { AssignTask } from "./assign";
import type { InboxTask } from "./inbox";

export type ListStatus = "waiting" | "someday";

export interface ListTask extends InboxTask {
  scheduled_date: string | null;
  time_slot: AssignTask["time_slot"];
  wait_condition: string | null;
  wait_until: string | null;
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
};

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
