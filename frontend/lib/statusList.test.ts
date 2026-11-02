import assert from "node:assert/strict";
import { test } from "node:test";
import { waitBody } from "./statusList.ts";

test("待ち条件は条件か日時のどちらかが必要", () => {
  assert.ok("error" in waitBody("  ", ""));
  assert.deepEqual(waitBody(" 返信 ", ""), {
    wait_condition: "返信",
    wait_until: null,
  });
});
