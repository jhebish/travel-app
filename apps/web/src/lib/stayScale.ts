import { STAY_SCALE_TOOL, StayScaleSchema, buildStayScalePrompt, type StayScale } from "@travel/core";
import { callTool } from "./claude";
import { asPlaceName, readFact, words, writeFact } from "./destinationFacts";

/**
 * What hotels cost in a destination (packages/core/src/stayPrice.ts): where $, $$ and $$$ top out,
 * in US dollars a night. Asked once per destination with the fast model and cached for everyone.
 */

const cacheKey = (destination: string) => `stayscale1:${words(destination)}`;

/** The cached scale, or null. Never asks the model. */
export async function readStayScale(destination: string): Promise<StayScale | null> {
  if (words(destination).length < 2) return null;
  return readFact(cacheKey(destination), StayScaleSchema);
}

/** The scale, from the cache or asked now. Never throws: null when it can't be had. */
export async function stayScale(destination: string, deadline = Date.now() + 25_000): Promise<StayScale | null> {
  try {
    const cached = await readStayScale(destination).catch(() => null);
    if (cached) return cached;
    const place = asPlaceName(destination);
    if (place.length < 2) return null;
    const { input } = await callTool(buildStayScalePrompt(place), STAY_SCALE_TOOL, 300, { fast: true, deadline });
    const a = (input ?? {}) as { simple_up_to?: unknown; comfortable_up_to?: unknown; upscale_up_to?: unknown };
    const ok = StayScaleSchema.safeParse({ cuts: [a.simple_up_to, a.comfortable_up_to, a.upscale_up_to].map(Number) });
    if (!ok.success) {
      console.error("[stayscale] unusable answer for", place, JSON.stringify(input).slice(0, 200));
      return null;
    }
    await writeFact(cacheKey(destination), ok.data);
    return ok.data;
  } catch (e) {
    console.error("[stayscale]", destination, (e as Error).message);
    return null;
  }
}
