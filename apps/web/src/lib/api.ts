"use client";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

/**
 * POST a request and read newline-delimited JSON events as they arrive.
 * Resolves when the stream ends. Throws ApiError for HTTP errors before streaming starts.
 */
export async function streamEvents<E>(path: string, body: unknown, onEvent: (e: E) => void): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    let msg = "Something went wrong. Try again.";
    let code: string | undefined;
    try {
      const j = await res.json();
      msg = j.error || msg;
      code = j.code;
    } catch {
      /* not JSON */
    }
    throw new ApiError(msg, res.status, code);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) {
        try {
          onEvent(JSON.parse(line) as E);
        } catch {
          /* skip a malformed line */
        }
      }
    }
  }
  const last = buf.trim();
  if (last) {
    try {
      onEvent(JSON.parse(last) as E);
    } catch {
      /* ignore */
    }
  }
}

/** Fetch a JSON API route. Throws ApiError with the server's plain-language message. */
export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  let body: { error?: string; code?: string } & Record<string, unknown> = {};
  try {
    body = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) throw new ApiError(body.error || "Something went wrong. Try again.", res.status, body.code);
  return body as T;
}
