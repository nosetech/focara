import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cellTasks,
  dayCount,
  isMovable,
  rangeDays,
  weekDays,
  type CalendarTask,
} from "./calendar.ts";

const t = (id: number, o: Partial<CalendarTask> = {}): CalendarTask => ({
  id,
  title: `t${id}`,
  status: "next",
  project_id: null,
  estimate_minutes: null,
  scheduled_date: "2026-10-27",
  time_slot: "morning",
  run_order: null,
  fixed_at: null,
  fixed_end_at: null,
  ...o,
});

test("weekDays: 月曜始まりの7日", () => {
  const days = weekDays(new Date(2026, 9, 25)); // 日曜
  assert.equal(days.length, 7);
  assert.equal(days[0].getDay(), 1);
  assert.equal(days[6].getDay(), 0);
  assert.equal(days[6].getDate(), 25);
});

test("rangeDays: 日は1日、週は7日", () => {
  const d = new Date(2026, 9, 27);
  assert.equal(rangeDays("day", d).length, 1);
  assert.equal(rangeDays("week", d).length, 7);
});

test("cellTasks: 予定が開始順で先頭、タスクは run_order 順", () => {
  const list = [
    t(1, { run_order: 1 }),
    t(2, { run_order: 0 }),
    t(3, { fixed_at: "2026-10-27T10:00:00Z" }),
    t(4, { fixed_at: "2026-10-27T09:00:00Z" }),
    t(5, { time_slot: "evening" }),
    t(6, { scheduled_date: "2026-10-28" }),
  ];
  assert.deepEqual(
    cellTasks(list, "2026-10-27", "morning").map((x) => x.id),
    [4, 3, 2, 1],
  );
});

test("dayCount / isMovable", () => {
  const list = [t(1), t(2, { scheduled_date: "2026-10-28" })];
  assert.equal(dayCount(list, "2026-10-27"), 1);
  assert.equal(isMovable(t(3)), true);
  assert.equal(isMovable(t(4, { fixed_at: "2026-10-27T10:00:00Z" })), false);
});
