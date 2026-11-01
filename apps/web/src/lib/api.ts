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
