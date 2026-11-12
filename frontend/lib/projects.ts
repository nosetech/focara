import type { InboxTask } from "./inbox";

export interface ProjectTask extends InboxTask {
  project_order: number | null;
  scheduled_date: string | null;
  time_slot: string | null;
  habit_id: number | null;
}

export interface ProjectSummary {
  id: number;
  name: string;
  description: string | null;
  tags: string[];
  /** 完了日時。null なら未完了 */
  completed_at: string | null;
}

/** 完了しているか(未完了なら false) */
export const isProjectDone = (p: { completed_at?: string | null }) =>
  p.completed_at != null;

/** 一覧に出すプロジェクト。完了済みは showCompleted のときだけ含める。 */
export function visibleProjects<T extends { completed_at?: string | null }>(
  projects: readonly T[],
  showCompleted: boolean,
): T[] {
  return projects.filter((p) => showCompleted || !isProjectDone(p));
}

/** タスク・習慣の割り当て先に選べるプロジェクト。完了済みは外す(現在の所属 keepId は残す)。 */
export function assignableProjects<
  T extends { id: number; completed_at?: string | null },
>(projects: readonly T[], keepId?: number | null): T[] {
  return projects.filter((p) => !isProjectDone(p) || p.id === keepId);
}

/** 完了にするとき一括で完了にする、未完了タスクの件数(done / cancelled は対象外)。 */
export function openTaskCount(tasks: readonly { status: string }[]): number {
  return tasks.filter((t) => t.status !== "done" && t.status !== "cancelled")
    .length;
}

/** 詳細での表示順。完了は最後にまとめる(デザインのグループ順)。 */
export const PROJECT_GROUPS = [
  { status: "next", label: "次にやる" },
  { status: "waiting", label: "条件待ち" },
  { status: "someday", label: "いつか" },
  { status: "inbox", label: "inbox" },
  { status: "done", label: "完了" },
] as const;

/** 進捗。習慣から生成された子(habit_id あり)は繰り返すものなので件数に含めない。 */
export function projectProgress(tasks: readonly ProjectTask[]) {
  const counted = tasks.filter((t) => t.habit_id == null);
  const done = counted.filter((t) => t.status === "done").length;
  return {
    done,
    total: counted.length,
    pct: counted.length ? Math.round((done / counted.length) * 100) : 0,
  };
}

/** プロジェクト内の並び順(project_order の昇順、未設定は末尾、同値は追加順)。 */
export function byProjectOrder(tasks: readonly ProjectTask[]): ProjectTask[] {
  return [...tasks].sort(
    (a, b) =>
      (a.project_order ?? Infinity) - (b.project_order ?? Infinity) ||
      a.id - b.id,
  );
}

/** ステータス別にまとめる。各グループ内は渡された順を保つ。 */
export function groupByStatus(tasks: readonly ProjectTask[]) {
  return PROJECT_GROUPS.map((g) => ({
    ...g,
    tasks: tasks.filter((t) => t.status === g.status),
  })).filter((g) => g.tasks.length > 0);
}

/**
 * id のタスクを同じグループ内で delta(-1=上 / 1=下)だけ動かしたあとの、
 * プロジェクト全体の並び順(タスクID)。動かせない場合は null。
 */
export function movedOrder(
  tasks: readonly ProjectTask[],
  id: number,
  delta: -1 | 1,
): number[] | null {
  const ordered = byProjectOrder(tasks);
  const at = ordered.findIndex((t) => t.id === id);
  if (at < 0) return null;
  const status = ordered[at].status;
  let to = at + delta;
  while (ordered[to] && ordered[to].status !== status) to += delta;
  if (!ordered[to]) return null;
  const ids = ordered.map((t) => t.id);
  [ids[at], ids[to]] = [ids[to], ids[at]];
  return ids;
}

/** 一覧に出すプロジェクトのタグ一覧(重複なし、初出順)。 */
export function collectTags(projects: readonly { tags: string[] }[]): string[] {
  return [...new Set(projects.flatMap((p) => p.tags))];
}

/** タグで絞り込む。複数指定はいずれかを含む(OR)。未指定なら全件。 */
export function filterByTags<T extends { tags: string[] }>(
  projects: readonly T[],
  selected: readonly string[],
): T[] {
  if (selected.length === 0) return [...projects];
  return projects.filter((p) => p.tags.some((t) => selected.includes(t)));
}

/** タグ入力の区切り文字(半角カンマ・読点・全角カンマ)。 */
export const TAG_SEPARATOR = /[,、，]/;

/** タグ名を1つ整える。先頭の # / ＃ を除き、前後空白を除く。 */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^[#＃]/, "")
    .trim();
}

/** 入力されたタグ名を整える。先頭の # を除き、前後空白を除き、空を捨て、重複(大文字小文字を区別)を除く。 */
export function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map(normalizeTag).filter((t) => t !== ""))];
}

/**
 * 入力中のタグ(raw)を既存のタグ(tags)に追加する。重複(大文字小文字を区別)は追加せず、
 * 最後に見つかった重複を dup で返す(「すでに追加されています」の表示用)。
 */
export function addTags(
  tags: readonly string[],
  raw: readonly string[],
): { tags: string[]; dup: string | null } {
  const next = [...tags];
  let dup: string | null = null;
  for (const r of raw) {
    const v = normalizeTag(r);
    if (v === "") continue;
    if (next.includes(v)) dup = v;
    else next.push(v);
  }
  return { tags: next, dup };
}
