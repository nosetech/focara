import assert from "node:assert/strict";
import { test } from "node:test";
import { createCoalescer } from "./detailSync.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("連続した通知を1回にまとめる", async () => {
  let n = 0;
  const c = createCoalescer(() => n++, 40);
  c.notify();
  await sleep(20);
  c.notify();
  await sleep(20);
  assert.equal(n, 0);
  await sleep(60);
  assert.equal(n, 1);
});

test("flushNow は即実行し、保留中の通知を取り消す", async () => {
  let n = 0;
  const c = createCoalescer(() => n++, 30);
  c.notify();
  c.flushNow();
  assert.equal(n, 1);
  await sleep(60);
  assert.equal(n, 1);
});

test("cancel すると実行されない", async () => {
  let n = 0;
  const c = createCoalescer(() => n++, 20);
  c.notify();
  c.cancel();
  await sleep(50);
  assert.equal(n, 0);
});
