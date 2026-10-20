import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRunView,
  currentSlot,
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
