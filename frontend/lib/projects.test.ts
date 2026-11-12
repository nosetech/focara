import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assignableProjects,
  byProjectOrder,
  collectTags,
  filterByTags,
  groupByStatus,
  movedOrder,
  normalizeTags,
  openTaskCount,
  projectProgress,
  type ProjectTask,
  visibleProjects,
} from "./projects.ts";

const t = (id: number, o: Partial<ProjectTask> = {}): ProjectTask => ({
  id,
  title: `t${id}`,
  status: "next",
  project_id: 1,
  priority: null,
  estimate_minutes: null,
  created_at: "2026-10-14T00:00:00Z",
  project_order: null,
  scheduled_date: null,
  time_slot: null,
  habit_id: null,
  ...o,
});

test("進捗: 習慣は件数に含めない", () => {
  const p = projectProgress([
    t(1, { status: "done" }),
    t(2),
    t(3, { habit_id: 7 }),
    t(4, { habit_id: 7, status: "done" }),
  ]);
  assert.deepEqual(p, { done: 1, total: 2, pct: 50 });
  assert.equal(projectProgress([]).pct, 0);
});

test("グループ化: 並び順に従い、空のグループは出さない", () => {
  const g = groupByStatus(
    byProjectOrder([
      t(1, { project_order: 1 }),
      t(2, { project_order: 0 }),
      t(3, { status: "done" }),
    ]),
  );
  assert.deepEqual(
    g.map((x) => [x.status, x.tasks.map((y) => y.id)]),
    [
      ["next", [2, 1]],
      ["done", [3]],
    ],
  );
});

test("並べ替え: 同じグループ内でだけ動く", () => {
  const l = [
    t(1),
    t(2, { status: "waiting" }),
    t(3),
    t(4, { status: "waiting" }),
  ];
  assert.deepEqual(movedOrder(l, 3, -1), [3, 2, 1, 4]);
  assert.deepEqual(movedOrder(l, 2, 1), [1, 4, 3, 2]);
  assert.equal(movedOrder(l, 1, -1), null);
  assert.equal(movedOrder(l, 4, 1), null);
  assert.equal(movedOrder(l, 99, 1), null);
});

const proj = (id: number, completed_at: string | null = null) => ({
  id,
  name: `p${id}`,
  completed_at,
});

test("一覧: 既定は未完了のみ、完了も表示で完了済みを含める", () => {
  const ps = [proj(1), proj(2, "2026-11-12T00:00:00Z"), proj(3)];
  assert.deepEqual(
    visibleProjects(ps, false).map((p) => p.id),
    [1, 3],
  );
  assert.deepEqual(
    visibleProjects(ps, true).map((p) => p.id),
    [1, 2, 3],
  );
});

test("割り当て先: 完了済みは外し、現在の所属だけ残す", () => {
  const ps = [proj(1), proj(2, "2026-11-12T00:00:00Z")];
  assert.deepEqual(
    assignableProjects(ps).map((p) => p.id),
    [1],
  );
  assert.deepEqual(
    assignableProjects(ps, 2).map((p) => p.id),
    [1, 2],
  );
});

test("未完了タスク数: done と cancelled は数えない", () => {
  assert.equal(
    openTaskCount([
      { status: "next" },
      { status: "waiting" },
      { status: "done" },
      { status: "cancelled" },
    ]),
    2,
  );
});

test("collectTags: 重複を除き初出順で返す", () => {
  assert.deepEqual(
    collectTags([{ tags: ["a", "b"] }, { tags: [] }, { tags: ["b", "c"] }]),
    ["a", "b", "c"],
  );
});

test("filterByTags: 未指定は全件、複数指定はいずれかを含む(OR)", () => {
  const ps = [
    { id: 1, tags: ["a"] },
    { id: 2, tags: ["b", "c"] },
    { id: 3, tags: [] },
  ];
  assert.deepEqual(
    filterByTags(ps, []).map((p) => p.id),
    [1, 2, 3],
  );
  assert.deepEqual(
    filterByTags(ps, ["a", "c"]).map((p) => p.id),
    [1, 2],
  );
  assert.deepEqual(filterByTags(ps, ["x"]), []);
});

test("normalizeTags: 空白除去・空除外・大文字小文字を区別して重複除去", () => {
  assert.deepEqual(normalizeTags([" a ", "", "a", "A", "  "]), ["a", "A"]);
});
