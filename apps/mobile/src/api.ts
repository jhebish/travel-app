import { supabase } from "./supabase";

const BASE = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

/** Call the web app's API with the signed-in user's access token. */
export async function api<T>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0, "network");
  }
  let body: { error?: string; code?: string } & Record<string, unknown> = {};
  try {
    body = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) throw new ApiError(body.error || "Something went wrong. Try again.", res.status, body.code);
  return body as T;
}
