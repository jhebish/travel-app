/** The recommended length: asked once per destination, then served from the cache. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  callTool: vi.fn(),
  store: new Map<string, { data: unknown; fetched_at: string }>(),
}));

vi.mock("./claude", () => ({ callTool: h.callTool }));
vi.mock("./supabase/server", () => {
  const table = () => {
    let key: string | null = null;
    const q = {
      select: () => q,
      eq: (_c: string, v: string) => ((key = v), q),
      maybeSingle: async () => ({ data: key && h.store.has(key) ? { ...h.store.get(key)! } : null, error: null }),
      upsert: async (row: { key: string; data: unknown; fetched_at: string }) => (h.store.set(row.key, { data: row.data, fetched_at: row.fetched_at }), { error: null }),
    };
    return q;
  };
  return { supabaseAdmin: () => ({ from: () => table() }) };
});

const { idealDays, readIdealDays } = await import("./tripLength");

beforeEach(() => {
  h.callTool.mockReset();
  h.store.clear();
});

describe("recommended trip length", () => {
  it("asks once with the fast model, then answers from the cache", async () => {
    h.callTool.mockResolvedValue({ input: { min_days: 3, max_days: 4, note: "Two days for the old town and Belém, a third for Sintra." }, model: "fast" });
    const first = await idealDays("Lisbon", "single");
    expect(first).toEqual({ min: 3, max: 4, note: "Two days for the old town and Belém, a third for Sintra." });
    expect(h.callTool).toHaveBeenCalledTimes(1);
    expect(h.callTool.mock.calls[0]![0]).toContain("a first visit to Lisbon");
    expect(h.callTool.mock.calls[0]![3]).toMatchObject({ fast: true });
    // Typed differently, same place: no second question.
    expect(await idealDays("lisbon ", "single")).toEqual(first);
    expect(await readIdealDays("LISBON", "single")).toEqual(first);
    expect(h.callTool).toHaveBeenCalledTimes(1);
    // A multi-city trip is a different question.
    expect(await readIdealDays("Lisbon", "multi")).toBeNull();
  });

  it("asks again once the answer is half a year old", async () => {
    h.store.set("triplen1:single:porto", { data: { min: 2, max: 3, note: "" }, fetched_at: new Date(Date.now() - 200 * 86400_000).toISOString() });
    expect(await readIdealDays("Porto", "single")).toBeNull();
  });

  it("never fails a build: a bad answer or an error is just no recommendation", async () => {
    h.callTool.mockResolvedValueOnce({ input: { min_days: "lots" }, model: "fast" });
    expect(await idealDays("Kyoto", "single")).toBeNull();
    h.callTool.mockRejectedValueOnce(new Error("overloaded"));
    expect(await idealDays("Kyoto", "single")).toBeNull();
    expect(h.store.size).toBe(0);
  });
});
