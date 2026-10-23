const API_BASE = "/api";

export class ApiError extends Error {
  readonly status: number;
  readonly body?: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions extends Omit<RequestInit, "body"> {
  query?: Query;
  body?: unknown;
}

export function buildUrl(path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== null && v !== undefined) params.set(k, String(v));
  }
  const qs = params.toString();
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}${qs ? `?${qs}` : ""}`;
}

export async function apiFetch<T>(
  path: string,
  { query, body, headers, ...init }: RequestOptions = {},
): Promise<T> {
  const res = await fetch(buildUrl(path, query), {
    ...init,
    headers: {
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data: unknown;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const detail =
      typeof data === "object" && data !== null && "detail" in data
        ? String((data as { detail: unknown }).detail)
        : res.statusText;
    throw new ApiError(res.status, detail || `HTTP ${res.status}`, data);
  }
  return data as T;
}

/** 設定の取得に失敗したとき・取得前に使う既定値(backend の既定と揃える)。 */
export const DEFAULT_DAY_END_HOUR = 22;

/** 「1日の予定を終えた」画面に切り替わる時刻(時)。失敗時は既定値を返す。 */
export async function fetchDayEndHour(): Promise<number> {
  try {
    const cfg = await apiFetch<{ day_end_hour: number }>("/config");
    return Number.isInteger(cfg.day_end_hour)
      ? cfg.day_end_hour
      : DEFAULT_DAY_END_HOUR;
  } catch {
    return DEFAULT_DAY_END_HOUR;
  }
}
