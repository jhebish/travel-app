/** What hotels cost in a place: asked once per destination, checked, rounded and cached. */
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

const { readStayScale, stayScale } = await import("./stayScale");

beforeEach(() => {
  h.callTool.mockReset();
  h.store.clear();
});

describe("a destination's hotel prices", () => {
  it("asks once with the fast model, rounds the answer and keeps it for everyone", async () => {
    h.callTool.mockResolvedValue({ input: { simple_up_to: 38, comfortable_up_to: "112", upscale_up_to: 247 }, model: "fast" });
    expect(await stayScale("Cairo")).toEqual({ cuts: [40, 110, 250] });
    expect(h.callTool).toHaveBeenCalledTimes(1);
    expect(h.callTool.mock.calls[0]![0]).toContain("Hotel prices in Cairo");
    expect(h.callTool.mock.calls[0]![3]).toMatchObject({ fast: true });
    expect(await stayScale("cairo ")).toEqual({ cuts: [40, 110, 250] });
    expect(await readStayScale("CAIRO")).toEqual({ cuts: [40, 110, 250] });
    expect(h.callTool).toHaveBeenCalledTimes(1);
  });

  it("gives nothing rather than a wrong scale", async () => {
    h.callTool.mockResolvedValueOnce({ input: { simple_up_to: 200, comfortable_up_to: 100, upscale_up_to: 400 }, model: "fast" });
    expect(await stayScale("Kyoto")).toBeNull();
    h.callTool.mockResolvedValueOnce({ input: { simple_up_to: "cheap" }, model: "fast" });
    expect(await stayScale("Kyoto")).toBeNull();
    h.callTool.mockRejectedValueOnce(new Error("overloaded"));
    expect(await stayScale("Kyoto")).toBeNull();
    expect(h.store.size).toBe(0);
  });
});
