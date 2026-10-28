import { proxyToBackend } from "@/lib/proxy";

// 実行時に BACKEND_URL を読むため、静的化・キャッシュしない。
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

const handler = async (req: Request, { params }: Ctx) =>
  proxyToBackend(req, (await params).path);

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
