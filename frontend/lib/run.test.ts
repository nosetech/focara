import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRunView,
  currentSlot,
  dragOffset,
  restoreBody,
  spawnsNext,
  formatDateLabel,
  formatMinutes,
  type RunTask,
} from "./run.ts";

const t = (id: number, status: string, est: number | null): RunTask => ({
  id,
  title: `t${id}`,
  status,
  project_id: null,
  priority: null,
  estimate_minutes: est,
  time_slot: "morning",
  fixed_at: null,
  memo: null,
  scheduled_date: null,
  run_order: null,
  fixed_end_at: null,
  recurrence_type: null,
  recurrence_end_type: "none",
  recurrence_end_count: null,
});

test("buildRunView splits done from queue and sums remaining", () => {
  const v = buildRunView([
    t(1, "done", 10),
    t(2, "next", 30),
    t(3, "next", null),
  ]);
  assert.equal(v.done.length, 1);
  assert.deepEqual(
    v.queue.map((x) => x.id),
    [2, 3],
  );
  assert.equal(v.total, 3);
  assert.equal(v.remainMinutes, 30);
});

test("currentSlot / formatters", () => {
  assert.equal(currentSlot(new Date(2026, 9, 15, 9)), "morning");
  assert.equal(currentSlot(new Date(2026, 9, 15, 13)), "afternoon");
  assert.equal(currentSlot(new Date(2026, 9, 15, 20)), "evening");
  assert.equal(formatMinutes(90), "1時間30分");
  assert.equal(formatMinutes(45), "45分");
  assert.equal(formatDateLabel(new Date(2026, 9, 15)), "10月15日（木）");
});

test("spawnsNext: 繰り返しの最終回は次を生成しない", () => {
  const base = t(1, "habit", null);
  assert.equal(spawnsNext(base), false);
  assert.equal(spawnsNext({ ...base, recurrence_type: "daily" }), true);
  assert.equal(
    spawnsNext({
      ...base,
      recurrence_type: "daily",
      recurrence_end_type: "count",
      recurrence_end_count: 1,
    }),
    false,
  );
});

test("restoreBody / dragOffset", () => {
  const r = restoreBody({
    ...t(1, "next", null),
    scheduled_date: "2026-10-21",
    run_order: 2,
  });
  assert.equal(r.scheduled_date, "2026-10-21");
  assert.equal(r.run_order, 2);
  assert.equal(dragOffset(100), 20);
  assert.equal(dragOffset(-100), -100);
});
