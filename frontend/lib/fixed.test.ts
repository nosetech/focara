import assert from "node:assert/strict";
import { test } from "node:test";
import { fixedBody, formatRange, overlappingIds, splitFixed } from "./fixed.ts";

const at = (date: string, time: string) =>
  new Date(`${date}T${time}`).toISOString();

test("開始が空なら日時指定を外す", () => {
  assert.deepEqual(fixedBody({ date: "2026-10-28", start: "", end: "" }), {
    body: { fixed_at: null, fixed_end_at: null },
    slot: null,
  });
});

test("開始なしで終了だけはエラー", () => {
  assert.ok(
    "error" in fixedBody({ date: "2026-10-28", start: "", end: "10:00" }),
  );
});

test("日付なしはエラー", () => {
  assert.ok("error" in fixedBody({ date: "", start: "10:00", end: "" }));
});

test("終了が開始以前ならエラー", () => {
  assert.ok(
    "error" in fixedBody({ date: "2026-10-28", start: "10:00", end: "10:00" }),
  );
});

test("日時と時間帯を組み立てる", () => {
  assert.deepEqual(
    fixedBody({ date: "2026-10-28", start: "15:00", end: "16:30" }),
    {
      body: {
        scheduled_date: "2026-10-28",
        fixed_at: at("2026-10-28", "15:00"),
        fixed_end_at: at("2026-10-28", "16:30"),
      },
      slot: "afternoon",
    },
  );
});

test("ISO日時をローカルの日付・時刻に戻す", () => {
  const iso = at("2026-10-28", "09:05");
  assert.deepEqual(splitFixed(iso, null, null), {
    date: "2026-10-28",
    start: "09:05",
    end: "",
  });
  assert.deepEqual(splitFixed(null, null, "2026-10-29"), {
    date: "2026-10-29",
    start: "",
    end: "",
  });
});

test("時間が重なる予定を検出する(接するだけは重ならない)", () => {
  const t = (
    id: number,
    s: string,
    e: string | null,
    est: number | null = null,
  ) => ({
    id,
    fixed_at: at("2026-10-28", s),
    fixed_end_at: e ? at("2026-10-28", e) : null,
    estimate_minutes: est,
  });
  const ids = overlappingIds([
    t(1, "10:00", "11:00"),
    t(2, "10:30", "11:30"),
    t(3, "11:30", "12:00"),
    t(4, "13:00", null, 60),
    t(5, "13:30", null),
    t(6, "15:00", null),
  ]);
  assert.deepEqual([...ids].sort(), [1, 2, 4, 5]);
});

test("範囲の表示", () => {
  assert.equal(
    formatRange(at("2026-10-28", "10:00"), at("2026-10-28", "11:00")),
    "10:00–11:00",
  );
  assert.equal(formatRange(at("2026-10-28", "10:00"), null), "10:00〜");
});
