import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DETAIL_DEFAULT_WIDTH,
  DETAIL_MIN_WIDTH,
  clampDetailWidth,
  detailMaxWidth,
  parseDetailWidth,
  parseSidebarCollapsed,
  serializeSidebar,
  widthFromDrag,
} from "./panelSize.ts";

test("上限はウィンドウ幅の60%で、下限を下回らない", () => {
  assert.equal(detailMaxWidth(1500), 900);
  assert.equal(detailMaxWidth(400), DETAIL_MIN_WIDTH);
});

test("幅は下限〜上限に収まり、数値でなければ既定値になる", () => {
  assert.equal(clampDetailWidth(100, 1500), DETAIL_MIN_WIDTH);
  assert.equal(clampDetailWidth(2000, 1500), 900);
  assert.equal(clampDetailWidth(480.4, 1500), 480);
  assert.equal(clampDetailWidth(Number.NaN, 1500), DETAIL_DEFAULT_WIDTH);
});

test("ドラッグは左へ動かすと広がり、範囲を超えない", () => {
  assert.equal(widthFromDrag(400, -80, 1500), 480);
  assert.equal(widthFromDrag(400, 80, 1500), DETAIL_MIN_WIDTH);
  assert.equal(widthFromDrag(400, -2000, 1500), 900);
});

test("保存値の幅は、未保存・壊れた値・範囲外を null にする", () => {
  assert.equal(parseDetailWidth(null, 1500), null);
  assert.equal(parseDetailWidth("abc", 1500), null);
  assert.equal(parseDetailWidth('"500"', 1500), null);
  assert.equal(parseDetailWidth("100", 1500), null);
  assert.equal(parseDetailWidth("1000", 1500), null);
  assert.equal(parseDetailWidth("null", 1500), null);
  assert.equal(parseDetailWidth("520", 1500), 520);
});

test("ウィンドウが縮んで上限を超えた保存値は、補正前提で null になる", () => {
  assert.equal(parseDetailWidth("800", 1000), null);
});

test("折りたたみ状態は保存して復元でき、壊れた値は展開に戻る", () => {
  assert.equal(parseSidebarCollapsed(serializeSidebar(true)), true);
  assert.equal(parseSidebarCollapsed(serializeSidebar(false)), false);
  assert.equal(parseSidebarCollapsed(null), false);
  assert.equal(parseSidebarCollapsed("{broken"), false);
  assert.equal(parseSidebarCollapsed('{"collapsed":"yes"}'), false);
  assert.equal(parseSidebarCollapsed("true"), false);
});
