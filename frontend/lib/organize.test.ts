import assert from "node:assert/strict";
import { test } from "node:test";
import { ORGANIZE_SCREENS, isOrganizeScreen } from "./organize.ts";

test("整理画面のキーを判定できる", () => {
  assert.equal(ORGANIZE_SCREENS.length, 8);
  assert.ok(isOrganizeScreen("inbox"));
  assert.ok(isOrganizeScreen("habits"));
  assert.ok(!isOrganizeScreen("unknown"));
});
