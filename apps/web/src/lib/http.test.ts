import { describe, expect, it } from "vitest";
import { HttpError, handler } from "./http";
import { ndjsonResponse } from "./stream";

const URL_ = "https://www.youtube.com/watch?v=jF6N2OKo8rk";

describe("sending someone elsewhere", () => {
  it("is in the JSON error, for the phone app and edits", async () => {
    const res = await handler(async () => {
      throw new HttpError(403, "Pylos doesn't plan trips there.", "blocked_destination", URL_);
    })();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Pylos doesn't plan trips there.", code: "blocked_destination", redirect: URL_ });
  });

  it("is a redirect event in a streamed build", async () => {
    const res = ndjsonResponse(async () => {
      throw new HttpError(403, "Pylos doesn't plan trips there.", "blocked_destination", URL_);
    });
    expect((await res.text()).trim().split("\n").map((l) => JSON.parse(l))).toEqual([{ type: "redirect", to: URL_ }]);
  });

  it("leaves other errors alone", async () => {
    const res = await handler(async () => {
      throw new HttpError(400, "Which city?");
    })();
    expect(await res.json()).toEqual({ error: "Which city?" });
  });
});
