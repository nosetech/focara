// /api/* を backend へ中継する。中継先は実行時に BACKEND_URL から決める(ビルド時に固定しない)。

const DEFAULT_BACKEND_URL = "http://127.0.0.1:8800";

export async function proxyToBackend(
  req: Request,
  path: string[],
  backendUrl: string = process.env.BACKEND_URL ?? DEFAULT_BACKEND_URL,
): Promise<Response> {
  const search = new URL(req.url).search;
  const target = `${backendUrl.replace(/\/+$/, "")}/api/${path.map(encodeURIComponent).join("/")}${search}`;

  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const accept = req.headers.get("accept");
  if (accept) headers.set("accept", accept);

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: "manual",
      cache: "no-store",
    });
  } catch {
    return Response.json(
      { detail: "backend に接続できません" },
      { status: 502 },
    );
  }

  const out = new Headers();
  const upstreamType = upstream.headers.get("content-type");
  if (upstreamType) out.set("content-type", upstreamType);
  const noBody =
    upstream.status === 204 ||
    upstream.status === 205 ||
    upstream.status === 304;
  return new Response(noBody ? null : await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: out,
  });
}
