import { describe, expect, it, vi } from "vitest";
import { eventStreamResponse } from "./event-stream";
import type { BusEvent, EventSubscription } from "./events";

/**
 * The stream's wire contract, read off a real ReadableStream rather than
 * asserted against internals.
 *
 * Three things have to hold or the whole feature quietly stops working:
 * the greeting tells the client which mode it is in (that is what arms the
 * poll fallback), a published event reaches the wire as a `change` message,
 * and closing — from either side — detaches the bus subscription. The last
 * one is the invariant with teeth: a leaked subscription is a Redis
 * connection held until the process dies, multiplied by every dashboard
 * tab ever opened.
 */

function harness(live: boolean) {
  let deliver: ((event: BusEvent) => void) | null = null;
  const close = vi.fn(async () => {});
  const subscribe = async (
    onEvent: (event: BusEvent) => void,
  ): Promise<EventSubscription> => {
    deliver = onEvent;
    return { live, close };
  };
  return { subscribe, close, deliver: (e: BusEvent) => deliver?.(e) };
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (soFar: string) => boolean,
): Promise<string> {
  const decoder = new TextDecoder();
  let seen = "";
  while (!predicate(seen)) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += decoder.decode(value, { stream: true });
  }
  return seen;
}

describe("eventStreamResponse", () => {
  it("greets with the mode and forwards events as change messages", async () => {
    const { subscribe, deliver } = harness(true);
    const controller = new AbortController();

    const response = await eventStreamResponse(subscribe, controller.signal);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    // `no-transform` is load-bearing: a compressing proxy that buffers to
    // gzip would hold events until its window fills.
    expect(response.headers.get("cache-control")).toContain("no-transform");

    const body = response.body;
    if (!body) throw new Error("response had no body to read");
    const reader = body.getReader();
    const greeting = await readUntil(reader, (s) => s.includes("event: mode"));
    expect(greeting).toContain("retry: ");
    expect(greeting).toContain('data: {"live":true}');

    deliver({ kind: "order" });
    const change = await readUntil(reader, (s) => s.includes("event: change"));
    expect(change).toContain('data: {"kind":"order"}');

    controller.abort();
  });

  it("says live:false when it can only hear its own process", async () => {
    const { subscribe } = harness(false);
    const controller = new AbortController();

    const response = await eventStreamResponse(subscribe, controller.signal);
    const body = response.body;
    if (!body) throw new Error("response had no body to read");
    const reader = body.getReader();
    const greeting = await readUntil(reader, (s) => s.includes("event: mode"));
    expect(greeting).toContain('data: {"live":false}');

    controller.abort();
  });

  it("closes the bus subscription when the client goes away", async () => {
    const { subscribe, close } = harness(true);
    const controller = new AbortController();

    const response = await eventStreamResponse(subscribe, controller.signal);
    const body = response.body;
    if (!body) throw new Error("response had no body to read");
    const reader = body.getReader();
    await readUntil(reader, (s) => s.includes("event: mode"));

    controller.abort();
    // The reader drains to done — the server really ended the response
    // rather than leaving the browser hanging on a dead connection.
    const { done } = await reader.read().then(
      (r) => (r.done ? r : reader.read()),
    );
    expect(done).toBe(true);
    expect(close).toHaveBeenCalled();
  });

  it("closes the subscription even when the client was gone on arrival", async () => {
    const { subscribe, close } = harness(true);
    const controller = new AbortController();
    controller.abort();

    const response = await eventStreamResponse(subscribe, controller.signal);
    // Draining the (empty) stream is what runs start() to completion.
    const body = response.body;
    if (!body) throw new Error("response had no body to read");
    const reader = body.getReader();
    await readUntil(reader, () => false);
    expect(close).toHaveBeenCalled();
  });
});
