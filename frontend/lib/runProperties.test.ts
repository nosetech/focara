import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blocksCompletion,
  needsSave,
  normalizeValue,
  overallStatus,
  toRows,
  validateValue,
} from "./runProperties.ts";

const props = [
  {
    id: 1,
    task_id: 9,
    key: "体重",
    value: "62.5",
    value_type: "number" as const,
    unit: "kg",
  },
  {
    id: 2,
    task_id: 9,
    key: "場所",
    value: null,
    value_type: "string" as const,
    unit: null,
  },
];

test("取得したプロパティを入力欄の状態に変換する", () => {
  const rows = toRows(props);
  assert.equal(rows[0].value, "62.5");
  assert.equal(rows[0].unit, "kg");
  assert.equal(rows[1].value, "");
  assert.equal(rows[1].unit, "");
  assert.equal(rows[0].error, null);
});

test("全角の数字は半角にそろえる", () => {
  assert.equal(normalizeValue("number", " ６２．５ "), "62.5");
  assert.equal(normalizeValue("string", " ６２ "), " ６２ ");
});

test("数値の検証: 空は可、非数はエラー、入力途中の小数点は可", () => {
  assert.equal(validateValue("number", "体重", ""), null);
  assert.equal(validateValue("number", "体重", "62."), null);
  assert.equal(validateValue("number", "体重", "６２．４"), null);
  assert.equal(
    validateValue("number", "体重", "62,4kg"),
    "数値を入力してください",
  );
});

test("日付の検証: 空は可、形式違いはエラー", () => {
  assert.equal(validateValue("date", "日", ""), null);
  assert.equal(validateValue("date", "日", "2026-10-15"), null);
  assert.equal(validateValue("date", "日", "10/15"), "日付を選んでください");
});

test("保存が必要なのは値が変わったときだけ。空の数値は保存しない", () => {
  const [num, str] = toRows(props);
  assert.equal(needsSave(num), false);
  assert.equal(needsSave({ ...num, value: "63" }), true);
  assert.equal(needsSave({ ...num, value: "" }), false);
  assert.equal(needsSave({ ...str, value: "会議室" }), true);
  assert.equal(needsSave({ ...str, value: "" }), false);
});

test("エラーがある間は完了を止める", () => {
  const rows = toRows(props);
  assert.equal(blocksCompletion(rows), false);
  assert.equal(blocksCompletion([{ ...rows[0], error: "x" }, rows[1]]), true);
});

test("全体の状態: エラー > 保存中 > 入力中 > 保存済み > 通常", () => {
  const rows = toRows(props);
  assert.equal(overallStatus(rows, null), "idle");
  assert.equal(overallStatus(rows, 1), "editing");
  assert.equal(
    overallStatus([{ ...rows[0], justSaved: true }, rows[1]], null),
    "saved",
  );
  assert.equal(
    overallStatus([{ ...rows[0], saving: true }, rows[1]], 1),
    "saving",
  );
  assert.equal(
    overallStatus([{ ...rows[0], saving: true, error: "x" }, rows[1]], 1),
    "error",
  );
});
