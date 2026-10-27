import assert from "node:assert/strict";
import { test } from "node:test";
import {
  recentHistory,
  recurrenceLabel,
  ruleBody,
  toRuleDraft,
  waitBody,
  type ListTask,
} from "./statusList.ts";

const base = {
  recurrence_type: null,
  recurrence_weekdays: null,
  recurrence_month_day: null,
  recurrence_month: null,
  recurrence_day: null,
  recurrence_end_type: "none",
  recurrence_end_date: null,
  recurrence_end_count: null,
} as unknown as ListTask;

test("繰り返しルールを表記する", () => {
  const t = (p: Partial<ListTask>) => ({ ...base, ...p });
  assert.equal(recurrenceLabel(base), "繰り返しなし");
  assert.equal(
    recurrenceLabel(t({ recurrence_type: "weekly", recurrence_weekdays: 127 })),
    "毎日",
  );
  assert.equal(
    recurrenceLabel(
      t({ recurrence_type: "weekly", recurrence_weekdays: 0b0100001 }),
    ),
    "毎週 日金",
  );
  assert.equal(
    recurrenceLabel(
      t({ recurrence_type: "monthly", recurrence_month_day: -1 }),
    ),
    "毎月 月末",
  );
  assert.equal(
    recurrenceLabel(
      t({ recurrence_type: "yearly", recurrence_month: 3, recurrence_day: 5 }),
    ),
    "毎年 3月5日",
  );
});

test("直近7日の実施状況は同名タスクの完了記録から作る", () => {
  const today = new Date(2026, 9, 27, 12);
  const logs = [
    {
      task_title: "散歩",
      action: "completed",
      created_at: new Date(2026, 9, 26, 8).toISOString(),
    },
    {
      task_title: "散歩",
      action: "postponed",
      created_at: new Date(2026, 9, 25, 8).toISOString(),
    },
    {
      task_title: "他",
      action: "completed",
      created_at: new Date(2026, 9, 24, 8).toISOString(),
    },
  ];
  assert.deepEqual(recentHistory("散歩", logs, today), [
    0,
    0,
    0,
    0,
    0,
    1,
    null,
  ]);
  logs.push({
    task_title: "散歩",
    action: "completed",
    created_at: today.toISOString(),
  });
  assert.equal(recentHistory("散歩", logs, today)[6], 1);
});

test("ルールの下書きをAPI本文に変換し、不正は弾く", () => {
  const d = toRuleDraft(base);
  assert.deepEqual(ruleBody(d), {
    body: {
      recurrence_type: "weekly",
      recurrence_end_type: "none",
      recurrence_weekdays: 127,
    },
  });
  assert.ok("error" in ruleBody({ ...d, weekdays: 0 }));
  assert.ok("error" in ruleBody({ ...d, type: "monthly", monthDay: "32" }));
  assert.deepEqual(
    ruleBody({
      ...d,
      type: "monthly",
      monthDay: "-1",
      endType: "count",
      endCount: "3",
    }),
    {
      body: {
        recurrence_type: "monthly",
        recurrence_end_type: "count",
        recurrence_month_day: -1,
        recurrence_end_count: 3,
      },
    },
  );
  assert.ok("error" in ruleBody({ ...d, endType: "date", endDate: "" }));
});

test("待ち条件は条件か日時のどちらかが必要", () => {
  assert.ok("error" in waitBody("  ", ""));
  assert.deepEqual(waitBody(" 返信 ", ""), {
    wait_condition: "返信",
    wait_until: null,
  });
});
