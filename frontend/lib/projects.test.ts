import assert from "node:assert/strict";
import { test } from "node:test";
import {
  groupByStatus,
  movedOrder,
  projectProgress,
  type ProjectTask,
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
  ...o,
});

test("進捗: 習慣は件数に含めない", () => {
  const p = projectProgress([
    t(1, { status: "done" }),
    t(2),
    t(3, { status: "habit" }),
  ]);
  assert.deepEqual(p, { done: 1, total: 2, pct: 50 });
  assert.equal(projectProgress([]).pct, 0);
});

test("グループ化: 並び順に従い、空のグループは出さない", () => {
  const g = groupByStatus([
    t(1, { project_order: 1 }),
    t(2, { project_order: 0 }),
    t(3, { status: "done" }),
  ]);
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
