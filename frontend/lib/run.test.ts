import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRunView,
  currentSlot,
  postponeBody,
  dragOffset,
  isDayOver,
  moveBody,
  somedayBody,
  tomorrowParam,
  restoreBody,
  formatDateLabel,
  formatMinutes,
  formatNow,
  progressPercent,
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
  habit_id: null,
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

test("isDayOver: 夜の枠が終わって未完了が残るときだけ", () => {
  assert.equal(isDayOver(new Date(2026, 9, 15, 22), 2, false, 22), true);
  assert.equal(isDayOver(new Date(2026, 9, 15, 21), 2, false, 22), false);
  assert.equal(isDayOver(new Date(2026, 9, 15, 23), 0, false, 22), false);
  assert.equal(isDayOver(new Date(2026, 9, 15, 23), 2, true, 22), false);
  assert.equal(isDayOver(new Date(2026, 9, 15, 20), 2, false, 20), true);
  assert.equal(isDayOver(new Date(2026, 9, 15, 19), 2, false, 20), false);
  assert.equal(isDayOver(new Date(2026, 9, 15, 0), 2, false, 0), true);
});

test("予定を変える: 翌日・指定日・いつか", () => {
  assert.equal(tomorrowParam(new Date(2026, 9, 31)), "2026-11-01");
  assert.deepEqual(moveBody("2026-11-01"), {
    target: "date",
    scheduled_date: "2026-11-01",
    time_slot: "morning",
  });
  assert.equal(somedayBody().status, "someday");
  assert.equal(somedayBody().scheduled_date, null);
});

test("formatNow は HH:MM でゼロ埋めする", () => {
  assert.equal(formatNow(new Date(2026, 0, 5, 9, 3)), "09:03");
  assert.equal(formatNow(new Date(2026, 0, 5, 18, 45)), "18:45");
});

test("progressPercent は総数0で0、それ以外は四捨五入", () => {
  assert.equal(progressPercent(0, 0), 0);
  assert.equal(progressPercent(1, 3), 33);
  assert.equal(progressPercent(2, 3), 67);
  assert.equal(progressPercent(3, 3), 100);
});

test("postponeBody は現在の時間帯の最後へ送る", () => {
  assert.deepEqual(postponeBody(new Date(2026, 9, 15, 9)), {
    target: "end_of_day",
    time_slot: "morning",
  });
  assert.equal(postponeBody(new Date(2026, 9, 15, 13)).time_slot, "afternoon");
  assert.equal(postponeBody(new Date(2026, 9, 15, 20)).time_slot, "evening");
});
