import { NextResponse } from "next/server";
import { ZodError, type ZodTypeAny, type output } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

export async function parseBody<S extends ZodTypeAny>(req: Request, schema: S): Promise<output<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON.");
  }
  const out = schema.safeParse(raw);
  if (!out.success) throw new HttpError(400, "Some fields are invalid.", "invalid_request");
  return out.data;
}

/** Wrap a route handler: maps HttpError and ZodError to clean JSON errors, hides internals. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
      if (e instanceof ZodError) return json({ error: "Some fields are invalid.", code: "invalid_request" }, 400);
      console.error(e);
      return json({ error: "Something went wrong. Try again.", code: "server_error" }, 500);
    }
  };
}
