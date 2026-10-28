import assert from "node:assert/strict";
import { test } from "node:test";
import { proxyToBackend } from "./proxy.ts";

type Call = { url: string; init: RequestInit };

function stubFetch(res: () => Response | Error) {
  const calls: Call[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = res();
    if (r instanceof Error) throw r;
    return r;
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = orig) };
}

const B = "http://127.0.0.1:9999";

test("GET: パス・クエリを中継し、ステータスと Content-Type を素通しする", async () => {
  const s = stubFetch(
    () =>
      new Response('{"a":1}', {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
  );
  try {
    const res = await proxyToBackend(
      new Request("http://x/api/tasks/1?status=inbox&q=a%20b"),
      ["tasks", "1"],
      B,
    );
    assert.equal(s.calls[0].url, `${B}/api/tasks/1?status=inbox&q=a%20b`);
    assert.equal(s.calls[0].init.method, "GET");
    assert.equal(s.calls[0].init.body, undefined);
    assert.equal(res.status, 201);
    assert.equal(res.headers.get("content-type"), "application/json");
    assert.equal(await res.text(), '{"a":1}');
  } finally {
    s.restore();
  }
});

for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
  test(`${method}: ボディと Content-Type を中継する`, async () => {
    const s = stubFetch(() => new Response(null, { status: 204 }));
    try {
      const req = new Request("http://x/api/tasks", {
        method,
        headers: { "content-type": "application/json" },
        body: '{"title":"t"}',
      });
      const res = await proxyToBackend(req, ["tasks"], B);
      const init = s.calls[0].init;
      assert.equal(init.method, method);
      assert.equal(
        new TextDecoder().decode(init.body as ArrayBuffer),
        '{"title":"t"}',
      );
      assert.equal(
        (init.headers as Headers).get("content-type"),
        "application/json",
      );
      assert.equal(res.status, 204);
    } finally {
      s.restore();
    }
  });
}

test("backend 停止時は 502", async () => {
  const s = stubFetch(() => new TypeError("fetch failed"));
  try {
    const res = await proxyToBackend(
      new Request("http://x/api/health"),
      ["health"],
      B,
    );
    assert.equal(res.status, 502);
    assert.match((await res.json()).detail, /backend/);
  } finally {
    s.restore();
  }
});

test("BACKEND_URL を実行時に読む", async () => {
  const s = stubFetch(() => new Response("ok"));
  const prev = process.env.BACKEND_URL;
  process.env.BACKEND_URL = "http://127.0.0.1:7777";
  try {
    await proxyToBackend(new Request("http://x/api/health"), ["health"]);
    assert.equal(s.calls[0].url, "http://127.0.0.1:7777/api/health");
  } finally {
    s.restore();
    if (prev === undefined) delete process.env.BACKEND_URL;
    else process.env.BACKEND_URL = prev;
  }
});
