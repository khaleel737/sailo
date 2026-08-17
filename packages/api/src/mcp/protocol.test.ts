import { describe, expect, it } from "vitest";
import {
  LEGACY_VERSIONS,
  MODERN_VERSION,
  PROTOCOL_VERSION_META,
  SUPPORTED_VERSIONS,
  checkHeaders,
  completeResult,
  decodeHeaderValue,
  eraOf,
  protocolVersionFrom,
  type JsonRpcRequest,
} from "./protocol";

/**
 * The rules that decide whether a client can talk to us at all.
 *
 * Every one of these is a MUST in the specification, and each has the same
 * failure mode when it is wrong: the endpoint works perfectly against whatever
 * client it was developed with, and refuses — or silently mis-serves — every
 * other one. There is no way to notice that without asserting the rules.
 */

const modern = (method: string, params: Record<string, unknown> = {}): JsonRpcRequest => ({
  jsonrpc: "2.0",
  id: 1,
  method,
  params: { ...params, _meta: { [PROTOCOL_VERSION_META]: MODERN_VERSION } },
});

describe("eraOf", () => {
  it("reads a modern request from its _meta", () => {
    expect(eraOf(modern("tools/list"), MODERN_VERSION)).toBe("modern");
  });

  it("reads a legacy request from `initialize`", () => {
    const rpc: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "initialize" };
    expect(eraOf(rpc, null)).toBe("legacy");
  });

  it("treats a _meta naming a legacy version as legacy", () => {
    const rpc: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: { _meta: { [PROTOCOL_VERSION_META]: LEGACY_VERSIONS[0] } },
    };
    expect(eraOf(rpc, LEGACY_VERSIONS[0])).toBe("legacy");
  });

  it("falls back to the header, then to modern", () => {
    const bare: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    expect(eraOf(bare, "2025-06-18")).toBe("legacy");
    expect(eraOf(bare, null)).toBe("modern");
  });

  it("treats notifications as legacy — the modern revision sends none", () => {
    const rpc: JsonRpcRequest = { jsonrpc: "2.0", method: "notifications/initialized" };
    expect(eraOf(rpc, null)).toBe("legacy");
  });
});

describe("protocolVersionFrom", () => {
  it("finds the version, or says there is none", () => {
    expect(protocolVersionFrom(modern("tools/list"))).toBe(MODERN_VERSION);
    expect(protocolVersionFrom({ jsonrpc: "2.0", id: 1, method: "x" })).toBeNull();
    expect(
      protocolVersionFrom({ jsonrpc: "2.0", id: 1, method: "x", params: { _meta: {} } }),
    ).toBeNull();
  });
});

describe("checkHeaders", () => {
  const ok = { protocolVersion: MODERN_VERSION, method: "tools/list", name: null };

  it("passes a well-formed request", () => {
    expect(checkHeaders(modern("tools/list"), ok)).toEqual({ ok: true });
  });

  it("requires the protocol version header", () => {
    const result = checkHeaders(modern("tools/list"), { ...ok, protocolVersion: null });
    expect(result.ok).toBe(false);
  });

  it("refuses a header that disagrees with the body", () => {
    /*
     * The point of the rule: a load balancer may route on the header while the
     * server executes on the body, so a request where the two differ can be
     * made to mean two different things in two places.
     */
    expect(
      checkHeaders(modern("tools/list"), { ...ok, protocolVersion: "2025-06-18" }).ok,
    ).toBe(false);
    expect(checkHeaders(modern("tools/list"), { ...ok, method: "tools/call" }).ok).toBe(
      false,
    );
  });

  it("requires Mcp-Name only for the methods that name something", () => {
    // `tools/list` names nothing, so demanding it would reject a conformant call.
    expect(checkHeaders(modern("tools/list"), { ...ok, name: null }).ok).toBe(true);

    const call = modern("tools/call", { name: "get_shop" });
    expect(
      checkHeaders(call, { protocolVersion: MODERN_VERSION, method: "tools/call", name: null })
        .ok,
    ).toBe(false);
    expect(
      checkHeaders(call, {
        protocolVersion: MODERN_VERSION,
        method: "tools/call",
        name: "get_shop",
      }),
    ).toEqual({ ok: true });
    expect(
      checkHeaders(call, {
        protocolVersion: MODERN_VERSION,
        method: "tools/call",
        name: "list_orders",
      }).ok,
    ).toBe(false);
  });

  it("decodes the base64 sentinel before comparing", () => {
    /*
     * A client MUST wrap a non-ASCII value this way, and a server that
     * compared the wrapped form to the body value would reject every one of
     * them — so the decode is required, not an optimisation.
     */
    const call = modern("tools/call", { name: "héllo" });
    const encoded = `=?base64?${Buffer.from("héllo", "utf8").toString("base64")}?=`;
    expect(
      checkHeaders(call, {
        protocolVersion: MODERN_VERSION,
        method: "tools/call",
        name: encoded,
      }),
    ).toEqual({ ok: true });
  });
});

describe("decodeHeaderValue", () => {
  it("leaves a plain value alone", () => {
    expect(decodeHeaderValue("get_shop")).toBe("get_shop");
    expect(decodeHeaderValue("=?base64?notclosed")).toBe("=?base64?notclosed");
  });

  it("unwraps the sentinel", () => {
    const wrapped = `=?base64?${Buffer.from("Hello, 世界", "utf8").toString("base64")}?=`;
    expect(decodeHeaderValue(wrapped)).toBe("Hello, 世界");
  });
});

describe("completeResult", () => {
  it("stamps resultType for modern clients only", () => {
    /*
     * `resultType` is a modern field. A strict legacy client validating
     * against its own schema rejects a result carrying fields it has never
     * heard of, so this cannot simply always be present.
     */
    expect(completeResult("modern", { tools: [] })).toEqual({
      resultType: "complete",
      tools: [],
    });
    expect(completeResult("legacy", { tools: [] })).toEqual({ tools: [] });
  });
});

describe("SUPPORTED_VERSIONS", () => {
  it("leads with the modern revision and includes every legacy one", () => {
    // The list is sent verbatim in UnsupportedProtocolVersionError, and it is
    // the only mechanism a client has to pick a version it can speak.
    expect(SUPPORTED_VERSIONS[0]).toBe(MODERN_VERSION);
    for (const version of LEGACY_VERSIONS) {
      expect(SUPPORTED_VERSIONS).toContain(version);
    }
  });
});
