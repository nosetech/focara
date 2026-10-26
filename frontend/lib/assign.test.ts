import assert from "node:assert/strict";
import { test } from "node:test";
import {
  insertAt,
  isCandidate,
  slotTasks,
  totalEstimate,
  type AssignTask,
} from "./assign.ts";

const t = (id: number, o: Partial<AssignTask> = {}): AssignTask => ({
  id,
  title: `t${id}`,
  status: "next",
  project_id: null,
  estimate_minutes: null,
  scheduled_date: null,
  time_slot: null,
  run_order: null,
  ...o,
});

test("isCandidate: 日付未設定の next のみ", () => {
  assert.equal(isCandidate(t(1)), true);
  assert.equal(isCandidate(t(2, { status: "inbox" })), false);
  assert.equal(isCandidate(t(3, { scheduled_date: "2026-10-26" })), false);
});

test("slotTasks: 枠で絞り run_order 順、未設定は末尾", () => {
  const list = [
    t(1, { time_slot: "morning", run_order: 1 }),
    t(2, { time_slot: "morning", run_order: 0 }),
    t(3, { time_slot: "morning" }),
    t(4, { time_slot: "evening", run_order: 0 }),
  ];
  assert.deepEqual(
    slotTasks(list, "morning").map((x) => x.id),
    [2, 1, 3],
  );
});

test("totalEstimate: 未設定は0として合計", () => {
  assert.equal(
    totalEstimate([
      t(1, { estimate_minutes: 30 }),
      t(2),
      t(3, { estimate_minutes: 15 }),
    ]),
    45,
  );
});

test("insertAt: 指定位置・末尾・既存の移動", () => {
  assert.deepEqual(insertAt([1, 2, 3], 9, 1), [1, 9, 2, 3]);
  assert.deepEqual(insertAt([1, 2, 3], 9), [1, 2, 3, 9]);
  assert.deepEqual(insertAt([1, 2, 3], 1, 3), [2, 3, 1]);
  assert.deepEqual(insertAt([1, 2], 9, 99), [1, 2, 9]);
});
