import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultRule,
  draftBody,
  draftFromHabit,
  dotCounts,
  draftSummary,
  emptyDraft,
  fixedTimeError,
  fixedTimeText,
  propertyError,
  seedFromTask,
  recentDots,
  ruleFromHabit,
  ruleText,
  type Habit,
} from "./habits.ts";

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 1,
  title: "朝の散歩",
  project_id: null,
  priority: 2,
  estimate_minutes: 20,
  memo: null,
  time_slot: "morning",
  fixed_start_time: null,
  fixed_end_time: null,
  properties: [],
  recurrence_type: "weekly",
  recurrence_weekdays: 127,
  recurrence_month_day: null,
  recurrence_month: null,
  recurrence_day: null,
  recurrence_end_type: "none",
  recurrence_end_date: null,
  recurrence_end_count: null,
  start_date: "2026-10-01",
  active: true,
  recent: [],
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  ...over,
});

test("全曜日の週次は毎日、月曜始まりで並べて表記する", () => {
  assert.deepEqual(ruleFromHabit(habit()), { type: "daily" });
  assert.equal(ruleText({ type: "daily" }), "毎日");
  assert.equal(
    ruleText({ type: "weekly", days: [0, 5, 1, 3] }),
    "毎週 月・水・金・日",
  );
  assert.equal(
    ruleText({ type: "weekly", days: [1, 2, 3, 4, 5] }),
    "平日(月〜金)",
  );
  assert.equal(ruleText({ type: "monthly", mday: null }), "毎月 月末");
  assert.equal(ruleText({ type: "monthly", mday: 15 }), "毎月 15日");
  assert.equal(ruleText({ type: "yearly", month: 3, day: 9 }), "毎年 3月9日");
});

test("親のルールを編集値へ復元する", () => {
  const h = habit({
    recurrence_weekdays: (1 << 1) | (1 << 3),
    recurrence_end_type: "count",
    recurrence_end_count: 5,
  });
  const d = draftFromHabit(h);
  assert.deepEqual(d.rule, { type: "weekly", days: [1, 3] });
  assert.deepEqual(d.end, { type: "count", count: 5 });
  assert.deepEqual(
    ruleFromHabit(
      habit({ recurrence_type: "monthly", recurrence_month_day: -1 }),
    ),
    { type: "monthly", mday: null },
  );
});

test("編集値をAPI本文へ変換する(使わないルール項目は null)", () => {
  const today = new Date(2026, 9, 15);
  const base = { ...emptyDraft(today), title: " 散歩 " };
  const daily = draftBody(base);
  assert.ok("body" in daily);
  assert.equal(daily.body.title, "散歩");
  assert.equal(daily.body.recurrence_type, "weekly");
  assert.equal(daily.body.recurrence_weekdays, 127);
  assert.equal(daily.body.recurrence_month_day, null);
  assert.equal(daily.body.start_date, "2026-10-15");
  assert.equal(daily.body.recurrence_end_type, "none");

  const monthly = draftBody({ ...base, rule: { type: "monthly", mday: null } });
  assert.ok("body" in monthly);
  assert.equal(monthly.body.recurrence_month_day, -1);
  assert.equal(monthly.body.recurrence_weekdays, null);

  const yearly = draftBody({
    ...base,
    rule: { type: "yearly", month: 2, day: 29 },
    end: { type: "date", date: "2027-01-01" },
  });
  assert.ok("body" in yearly);
  assert.equal(yearly.body.recurrence_month, 2);
  assert.equal(yearly.body.recurrence_end_date, "2027-01-01");
  assert.equal(yearly.body.recurrence_end_count, null);
});

test("不正な編集値は弾く", () => {
  const base = { ...emptyDraft(new Date(2026, 9, 15)), title: "x" };
  assert.ok("error" in draftBody({ ...base, title: "  " }));
  assert.ok(
    "error" in draftBody({ ...base, rule: { type: "weekly", days: [] } }),
  );
  assert.ok(
    "error" in draftBody({ ...base, end: { type: "count", count: null } }),
  );
  assert.ok(
    "error" in draftBody({ ...base, end: { type: "count", count: 0 } }),
  );
  assert.ok("error" in draftBody({ ...base, end: { type: "date", date: "" } }));
  assert.ok(
    "error" in
      draftBody({ ...base, end: { type: "date", date: "2026-10-01" } }),
  );
});

test("種類を切り替えると開始日から初期値を作る", () => {
  const prev = { type: "daily" } as const;
  assert.deepEqual(defaultRule("weekly", "2026-10-15", prev), {
    type: "weekly",
    days: [4],
  });
  assert.deepEqual(defaultRule("monthly", "2026-10-15", prev), {
    type: "monthly",
    mday: 15,
  });
  assert.deepEqual(defaultRule("yearly", "2026-10-15", prev), {
    type: "yearly",
    month: 10,
    day: 15,
  });
  assert.equal(defaultRule("daily", "2026-10-15", prev), prev);
});

test("直近の実施状況は古い順の完了/未完了/今日", () => {
  const today = new Date(2026, 9, 15);
  const dots = recentDots(
    [
      { task_id: 3, occurrence_date: "2026-10-15", status: "next" },
      { task_id: 2, occurrence_date: "2026-10-14", status: "next" },
      { task_id: 1, occurrence_date: "2026-10-13", status: "done" },
    ],
    today,
  );
  assert.deepEqual(dots, ["done", "miss", "today"]);
  assert.deepEqual(dotCounts(dots), { done: 1, total: 2 });
  assert.deepEqual(recentDots([], today), []);
});

test("要約にルール・枠・開始日・終了条件を並べる", () => {
  const d = {
    ...emptyDraft(new Date(2026, 9, 15)),
    end: { type: "count", count: 60 } as const,
  };
  assert.equal(
    draftSummary(d, 18),
    "毎日 · 午前中に作成 · 2026/10/15 から · 累計60回で終了(現在 18回)",
  );
});

test("予定時刻とプロパティを編集値と往復し、本文に含める", () => {
  const h = habit({
    fixed_start_time: "09:00",
    fixed_end_time: "10:00",
    properties: [
      { key: "体重", value_type: "number", unit: "kg" },
      { key: "メモ", value_type: "string", unit: null },
    ],
  });
  const d = draftFromHabit(h);
  assert.deepEqual(
    [d.fixedStart, d.fixedEnd, d.properties],
    [
      "09:00",
      "10:00",
      [
        { key: "体重", type: "number", unit: "kg" },
        { key: "メモ", type: "string", unit: "" },
      ],
    ],
  );
  const r = draftBody(d);
  assert.ok("body" in r);
  assert.equal(r.body.fixed_start_time, "09:00");
  assert.equal(r.body.fixed_end_time, "10:00");
  assert.deepEqual(r.body.properties, [
    { key: "体重", value_type: "number", unit: "kg" },
    { key: "メモ", value_type: "string", unit: null },
  ]);
  const e = emptyDraft(new Date(2026, 9, 1));
  assert.deepEqual([e.fixedStart, e.fixedEnd, e.properties], ["", "", []]);
  const none = draftBody({ ...e, title: "x" });
  assert.ok("body" in none);
  assert.equal(none.body.fixed_start_time, null);
});

test("予定時刻の検証(終了のみ・終了が開始以前・書式不正)", () => {
  assert.equal(fixedTimeError("", ""), null);
  assert.equal(fixedTimeError("09:00", ""), null);
  assert.equal(fixedTimeError("09:00", "10:00"), null);
  assert.ok(fixedTimeError("", "10:00"));
  assert.ok(fixedTimeError("10:00", "10:00"));
  assert.ok(fixedTimeError("11:00", "10:00"));
  assert.ok(fixedTimeError("9:00", ""));
  const d = {
    ...emptyDraft(new Date(2026, 9, 1)),
    title: "x",
    fixedEnd: "10:00",
  };
  assert.ok("error" in draftBody(d));
  assert.equal(fixedTimeText("09:00", "10:00"), "09:00–10:00");
  assert.equal(fixedTimeText("09:00", ""), "09:00–");
  assert.equal(fixedTimeText("", ""), "");
});

test("プロパティ名は空・重複を許さない", () => {
  const k = (...keys: string[]) => keys.map((key) => ({ key }));
  assert.equal(propertyError(k("a", "b")), null);
  assert.ok(propertyError(k("a", " ")));
  assert.ok(propertyError(k("a", "a ")));
  const d = {
    ...emptyDraft(new Date(2026, 9, 1)),
    title: "x",
    properties: [
      { key: "a", type: "string" as const, unit: "" },
      { key: "a", type: "string" as const, unit: "" },
    ],
  };
  assert.ok("error" in draftBody(d));
});

test("習慣にする: プロパティ名と予定時刻を引き継ぎ、値は引き継がない", () => {
  const at = new Date(2026, 9, 5, 14, 30).toISOString();
  const end = new Date(2026, 9, 5, 15, 15).toISOString();
  const p = (
    key: string,
    value_type: "string" | "number" | "date",
    unit: string | null = null,
  ) => ({
    key,
    value_type,
    unit,
  });
  const seed = seedFromTask({ fixed_at: at, fixed_end_at: end }, [
    p("体重", "number", "kg"),
    p("体重", "string"),
    p(" ", "string"),
    p("期限", "date"),
  ]);
  assert.deepEqual(seed, {
    properties: [
      { key: "体重", type: "number", unit: "kg" },
      { key: "期限", type: "date", unit: "" },
    ],
    fixedStart: "14:30",
    fixedEnd: "15:15",
    slot: "afternoon",
  });
  assert.deepEqual(seedFromTask({ fixed_at: null, fixed_end_at: null }, []), {
    properties: [],
  });
  const next = new Date(2026, 9, 6, 1, 0).toISOString();
  assert.equal(
    seedFromTask({ fixed_at: at, fixed_end_at: next }, []).fixedEnd,
    "",
  );
});

test("要約は予定時刻があれば枠の代わりに時刻を出す", () => {
  const d = {
    ...emptyDraft(new Date(2026, 9, 1)),
    fixedStart: "09:00",
    fixedEnd: "10:00",
  };
  assert.match(draftSummary(d, 0), /09:00–10:00に作成/);
});
