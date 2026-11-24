import assert from "node:assert/strict";
import { test } from "node:test";
import {
  insertAt,
  isAssignable,
  isCandidate,
  slotTasks,
  totalEstimate,
  unslotted,
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
  fixed_at: null,
  habit_id: null,
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

test("unslotted: 日付ありで時間帯未設定のみ", () => {
  const list = [
    t(1, { scheduled_date: "2026-10-26", time_slot: null, run_order: 2 }),
    t(2, { scheduled_date: "2026-10-26", time_slot: "morning" }),
    t(3, { scheduled_date: "2026-10-26", time_slot: null }),
    t(4),
  ];
  assert.deepEqual(
    unslotted(list).map((x) => x.id),
    [1, 3],
  );
});

test("slotTasks / unslotted: 予定時刻ありは、その位置の中で開始順に並べ、動かせるのは予定時刻なしだけ", () => {
  const sorted = slotTasks(
    [
      t(1, { time_slot: "morning", run_order: 0 }),
      t(2, {
        time_slot: "morning",
        run_order: 1,
        fixed_at: "2026-10-20T01:00:00Z",
      }),
      t(3, {
        time_slot: "morning",
        run_order: 2,
        fixed_at: "2026-10-19T23:00:00Z",
      }),
    ],
    "morning",
  );
  assert.deepEqual(
    sorted.map((x) => x.id),
    [1, 3, 2],
  );
  assert.deepEqual(sorted.map(isAssignable), [true, false, false]);
});
