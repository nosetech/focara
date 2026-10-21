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
