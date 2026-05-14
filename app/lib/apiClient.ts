"use client";

/**
 * Same-origin API client for Joseph's local-only CofounderAgent UI.
 *
 * There is intentionally no browser auth token or session ceremony in local
 * mode. The only guard kept here is that callers must use same-origin `/api/`
 * paths, so future code cannot accidentally target an external URL.
 */

export interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | undefined>;
  signal?: AbortSignal;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, public requestId?: string) {
    super(`${code} (${status})`);
  }
}

function apiUrl(path: string): URL {
  if (typeof window === "undefined") {
    throw new ApiError(500, "client_unavailable");
  }
  if (!path.startsWith("/api/")) {
    throw new ApiError(400, "invalid_api_path");
  }
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) {
    throw new ApiError(400, "invalid_api_path");
  }
  return url;
}

async function parsePayload(res: Response): Promise<Record<string, unknown>> {
  return res
    .json()
    .catch(() => ({ error: "non_json", requestId: undefined as string | undefined }));
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const url = apiUrl(path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  }

  const method = opts.method ?? "GET";
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url.toString(), {
    method,
    headers,
    credentials: "same-origin",
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
    cache: "no-store",
  });

  const payload = await parsePayload(res);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      typeof payload.error === "string" ? payload.error : "request_failed",
      typeof payload.requestId === "string" ? payload.requestId : undefined
    );
  }
  return payload as T;
}
