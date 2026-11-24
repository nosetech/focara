import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDuration, parseDuration } from "./duration.ts";

test("HH:MM:SS を秒にする", () => {
  assert.equal(parseDuration("00:00:00"), 0);
  assert.equal(parseDuration("01:02:03"), 3723);
  assert.equal(parseDuration("100:00:00"), 360000);
  assert.equal(parseDuration(" 00:59:59 "), 3599);
});

test("MM:SS は分:秒として補完する", () => {
  assert.equal(parseDuration("59:59"), 3599);
  assert.equal(parseDuration("5:07"), 307);
});

test("不正な入力は null", () => {
  for (const s of [
    "",
    "abc",
    "00:60:00",
    "00:00:60",
    "1",
    "-1:00:00",
    "1:2:3",
    "60:00",
  ])
    assert.equal(parseDuration(s), null, s);
});

test("秒を HH:MM:SS に整形する", () => {
  assert.equal(formatDuration("0"), "00:00:00");
  assert.equal(formatDuration("3723"), "01:02:03");
  assert.equal(formatDuration("360000"), "100:00:00");
});

test("空・不正な秒数は空文字", () => {
  assert.equal(formatDuration(""), "");
  assert.equal(formatDuration(null), "");
  assert.equal(formatDuration("1.5"), "");
});
