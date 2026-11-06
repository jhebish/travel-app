import { typeformDefinition, type TypeformAnswer } from "@travel/core";
import { env } from "./env";
import { HttpError } from "./http";

export const typeformEnabled = () => !!env.typeformToken() && !!env.typeformFormId();

async function tf(path: string, init: RequestInit = {}) {
  const token = env.typeformToken();
  if (!token) throw new HttpError(503, "Typeform isn't connected yet (TYPEFORM_TOKEN is missing).", "typeform_off");
  const res = await fetch(`${env.typeformApi()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) {
    console.error("Typeform auth error", res.status, path);
    throw new HttpError(502, "Typeform rejected the access token. Check its scopes.", "typeform_auth");
  }
  return res;
}

export interface TypeformResponse {
  response_id?: string;
  token?: string;
  submitted_at?: string;
  hidden?: Record<string, string>;
  answers?: TypeformAnswer[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch one submitted response. Typeform can take a few seconds to make a fresh submission
 * available through the API, so this polls briefly.
 */
export async function fetchResponse(responseId: string, onWait?: (attempt: number) => void): Promise<TypeformResponse> {
  const formId = env.typeformFormId();
  if (!formId) throw new HttpError(503, "The Typeform intake isn't set up yet.", "typeform_off");
  const q = new URLSearchParams({ included_response_ids: responseId, page_size: "1" });
  const delays = [0, 800, 1200, 1500, 2000, 2500, 3000, 3000];
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) await sleep(delays[i]!);
    onWait?.(i);
    const res = await tf(`/forms/${encodeURIComponent(formId)}/responses?${q}`);
    if (!res.ok) {
      console.error("Typeform responses error", res.status, await res.text().catch(() => ""));
      if (res.status === 404) throw new HttpError(502, "Typeform couldn't find the intake form. Check TYPEFORM_FORM_ID.", "typeform_form");
      continue;
    }
    const body = (await res.json()) as { items?: TypeformResponse[] };
    const item = body.items?.find((r) => r.response_id === responseId || r.token === responseId);
    if (item?.answers?.length) return item;
  }
  throw new HttpError(504, "We couldn't read your answers from Typeform. Try submitting again.", "typeform_timeout");
}

/** Create the Pylos intake form (and a matching theme) in the connected Typeform account. */
export async function createIntakeForm(browseUrl?: string): Promise<{ formId: string; url: string; themed: boolean }> {
  let themeHref: string | undefined;
  try {
    const t = await tf("/themes", {
      method: "POST",
      body: JSON.stringify({
        name: "Pylos",
        font: "Karla",
        colors: { question: "#3B2D36", answer: "#3F7472", button: "#3B2D36", background: "#F6F0E8" },
        has_transparent_button: false,
        rounded_corners: "large",
      }),
    });
    if (t.ok) themeHref = ((await t.json()) as { _links?: { self?: string }; id?: string })._links?.self;
    else console.error("Typeform theme not created", t.status, await t.text().catch(() => ""));
  } catch (e) {
    if (e instanceof HttpError && e.code === "typeform_auth") throw e;
    console.error("Typeform theme not created", e);
  }
  let res = await tf("/forms", { method: "POST", body: JSON.stringify(typeformDefinition({ themeHref, browseUrl })) });
  if (!res.ok && browseUrl) {
    // Redirecting from an ending screen is a paid Typeform feature; without it the app still
    // sends "not sure yet" answers to Browse after submission.
    console.error("Typeform form with ending redirect refused; retrying without it", res.status, (await res.text().catch(() => "")).slice(0, 300));
    res = await tf("/forms", { method: "POST", body: JSON.stringify(typeformDefinition({ themeHref })) });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("Typeform form not created", res.status, text);
    throw new HttpError(502, `Typeform didn't accept the form (${res.status}). The details are in the server logs.`, "typeform_create");
  }
  const f = (await res.json()) as { id: string; _links?: { display?: string } };
  return { formId: f.id, url: f._links?.display ?? `https://form.typeform.com/to/${f.id}`, themed: !!themeHref };
}
