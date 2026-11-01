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

/** Ask Claude for structured output by forcing a single tool call; returns the tool input. */
export async function callTool(prompt: string, tool: ToolDef, maxTokens = 8000): Promise<{ input: unknown; model: string }> {
  const model = env.claudeModel();
  let res: Anthropic.Message;
  try {
    res = await anthropic().messages.create({
      model,
      max_tokens: maxTokens,
      system: SYSTEM_PROMPT,
      tools: [tool as unknown as Anthropic.Tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content: prompt }],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(503, "The planner is busy right now. Try again in a minute.", "busy");
    if (e instanceof Anthropic.APIError) {
      console.error("Anthropic API error", e.status, e.message);
      throw new HttpError(502, "The planner couldn't be reached. Try again.", "upstream_error");
    }
    throw e;
  }
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new HttpError(502, "The planner returned an unexpected answer. Try again.", "bad_output");
  if (res.stop_reason === "max_tokens") throw new HttpError(502, "The plan was too long. Try fewer days.", "too_long");
  return { input: block.input, model: res.model };
}
