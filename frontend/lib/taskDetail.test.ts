import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canSaveWaiting,
  commitTitle,
  newDraft,
  propertyBody,
  toDraft,
  waitingBody,
} from "./taskDetail.ts";

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

test("日付が不正ならエラー", () => {
  const d = {
    ...newDraft(1),
    key: "a",
    value: "2026/01/01",
    value_type: "date" as const,
  };
  assert.deepEqual(propertyBody(d), { error: "日付を選んでください" });
});

test("日付が空なら値を空にして保存する(クリア)", () => {
  const d = { ...newDraft(1), key: "a", value_type: "date" as const };
  assert.deepEqual(propertyBody(d), {
    key: "a",
    value: "",
    value_type: "date",
    unit: null,
  });
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

test("条件待ちは条件が空・空白のみだと保存しない", () => {
  assert.equal(canSaveWaiting(""), false);
  assert.equal(canSaveWaiting("  \t "), false);
  assert.equal(waitingBody(""), null);
  assert.equal(waitingBody("   "), null);
});

test("条件待ちは条件を trim して送る", () => {
  assert.equal(canSaveWaiting(" 返信 "), true);
  assert.deepEqual(waitingBody(" 返信待ち "), {
    status: "waiting",
    wait_condition: "返信待ち",
  });
});

test("タスク名の確定はtrimして保存する", () => {
  assert.deepEqual(commitTitle("  新しい名前 ", "古い名前"), {
    title: "新しい名前",
    save: true,
  });
});

test("タスク名が空なら保存せず元の値に戻す", () => {
  assert.deepEqual(commitTitle("   ", "古い名前"), {
    title: "古い名前",
    save: false,
  });
});

test("タスク名が変わっていなければ保存しない", () => {
  assert.deepEqual(commitTitle("古い名前 ", "古い名前"), {
    title: "古い名前",
    save: false,
  });
});

test("時間は秒数にして送り、空はクリア、不正はエラー", () => {
  const d = {
    ...newDraft(1),
    key: "作業時間",
    value_type: "duration" as const,
  };
  assert.deepEqual(propertyBody({ ...d, value: "01:02:03", unit: "分" }), {
    key: "作業時間",
    value: "3723",
    value_type: "duration",
    unit: null,
  });
  assert.deepEqual(propertyBody({ ...d, value: "" }), {
    key: "作業時間",
    value: "",
    value_type: "duration",
    unit: null,
  });
  assert.deepEqual(propertyBody({ ...d, value: "00:75:00" }), {
    error: "時間は HH:MM:SS で入力してください",
  });
});

test("時間の行は秒数を HH:MM:SS で表示する", () => {
  const draft = toDraft({
    id: 1,
    task_id: 1,
    key: "作業時間",
    value: "3723",
    value_type: "duration",
    unit: null,
  });
  assert.equal(draft.value, "01:02:03");
});
