/**
 * The night pulse's research, with Claude's web search replaced by recorded-style responses
 * (server_tool_use / web_search_tool_result blocks, a paused turn, then the tool call), Google
 * Places by a lookup table, and the cache by a map.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  create: vi.fn(),
  verify: vi.fn(),
  store: new Map<string, { data: unknown; fetched_at: string }>(),
}));

vi.mock("./claude", () => ({ anthropicClient: () => ({ messages: { create: h.create } }) }));
vi.mock("./places", () => ({ PlacesError: class PlacesError extends Error {}, placesEnabled: () => true, verifyPlace: h.verify }));
vi.mock("./supabase/server", () => {
  const table = () => {
    let key: string | null = null;
    const q = {
      select: () => q,
      eq: (_c: string, v: string) => ((key = v), q),
      maybeSingle: async () => ({ data: key && h.store.has(key) ? { ...h.store.get(key)! } : null, error: null }),
      upsert: async (row: { key: string; data: unknown; fetched_at: string }) => (h.store.set(row.key, { data: row.data, fetched_at: row.fetched_at }), { error: null }),
      delete: () => ({ eq: async (_c: string, v: string) => (h.store.delete(v), { error: null }) }),
    };
    return q;
  };
  return { supabaseAdmin: () => ({ from: () => table() }) };
});

const { nightPulse, readPulse } = await import("./nightPulse");

const result = (url: string, page_age: string | null) => ({ type: "web_search_result", url, title: url, page_age, encrypted_content: "…" });
const searched = (id: string, query: string, results: unknown[]) => [
  { type: "server_tool_use", id, name: "web_search", input: { query } },
  { type: "web_search_tool_result", tool_use_id: id, content: results },
];
const spot = (name: string, type: "bar" | "club", evidence: { source: string; url: string; date: string | null }[], closed = false) => ({
  name,
  neighborhood: "Kreuzberg",
  type,
  style: type === "club" ? "techno club" : "cocktail bar",
  when: "Fri–Sun",
  door: "",
  why: "",
  closed,
  evidence,
});

/** A paused first turn (two searches), then more searching and the tool call. */
function recordedResearch() {
  h.create
    .mockResolvedValueOnce({
      stop_reason: "pause_turn",
      usage: { server_tool_use: { web_search_requests: 2 } },
      content: [
        ...searched("s1", "best clubs Berlin 2026", [result("https://ra.co/clubs/5031", "2 months ago"), result("https://www.timeout.com/berlin/clubs/best-clubs-in-berlin", "October 1, 2026")]),
        ...searched("s2", "beste bars berlin 2026", [result("https://www.tip-berlin.de/bars/die-besten-bars/", "September 12, 2026")]),
      ],
    })
    .mockResolvedValueOnce({
      stop_reason: "tool_use",
      usage: { server_tool_use: { web_search_requests: 1 } },
      content: [
        ...searched("s3", "berlin where to go out reddit", [result("https://www.reddit.com/r/berlin/comments/abc/where_to_go_out/", "3 weeks ago")]),
        { type: "text", text: "Here is what I found." },
        {
          type: "tool_use",
          id: "t1",
          name: "submit_night_spots",
          input: {
            spots: [
              spot("Berghain", "club", [
                { source: "RA", url: "https://ra.co/clubs/5031", date: null },
                { source: "Time Out Berlin", url: "https://www.timeout.com/berlin/clubs/best-clubs-in-berlin/", date: "2026-10-01" },
                { source: "r/berlin", url: "https://www.reddit.com/r/berlin/comments/abc/where_to_go_out", date: null },
              ]),
              spot("Ghost Bar", "bar", [{ source: "A blog", url: "https://made-up.example/ghost-bar", date: "2026-10-01" }]),
              spot("Watergate", "club", [{ source: "RA", url: "https://ra.co/clubs/5031", date: null }], true),
              spot("Bar Tausend", "bar", [{ source: "tip Berlin", url: "https://www.tip-berlin.de/bars/die-besten-bars/", date: null }]),
              spot("Velvet Bar", "bar", [{ source: "tip Berlin", url: "https://www.tip-berlin.de/bars/die-besten-bars", date: "2026-09-12" }]),
            ],
          },
        },
      ],
    });
}

const onMaps = new Map([
  ["Berghain", { placeId: "p_berghain", lat: 52.511, lng: 13.443, status: "OPERATIONAL" }],
  ["Bar Tausend", { placeId: "p_tausend", lat: 52.52, lng: 13.389, status: "OPERATIONAL" }],
  ["Velvet Bar", { placeId: "p_velvet", lat: 52.488, lng: 13.43, status: "OPERATIONAL" }],
]);

beforeEach(() => {
  h.create.mockReset();
  h.verify.mockReset().mockImplementation(async (name: string) => onMaps.get(name) ?? null);
  h.store.clear();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("researching a city's night pulse", () => {
  it("keeps only places whose sources the search really returned, and confirms them on Google", async () => {
    recordedResearch();
    const pulse = await nightPulse("Berlin", Date.now() + 110_000);

    // The search ran on Anthropic's side, with a cap; the paused turn was resumed with its own content.
    expect(h.create).toHaveBeenCalledTimes(2);
    const [first, second] = h.create.mock.calls.map((c) => c[0]);
    expect(first.tools[0]).toMatchObject({ type: "web_search_20250305", name: "web_search", max_uses: 6 });
    expect(second.messages[1]).toMatchObject({ role: "assistant" });
    expect(second.messages).toHaveLength(2);

    // The invented page and the closed club are gone; dates were filled from the search's page ages.
    expect(pulse!.spots[0]!.name).toBe("Berghain");
    expect(pulse!.spots.map((s) => s.name).sort()).toEqual(["Bar Tausend", "Berghain", "Velvet Bar"]);
    const berghain = pulse!.spots[0]!;
    expect(berghain.evidence.map((e) => e.url)).toEqual([
      "https://ra.co/clubs/5031",
      "https://www.timeout.com/berlin/clubs/best-clubs-in-berlin",
      "https://www.reddit.com/r/berlin/comments/abc/where_to_go_out/",
    ]);
    expect(berghain.evidence.every((e) => e.date)).toBe(true);
    expect(berghain.place?.placeId).toBe("p_berghain");
    expect(h.verify).not.toHaveBeenCalledWith("Ghost Bar", expect.anything(), expect.anything());
  });

  it("is researched once a month: the next trip reads it from the cache", async () => {
    recordedResearch();
    await nightPulse("Berlin", Date.now() + 110_000);
    expect(await nightPulse("Berlin", Date.now() + 110_000)).not.toBeNull();
    expect(await readPulse("berlin")).not.toBeNull();
    expect(h.create).toHaveBeenCalledTimes(2);
  });

  it("researches a city once at a time", async () => {
    recordedResearch();
    const [a, b] = await Promise.all([nightPulse("Berlin", Date.now() + 110_000), nightPulse("Berlin", Date.now() + 110_000)]);
    expect(a).toBe(b);
    expect(h.create).toHaveBeenCalledTimes(2);
  });

  it("asks for the list as a tool call when the answer comes back as text", async () => {
    h.create
      .mockResolvedValueOnce({ stop_reason: "end_turn", content: [...searched("s1", "q", [result("https://ra.co/clubs/5031", "2 months ago")]), { type: "text", text: "Berghain…" }] })
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "t1", name: "submit_night_spots", input: { spots: [spot("Berghain", "club", [{ source: "RA", url: "https://ra.co/clubs/5031", date: null }])] } }],
      });
    await nightPulse("Kreuzberg", Date.now() + 110_000);
    const second = h.create.mock.calls[1]![0];
    expect(second.tool_choice).toEqual({ type: "tool", name: "submit_night_spots" });
    expect(second.messages.at(-1)).toMatchObject({ role: "user" });
  });

  it("stores nothing when too few places check out", async () => {
    h.verify.mockImplementation(async () => null);
    recordedResearch();
    expect(await nightPulse("Berlin", Date.now() + 110_000)).toBeNull();
    expect(h.store.size).toBe(0);
  });
});
