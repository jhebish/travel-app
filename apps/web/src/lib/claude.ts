import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "@travel/core";
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

/**
 * Ask Claude for structured output. The model is offered one tool and told to call it.
 * Some models don't accept a forced tool_choice, so we use "auto" and fall back to
 * parsing JSON from the text if the model answers without calling the tool.
 */
export async function callTool(prompt: string, tool: ToolDef, maxTokens = 16000): Promise<{ input: unknown; model: string }> {
  const model = env.claudeModel();
  let res: Anthropic.Message;
  try {
    res = await anthropic().messages.create({
      model,
      max_tokens: maxTokens,
      system: `${SYSTEM_PROMPT}\nAlways respond by calling the ${tool.name} tool exactly once with the complete result.`,
      tools: [tool as unknown as Anthropic.Tool],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: prompt }],
    });
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
  if (block && block.type === "tool_use") return { input: block.input, model: res.model };

  if (res.stop_reason === "max_tokens") throw new HttpError(502, "The plan was too long. Try fewer days.", "too_long");
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  const parsed = extractJson(text);
  if (parsed) return { input: parsed, model: res.model };
  console.error("Model answered without a tool call", res.stop_reason, text.slice(0, 500));
  throw new HttpError(502, "The planner returned an unexpected answer. Try again.", "bad_output");
}
