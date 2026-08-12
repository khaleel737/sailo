/**
 * The wire rules for Sailo's MCP endpoint, written against the published
 * specification rather than remembered.
 *
 * Two eras have to work, and the difference between them is not cosmetic:
 *
 * - **Modern** (`2026-07-28`) has no handshake at all. Every request carries
 *   its own version, identity and capabilities in `params._meta`, mirrored
 *   into HTTP headers that the server **must** verify against the body.
 *   There are no sessions, no `Mcp-Session-Id`, no GET stream.
 * - **Legacy** (`2025-11-25` and earlier) opens with an `initialize`
 *   handshake and negotiates once.
 *
 * Supporting only the first would be correct and useless: a great many
 * shipping clients still open with `initialize`. Supporting only the second
 * would be quietly wrong the moment a client updates. The spec calls a server
 * that does both *dual-era* and says it may serve both on one endpoint, which
 * is what this does — the era is decided by how the client opens, and every
 * method below dispatches to the same handlers either way.
 *
 * No `server-only`: this is pure shape-handling over plain objects, which is
 * what makes the whole protocol testable without a socket.
 */

/* -------------------------------------------------------------------------- */
/*  Versions                                                                   */
/* -------------------------------------------------------------------------- */

/** The revision this server implements natively. */
export const MODERN_VERSION = "2026-07-28";

/**
 * Handshake-based revisions we still answer.
 *
 * Both are listed rather than only the newest, because a legacy client names
 * the version *it* wants in `initialize` and expects that value echoed back —
 * a server that always answers `2025-11-25` to a client asking for
 * `2025-06-18` has told it to speak a dialect it does not know.
 */
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18"] as const;

export const SUPPORTED_VERSIONS = [MODERN_VERSION, ...LEGACY_VERSIONS] as const;

export function isLegacyVersion(value: string): boolean {
  return (LEGACY_VERSIONS as readonly string[]).includes(value);
}

/** The `_meta` key every modern request carries its version under. */
export const PROTOCOL_VERSION_META = "io.modelcontextprotocol/protocolVersion";
export const SERVER_INFO_META = "io.modelcontextprotocol/serverInfo";

export const SERVER_INFO = { name: "sailo", version: "1.0.0" } as const;

/* -------------------------------------------------------------------------- */
/*  JSON-RPC                                                                   */
/* -------------------------------------------------------------------------- */

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

export const RPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  /** MCP: the HTTP headers disagree with the body, or one is missing. */
  headerMismatch: -32020,
  /** MCP: we do not implement the version the caller asked for. */
  unsupportedVersion: -32022,
} as const;

export function rpcResult(id: JsonRpcId, result: Record<string, unknown>) {
  return { jsonrpc: "2.0" as const, id: id ?? null, result };
}

export function rpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
) {
  return {
    jsonrpc: "2.0" as const,
    id: id ?? null,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

/* -------------------------------------------------------------------------- */
/*  Which era is this?                                                         */
/* -------------------------------------------------------------------------- */

export type Era = "modern" | "legacy";

/**
 * Decided by how the client opened, exactly as the spec's dual-era section
 * describes.
 *
 * `_meta` carrying a protocol version is the modern signal and it is
 * unambiguous — no legacy revision ever sent that key. `initialize` is the
 * legacy signal, equally unambiguous, because the modern revision removed the
 * method. Everything else falls back to what the header claims, and then to
 * modern: a client that sends neither is far more likely to be new and
 * slightly wrong than old.
 */
export function eraOf(request: JsonRpcRequest, headerVersion: string | null): Era {
  const metaVersion = protocolVersionFrom(request);
  if (metaVersion) return isLegacyVersion(metaVersion) ? "legacy" : "modern";
  if (request.method === "initialize" || request.method.startsWith("notifications/")) {
    return "legacy";
  }
  if (headerVersion && isLegacyVersion(headerVersion)) return "legacy";
  return "modern";
}

export function protocolVersionFrom(request: JsonRpcRequest): string | null {
  /*
   * Bracketed rather than dotted. The key is `_meta` because the protocol says
   * so, and a leading underscore is exactly what `no-underscore-dangle` exists
   * to catch — turning the rule off repo-wide to accommodate one externally
   * mandated field would switch it off for the private-member conventions it
   * is actually there to police.
   */
  const meta = request.params?.["_meta"];
  if (!meta || typeof meta !== "object") return null;
  const value = (meta as Record<string, unknown>)[PROTOCOL_VERSION_META];
  return typeof value === "string" ? value : null;
}

/* -------------------------------------------------------------------------- */
/*  Header validation — modern only                                            */
/* -------------------------------------------------------------------------- */

/**
 * Values may arrive Base64-wrapped when they are not plain ASCII.
 *
 * The sentinel is `=?base64?…?=`, case-sensitive and exactly as written. A
 * server comparing the wrapped form to the body value would reject every tool
 * whose name is not pure ASCII, so the spec requires decoding *before*
 * comparing — this is that decode.
 */
export function decodeHeaderValue(value: string): string {
  if (!value.startsWith("=?base64?") || !value.endsWith("?=")) return value;
  const inner = value.slice("=?base64?".length, -"?=".length);
  try {
    return Buffer.from(inner, "base64").toString("utf8");
  } catch {
    return value;
  }
}

export type HeaderCheck = { ok: true } | { ok: false; message: string };

/**
 * The modern revision's header/body agreement rules.
 *
 * They exist because a load balancer may route on the header while the server
 * executes on the body, and a request where the two disagree is one that can
 * be made to mean two different things in two places. That is the whole
 * reason this is a MUST rather than a nicety, and it is why a mismatch is a
 * refusal rather than a preference for one source.
 */
export function checkHeaders(
  request: JsonRpcRequest,
  headers: {
    protocolVersion: string | null;
    method: string | null;
    name: string | null;
  },
): HeaderCheck {
  const metaVersion = protocolVersionFrom(request);

  if (!headers.protocolVersion) {
    return { ok: false, message: "The MCP-Protocol-Version header is required." };
  }
  if (metaVersion && headers.protocolVersion !== metaVersion) {
    return {
      ok: false,
      message:
        `MCP-Protocol-Version header '${headers.protocolVersion}' does not match ` +
        `the _meta protocol version '${metaVersion}'.`,
    };
  }
  if (!headers.method) {
    return { ok: false, message: "The Mcp-Method header is required." };
  }
  if (decodeHeaderValue(headers.method) !== request.method) {
    return {
      ok: false,
      message: `Mcp-Method header '${headers.method}' does not match body method '${request.method}'.`,
    };
  }

  /*
   * `Mcp-Name` is required only for the three methods that name a thing.
   * Demanding it everywhere would reject a perfectly conformant `tools/list`.
   */
  const named = NAMED_METHODS[request.method];
  if (named) {
    const bodyValue = request.params?.[named];
    if (typeof bodyValue === "string") {
      if (!headers.name) {
        return { ok: false, message: `The Mcp-Name header is required for ${request.method}.` };
      }
      if (decodeHeaderValue(headers.name) !== bodyValue) {
        return {
          ok: false,
          message: `Mcp-Name header does not match body ${named} '${bodyValue}'.`,
        };
      }
    }
  }

  return { ok: true };
}

/** Which param `Mcp-Name` mirrors, per method. */
const NAMED_METHODS: Record<string, string | undefined> = {
  "tools/call": "name",
  "prompts/get": "name",
  "resources/read": "uri",
};

/* -------------------------------------------------------------------------- */
/*  Results                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * `resultType: "complete"` is a modern field and must not appear in a legacy
 * response.
 *
 * It exists in the modern revision to distinguish a finished result from an
 * `input_required` one under multi round-trip requests. A legacy client has
 * never heard of it, and a strict one validating against its own schema will
 * reject a result carrying unknown fields — so the era decides, in one place,
 * rather than each handler remembering.
 */
export function completeResult(era: Era, body: Record<string, unknown>) {
  return era === "modern" ? { resultType: "complete", ...body } : body;
}

/** What the server can do, in the shape both eras expect. */
export const CAPABILITIES = {
  tools: { listChanged: false },
} as const;

export const INSTRUCTIONS =
  "Read and manage one Sailo shop: its orders, products and contacts. " +
  "Amounts are returned both as integer minor units (`cents`) and as a decimal " +
  "string (`amount`) — quote the decimal string to people. " +
  "A contact's `marketingConsentAt` is null unless that person opted in; never " +
  "treat a contact without it as someone who agreed to be emailed.";
