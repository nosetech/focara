import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ORGANIZE_SCREENS,
  countTasks,
  dateNavLabel,
  isOrganizeScreen,
  screenSub,
} from "./organize.ts";

test("整理画面のキーを判定できる", () => {
  assert.equal(ORGANIZE_SCREENS.length, 8);
  assert.ok(isOrganizeScreen("inbox"));
  assert.ok(!isOrganizeScreen("unknown"));
});

test("件数はステータスごとに数え、assign は日付未設定の next だけ", () => {
  const c = countTasks(
    [
      { status: "inbox" },
      { status: "inbox" },
      { status: "next", scheduled_date: null },
      { status: "next", scheduled_date: "2026-10-26" },
    ],
    [{ active: true }, { active: true }, { active: false }],
  );
  assert.deepEqual(c, {
    inbox: 2,
    assign: 1,
    waiting: 0,
    someday: 0,
    habits: 2,
    endedHabits: 0,
  });
});

test("日付ラベルと補足", () => {
  const d = new Date(2026, 9, 26); // 月曜
  assert.equal(dateNavLabel("day", d), "10月26日（月）");
  assert.equal(dateNavLabel("week", d), "10月26日 – 1日");
  assert.equal(screenSub("inbox", null, d), "");
  const counts = {
    inbox: 3,
    assign: 0,
    waiting: 0,
    someday: 0,
    habits: 0,
    endedHabits: 0,
  };
  assert.equal(screenSub("inbox", counts, d), "3件 · 未整理");
});

test("習慣の件数は終了を含めない", () => {
  const c = countTasks(
    [],
    [
      { active: true, ended: false },
      { active: true, ended: true },
      { active: false, ended: false },
    ],
  );
  assert.equal(c.habits, 1);
});

test("習慣の補足は終了した習慣があれば件数と表示状態を添える", () => {
  const d = new Date(2026, 9, 26);
  const counts = {
    inbox: 0,
    assign: 0,
    waiting: 0,
    someday: 0,
    habits: 2,
    endedHabits: 3,
  };
  assert.equal(
    screenSub("habits", counts, d),
    "2件 · 直近7回の実施状況 · 終了 3件を非表示",
  );
  assert.equal(
    screenSub("habits", counts, d, true),
    "2件 · 直近7回の実施状況 · 終了 3件",
  );
  assert.equal(
    screenSub("habits", { ...counts, endedHabits: 0 }, d),
    "2件 · 直近7回の実施状況",
  );
});
