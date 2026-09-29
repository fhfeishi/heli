/* ==================================================================
   统一请求出口（方案 §16.1 第 2 条）
   ------------------------------------------------------------------
   · 所有读写都经过 apiRequest，失败一律抛 ApiError（见 errors.ts）
   · 只认 /api 前缀；Vite 代理到 8765，Tauri 下改直连
   · 后端暂不下发错误码，这里按状态与错误文本推断（codeFromPayload）
   ================================================================== */

import { ApiError, codeFromPayload, codeFromStatus, normalizeError } from "./errors";

export const API_BASE = "/api";

export type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue>;

function buildQuery(query?: Query): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

function errorText(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["error", "message", "detail"]) {
      const value = record[key];
      if (typeof value === "string" && value) return value;
    }
  }
  return "";
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * 唯一的请求出口。成功返回解析后的 JSON（无内容时返回 {}），
 * 失败抛 ApiError —— 调用方拿到的「成功」就是后端真的成功了。
 */
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const hasBody = options.body !== undefined;
  const method = options.method ?? (hasBody ? "POST" : "GET");
  const url = `${API_BASE}${path}${buildQuery(options.query)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: hasBody ? { "Content-Type": "application/json" } : undefined,
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (cause) {
    throw normalizeError(cause);
  }

  const text = await response.text().catch(() => "");
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const detail = errorText(payload) || text || `HTTP ${response.status}`;
    const code = codeFromPayload(detail) ?? codeFromStatus(response.status);
    throw new ApiError(code, detail, response.status, detail);
  }

  return (payload ?? {}) as T;
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal): Promise<T> =>
    apiRequest<T>(path, { method: "GET", query, signal }),
  post: <T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> =>
    apiRequest<T>(path, { method: "POST", body, signal }),
  patch: <T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> =>
    apiRequest<T>(path, { method: "PATCH", body, signal }),
  del: <T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> =>
    apiRequest<T>(path, { method: "DELETE", body, signal }),
};
