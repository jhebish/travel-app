import { describe, expect, it } from "vitest";
import { googleSignInError, signInProviders } from "../src";

const reply = (ok: boolean, body: unknown) => async () => ({ ok, json: async () => body });

describe("signInProviders", () => {
  it("lists the providers switched on, from Supabase's public auth settings", async () => {
    let asked = "";
    let key = "";
    const on = await signInProviders("https://abc.supabase.co/", "pk", async (url, init) => {
      asked = url;
      key = init.headers.apikey ?? "";
      return { ok: true, json: async () => ({ external: { email: true, google: true, apple: false, anonymous_users: true } }) };
    });
    expect(asked).toBe("https://abc.supabase.co/auth/v1/settings");
    expect(key).toBe("pk");
    expect([...on].sort()).toEqual(["anonymous_users", "email", "google"]);
  });

  it("says nothing is on when it can't tell", async () => {
    expect((await signInProviders("https://abc.supabase.co", "pk", reply(false, {}))).size).toBe(0);
    expect((await signInProviders("https://abc.supabase.co", "pk", reply(true, null))).size).toBe(0);
    expect((await signInProviders("", "pk", reply(true, { external: { google: true } }))).size).toBe(0);
    const down = await signInProviders("https://abc.supabase.co", "pk", async () => {
      throw new Error("offline");
    });
    expect(down.size).toBe(0);
  });
});

describe("googleSignInError", () => {
  it("reads why Google's round trip came back without a session", () => {
    expect(googleSignInError(null, null)).toBeNull();
    expect(googleSignInError("server_error", "identity_already_exists")).toBe("taken");
    expect(googleSignInError("server_error", "email_exists")).toBe("taken");
    expect(googleSignInError("access_denied", null)).toBe("cancelled");
    expect(googleSignInError("server_error", "unexpected_failure")).toBe("failed");
  });
});
