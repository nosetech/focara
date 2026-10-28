import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_FILTERS,
  effectiveFilters,
  filterInbox,
  formatEstimate,
  nextFocus,
  transitionBody,
  type InboxTask,
} from "./inbox.ts";

const t = (id: number, o: Partial<InboxTask> = {}): InboxTask => ({
  id,
  title: `t${id}`,
  status: "inbox",
  project_id: null,
  priority: null,
  estimate_minutes: null,
  created_at: "2026-10-14T00:00:00Z",
  ...o,
});
const name = (id: number | null) => (id === 1 ? "b" : id === 2 ? "a" : "");

test("絞り込み: プロジェクト・優先度・ステータス", () => {
  const l = [t(1, { project_id: 1, priority: 1 }), t(2), t(3, { priority: 2 })];
  const ids = (f: Partial<typeof DEFAULT_FILTERS>) =>
    filterInbox(l, { ...DEFAULT_FILTERS, ...f }, name).map((x) => x.id);
  assert.deepEqual(ids({}), [1, 2, 3]);
  assert.deepEqual(ids({ project: "1" }), [1]);
  assert.deepEqual(ids({ project: "none" }), [2, 3]);
  assert.deepEqual(ids({ pri: "中" }), [3]);
  assert.deepEqual(ids({ status: "next" }), []);
});

test("並び替え: 優先度順・見積もりが短い順(未設定は後ろ)・プロジェクト順", () => {
  const l = [
    t(1, { priority: 3, estimate_minutes: 30, project_id: 1 }),
    t(2, { estimate_minutes: 10, project_id: 2 }),
    t(3, { priority: 1 }),
  ];
  const ids = (sort: string) =>
    filterInbox(l, { ...DEFAULT_FILTERS, sort }, name).map((x) => x.id);
  assert.deepEqual(ids("pri"), [3, 1, 2]);
  assert.deepEqual(ids("est"), [2, 1, 3]);
  assert.deepEqual(ids("project"), [3, 2, 1]);
});

test("振り分け本文と補助関数", () => {
  assert.deepEqual(transitionBody("next"), { status: "next" });
  assert.deepEqual(transitionBody("waiting", " 返信待ち "), {
    status: "waiting",
    wait_condition: "返信待ち",
  });
  assert.equal(formatEstimate(90), "1時間30分");
  assert.equal(formatEstimate(45), "45分");
  assert.equal(formatEstimate(null), "");
  assert.equal(nextFocus(5, 3), 2);
  assert.equal(nextFocus(1, 0), 0);
});

test("ステータス絞り込みはプロジェクト画面だけ有効", () => {
  const f = { ...DEFAULT_FILTERS, status: "next", pri: "P1" };
  for (const screen of ["inbox", "waiting", "someday", "habit"])
    assert.deepEqual(effectiveFilters(screen, f), { ...f, status: "" });
  assert.deepEqual(effectiveFilters("projects", f), f);
});
