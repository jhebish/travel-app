import { describe, expect, it } from "vitest";
import { DEMO_TRAVELERS, HOW_PYLOS_LEARNS } from "../src";

describe("the home page's example travelers", () => {
  it("gives each one a stay, then a day in time order, each stop with a reason", () => {
    expect(DEMO_TRAVELERS.length).toBe(3);
    expect(new Set(DEMO_TRAVELERS.map((t) => t.key)).size).toBe(3);
    for (const t of DEMO_TRAVELERS) {
      expect(t.stops[0]!.time).toBe("Stay");
      const times = t.stops.slice(1).map((s) => s.time);
      expect(times.length).toBeGreaterThanOrEqual(4);
      // Past midnight counts as the same night out.
      const minutes = times.map((x) => {
        const [h, m] = x.split(":").map(Number);
        return (h! < 6 ? h! + 24 : h!) * 60 + m!;
      });
      expect(minutes).toEqual([...minutes].sort((a, b) => a - b));
      for (const s of t.stops) expect(s.why.length).toBeGreaterThan(10);
    }
    expect(HOW_PYLOS_LEARNS).toHaveLength(3);
  });
});
