import assert from "node:assert/strict";
import { test } from "node:test";
import { buildUrl } from "./api.ts";

test("buildUrl joins path and drops empty query values", () => {
  assert.equal(buildUrl("/tasks"), "/api/tasks");
  assert.equal(
    buildUrl("tasks", { a: 1, b: undefined, c: null }),
    "/api/tasks?a=1",
  );
});
