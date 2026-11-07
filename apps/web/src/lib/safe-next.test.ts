import { describe, expect, it } from "vitest";
import { redirectOnSite, safeNext } from "./safe-next";

const ORIGIN = "https://www.pylos.ai";

describe("safeNext", () => {
  it("keeps paths on this site, with their query and hash", () => {
    expect(safeNext("/trips")).toBe("/trips");
    expect(safeNext("/trip/abc?tab=hotels#day-2")).toBe("/trip/abc?tab=hotels#day-2");
    expect(safeNext("/profile#connect")).toBe("/profile#connect");
  });

  it("sends empty or unparseable input home", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext("")).toBe("/");
  });

  it.each([
    "//evil.com",
    "/\\evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "\t//evil.com",
    "/\n/evil.com",
    // Dot segments that only become "//evil.com" once resolved.
    "/.//evil.com",
    "/..//evil.com",
    "/%2e//evil.com",
    "/%2E%2E//evil.com",
    "/a/..//evil.com",
    "/./\\evil.com",
    "https://pylos.invalid//evil.com/x",
  ])("never leaves the site: %j", (raw) => {
    const next = safeNext(raw);
    expect(next.startsWith("/")).toBe(true);
    expect(next.startsWith("//")).toBe(false);
    expect(new URL(next, ORIGIN).origin).toBe(ORIGIN);
  });
});

describe("redirectOnSite", () => {
  it("resolves paths against the site", () => {
    expect(redirectOnSite("/trips", ORIGIN).href).toBe(`${ORIGIN}/trips`);
  });

  it.each(["//evil.com", "https://evil.com/x", "\\\\evil.com"])("falls back to the home page for %j", (next) => {
    expect(redirectOnSite(next, ORIGIN).href).toBe(`${ORIGIN}/`);
  });
});
