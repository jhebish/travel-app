import type { BuildEvent } from "@travel/core";
import { HttpError } from "./http";

/**
 * Stream build progress as newline-delimited JSON. `run` emits events through `send` and
 * resolves with the final payload, sent as `{type:"done"}`; failures become `{type:"error"}`.
 */
export function ndjsonResponse(run: (send: (e: BuildEvent) => void) => Promise<Extract<BuildEvent, { type: "done" }>["trip"]>) {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: BuildEvent) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          /* client went away */
        }
      };
      try {
        const trip = await run(send);
        send({ type: "done", trip });
      } catch (e) {
        if (!(e instanceof HttpError)) console.error(e);
        send({
          type: "error",
          message: e instanceof HttpError ? e.message : "Something went wrong. Try again.",
          code: e instanceof HttpError ? e.code : "server_error",
        });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
