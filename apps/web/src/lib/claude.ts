import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, normalizeModelOutput } from "@travel/core";
import { env } from "./env";
import { HttpError } from "./http";

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ apiKey: env.anthropicKey(), maxRetries: 2, timeout: 110_000 }));

interface ToolDef {
  name: string;
  description: string;
  input_schema: unknown;
}

/** Pull the first complete JSON object out of free text (fallback when no tool call is made). */
export function extractJson(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)];
  for (const c of candidates) {
    if (!c) continue;
    try {
      return JSON.parse(c);
    } catch {
      /* try the next one */
    }
  }
  return null;
}

/** With a deadline, a call isn't started when less than this is left: it couldn't finish. */
const MIN_CALL_MS = 5_000;

/**
 * Ask Claude for structured output. The model is offered one tool and told to call it.
 * Some models don't accept a forced tool_choice, so we use "auto" and fall back to
 * parsing JSON from the text if the model answers without calling the tool.
 *
 * `deadline` (ms since the epoch): the call must be over by then, retry included. It gets a
 * shorter timeout when less time is left, no retry when two attempts wouldn't fit, and isn't
 * made at all (HttpError "deadline") when there's under five seconds to go.
 */
export async function callTool(
  prompt: string,
  tool: ToolDef,
  maxTokens = 16000,
  opts: { fast?: boolean; deadline?: number } = {},
): Promise<{ input: unknown; model: string }> {
  const main = env.claudeModel();
  const model = opts.fast ? env.fastModel() : main;
  // Stay inside the routes' time limits (60–120 s): one retry, and a per-call timeout, so people
  // get our error message rather than a platform timeout. Callers retry malformed answers themselves.
  // The tool call is forced: with "auto" the model wrote ~3x more text (thinking out loud before
  // calling the tool), which was most of each day's 10–14 s. "auto" stays as a fallback.
  let forced = true;
  const create = (m: string) => {
    const normal = m === main ? 90_000 : 45_000;
    const left = opts.deadline ? opts.deadline - Date.now() : Number.POSITIVE_INFINITY;
    if (left < MIN_CALL_MS) throw new HttpError(504, "There wasn't enough time left to finish that. Try again.", "deadline");
    const timeout = Math.min(normal, left);
    // The SDK retries timeouts too: only allow it when a second full attempt still fits.
    const maxRetries = left < 2 * timeout + 2_000 ? 0 : 1;
    return anthropic().messages.create(
      {
        model: m,
        max_tokens: maxTokens,
        system: `${SYSTEM_PROMPT}\nAlways respond by calling the ${tool.name} tool exactly once with the complete result.`,
        tools: [tool as unknown as Anthropic.Tool],
        tool_choice: forced ? { type: "tool", name: tool.name } : { type: "auto" },
        messages: [{ role: "user", content: prompt }],
      },
      { timeout, maxRetries },
    );
  };
  const t0 = Date.now();
  let res: Anthropic.Message;
  try {
    try {
      res = await create(model);
    } catch (e) {
      if (e instanceof Anthropic.BadRequestError && /tool_choice/i.test(e.message)) {
        // This model won't take a forced tool call: let it choose.
        forced = false;
        res = await create(model);
      } else if (model !== main && (e instanceof Anthropic.NotFoundError || e instanceof Anthropic.BadRequestError)) {
        // If the fast model isn't available on this account, quietly use the main one.
        console.error(`Fast model ${model} unavailable (${(e as Error).message}); using ${main}`);
        res = await create(main);
      } else throw e;
    }
    const textChars = res.content.reduce((n, b) => n + (b.type === "text" ? b.text.length : 0), 0);
    console.log(`[claude] ${tool.name} ${res.model} ${Date.now() - t0}ms out=${res.usage.output_tokens}${textChars ? ` text=${textChars}` : ""}${forced ? "" : " auto"}`);
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(503, "The planner is busy right now. Try again in a minute.", "busy");
    if (e instanceof Anthropic.AuthenticationError) {
      console.error("Anthropic auth error", e.message);
      throw new HttpError(502, "The planner isn't set up correctly (API key rejected).", "upstream_auth");
    }
    if (e instanceof Anthropic.APIError) {
      console.error("Anthropic API error", e.status, e.message);
      throw new HttpError(502, "The planner couldn't be reached. Try again.", "upstream_error");
    }
    throw e;
  }
  const block = res.content.find((b) => b.type === "tool_use" && b.name === tool.name);
  if (block && block.type === "tool_use") return { input: normalizeModelOutput(block.input), model: res.model };

  if (res.stop_reason === "max_tokens") throw new HttpError(502, "The plan was too long. Try fewer days.", "too_long");
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  const parsed = extractJson(text);
  if (parsed) return { input: normalizeModelOutput(parsed), model: res.model };
  console.error("Model answered without a tool call", res.stop_reason, text.slice(0, 500));
  throw new HttpError(502, "The planner returned an unexpected answer. Try again.", "bad_output");
}
