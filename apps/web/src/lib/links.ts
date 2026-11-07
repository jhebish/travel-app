import { MAX_DAYS } from "@travel/core";

/**
 * A link that opens the planner filled in: where, one place or several stops, and how many days.
 * Every "plan a trip like this" link goes through here, so none of them drops the mode or
 * asks for more days than the planner allows.
 */
export function planHref(destination: string, opts: { multi?: boolean; days?: number } = {}): string {
  const q = new URLSearchParams({ dest: destination });
  if (opts.multi !== undefined) q.set("mode", opts.multi ? "multi" : "single");
  if (opts.days) q.set("days", String(Math.min(MAX_DAYS[opts.multi ? "multi" : "single"], Math.max(1, Math.round(opts.days)))));
  return `/plan?${q.toString()}`;
}
