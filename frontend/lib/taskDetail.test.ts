import assert from "node:assert/strict";
import { test } from "node:test";
import { newDraft, propertyBody, toDraft } from "./taskDetail.ts";

test("名前が空の行は保存対象外", () => {
  assert.equal(propertyBody({ ...newDraft(1), key: "  " }), null);
});

test("文字は値をそのまま送り、単位は送らない", () => {
  const d = { ...newDraft(1), key: " 場所 ", value: "会議室", unit: "kg" };
  assert.deepEqual(propertyBody(d), {
    key: "場所",
    value: "会議室",
    value_type: "string",
    unit: null,
  });
});

test("数値は数値化し、単位を付ける", () => {
  const d = {
    ...newDraft(1),
    key: "体重",
    value: "62.5",
    value_type: "number" as const,
    unit: " kg ",
  };
  assert.deepEqual(propertyBody(d), {
    key: "体重",
    value: 62.5,
    value_type: "number",
    unit: "kg",
  });
});

test("数値が不正ならエラー", () => {
  const d = {
    ...newDraft(1),
    key: "a",
    value: "abc",
    value_type: "number" as const,
  };
  assert.deepEqual(propertyBody(d), { error: "数値を入力してください" });
});

test("日付が未入力ならエラー", () => {
  const d = { ...newDraft(1), key: "a", value_type: "date" as const };
  assert.deepEqual(propertyBody(d), { error: "日付を選んでください" });
});

test("APIの行を編集用に変換する", () => {
  const d = toDraft({
    id: 3,
    task_id: 1,
    key: "k",
    value: null,
    value_type: "number",
    unit: null,
  });
  assert.equal(d.id, 3);
  assert.equal(d.value, "");
  assert.equal(d.unit, "");
});

import {
  defaultRepeat,
  repeatBody,
  repeatFromTask,
  repeatSummary,
  weekdaysFromMask,
  weekdaysToMask,
} from "./taskDetail.ts";

test("曜日はビットマスク(bit0=日)と相互変換できる", () => {
  assert.equal(weekdaysToMask([1, 3, 5]), 0b0101010);
  assert.deepEqual(weekdaysFromMask(0b0101010), [1, 3, 5]);
});

test("既定の繰り返しは日付の曜日・日にち・月日から作る", () => {
  const r = defaultRepeat("weekly", "2026-10-15");
  assert.deepEqual(r.days, [4]);
  assert.equal(r.mday, 15);
  assert.equal(r.month, 10);
  assert.equal(r.day, 15);
});

test("週次・月次・年次を本文に変換する", () => {
  const w = { ...defaultRepeat("weekly", "2026-10-15"), days: [1, 3] };
  assert.deepEqual(repeatBody(w), {
    body: {
      recurrence_type: "weekly",
      recurrence_weekdays: 0b0001010,
      recurrence_month_day: null,
      recurrence_month: null,
      recurrence_day: null,
      recurrence_end_type: "none",
      recurrence_end_date: null,
      recurrence_end_count: null,
    },
  });
  const m = { ...defaultRepeat("monthly", "2026-10-15"), mday: null };
  assert.deepEqual(
    (repeatBody(m) as { body: Record<string, unknown> }).body
      .recurrence_month_day,
    -1,
  );
  const y = defaultRepeat("yearly", "2026-10-15");
  const yb = (repeatBody(y) as { body: Record<string, unknown> }).body;
  assert.equal(yb.recurrence_month, 10);
  assert.equal(yb.recurrence_day, 15);
});

test("曜日なし・終了条件の未入力はエラー", () => {
  const w = { ...defaultRepeat("weekly", null), days: [] };
  assert.ok("error" in repeatBody(w));
  const d = { ...defaultRepeat("monthly", null), endType: "date" as const };
  assert.ok("error" in repeatBody(d));
  const c = { ...defaultRepeat("monthly", null), endType: "count" as const };
  assert.ok("error" in repeatBody(c));
});

test("タスクの繰り返し項目から編集値を復元する", () => {
  const r = repeatFromTask({
    recurrence_type: "monthly",
    recurrence_weekdays: null,
    recurrence_month_day: -1,
    recurrence_month: null,
    recurrence_day: null,
    recurrence_end_type: "count",
    recurrence_end_date: null,
    recurrence_end_count: 3,
  });
  assert.equal(r?.mday, null);
  assert.equal(repeatSummary(r!), "毎月 月末 · 3回で終了");
  assert.equal(repeatFromTask({ recurrence_type: null } as never), null);
});

test("繰り返しの説明文", () => {
  const w = { ...defaultRepeat("weekly", null), days: [1, 2, 3, 4, 5] };
  assert.equal(repeatSummary(w), "平日(月〜金) · 終了日なし");
  const y = {
    ...defaultRepeat("yearly", null),
    month: 3,
    day: 9,
    endType: "date" as const,
    endDate: "2027-01-02",
  };
  assert.equal(repeatSummary(y), "毎年 3月9日 · 2027/01/02 まで");
});
