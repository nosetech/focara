import assert from "node:assert/strict";
import { test } from "node:test";
import { arrangeFixed, sortByOrder, type Orderable } from "./order.ts";

const t = (
  id: number,
  run_order: number | null,
  fixed_at: string | null = null,
): Orderable => ({ id, run_order, fixed_at });

test("sortByOrder: 予定時刻ありは、その位置の中で開始時刻順。なしの位置は動かない", () => {
  const sorted = sortByOrder([
    t(1, 0),
    t(2, 1, "2026-10-20T07:00:00Z"),
    t(3, 2),
    t(4, 3, "2026-10-20T04:00:00Z"),
    t(5, null),
  ]);
  assert.deepEqual(
    sorted.map((x) => x.id),
    [1, 4, 3, 2, 5],
  );
});

test("sortByOrder: なしを予定時刻ありの前・後ろへ置ける", () => {
  const f = (id: number, ro: number) => t(id, ro, "2026-10-20T04:00:00Z");
  assert.deepEqual(
    sortByOrder([t(1, 0), f(2, 1), t(3, 2)]).map((x) => x.id),
    [1, 2, 3],
  );
  assert.deepEqual(
    sortByOrder([f(2, 0), t(1, 1), t(3, 2)]).map((x) => x.id),
    [2, 1, 3],
  );
});

test("sortByOrder: 開始時刻が同じなら id 順、元の配列は変えない", () => {
  const src = [
    t(9, 0, "2026-10-20T04:00:00Z"),
    t(2, 5, "2026-10-20T04:00:00Z"),
  ];
  assert.deepEqual(
    sortByOrder(src).map((x) => x.id),
    [2, 9],
  );
  assert.equal(src[0].id, 9);
});

test("arrangeFixed: 例 [A, B(10:00), C, D(9:00)] → [A, D, C, B]", () => {
  const out = arrangeFixed([
    t(1, 0),
    t(2, 1, "2026-10-20T10:00:00Z"),
    t(3, 2),
    t(4, 3, "2026-10-20T09:00:00Z"),
  ]);
  assert.deepEqual(
    out.map((x) => x.id),
    [1, 4, 3, 2],
  );
});
