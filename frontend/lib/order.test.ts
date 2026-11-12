import assert from "node:assert/strict";
import { test } from "node:test";
import { compareOrder, sortByOrder, type Orderable } from "./order.ts";

const t = (
  id: number,
  run_order: number | null,
  fixed_at: string | null = null,
): Orderable => ({ id, run_order, fixed_at });

test("sortByOrder: 予定時刻ありが先頭で開始時刻順、なしは run_order 順", () => {
  const sorted = sortByOrder([
    t(1, 0),
    t(2, 1, "2026-10-20T07:00:00Z"),
    t(3, 2, "2026-10-20T04:00:00Z"),
    t(4, null),
    t(5, 0),
  ]);
  assert.deepEqual(
    sorted.map((x) => x.id),
    [3, 2, 1, 5, 4],
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
  assert.ok(compareOrder(t(1, 0, "2026-10-20T04:00:00Z"), t(2, 0)) < 0);
});
