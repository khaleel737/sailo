import { authenticateApi, type ApiCaller } from "@/lib/api/auth";
import { appUrl } from "@/lib/app-url";
import {
  CAPABILITIES,
  INSTRUCTIONS,
  LEGACY_VERSIONS,
  MODERN_VERSION,
  RPC_ERRORS,
  SERVER_INFO,
  SERVER_INFO_META,
  SUPPORTED_VERSIONS,
  checkHeaders,
  completeResult,
  eraOf,
  isLegacyVersion,
  protocolVersionFrom,
  rpcError,
  rpcResult,
  type Era,
  type JsonRpcId,
  type JsonRpcRequest,
} from "@/lib/mcp/protocol";
import { findTool, toolResponse, toolsFor } from "@/lib/mcp/tools";

/**
 * Sailo's MCP endpoint — one shop, addressed by a language model.
 *
 * The same API key that opens `/api/v1` opens this, because they are one
 * grant: "this program may act on my shop, within these scopes". A seller who
 * revokes a key revokes both, which is what they will expect.
 *
 * **Stateless, and the current revision makes that easy.** `2026-07-28`
 * removed protocol-level sessions and the standalone GET stream, so every
 * request is a self-contained POST that carries its own version, identity and
 * credential. There is nothing to store between calls and nothing to expire —
 * which is exactly the shape a serverless function can serve correctly, and
 * not the shape the older revisions had.
 *
 * It is also **dual-era**: a client that opens with `initialize` gets the
 * handshake it expects and the same tools afterwards. That is not politeness,
 * it is the difference between working with the clients people have installed
 * today and working only with the ones they will install later.
 */

export const maxDuration = 60;

/* -------------------------------------------------------------------------- */
/*  What is not allowed                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The current revision has no GET stream and no session to delete, and tells a
 * server that receives either to say so with 405 rather than inventing a
 * behaviour. An older client that tries will fall back correctly.
 */
export function GET() {
  return methodNotAllowed();
}

export function DELETE() {
  return methodNotAllowed();
}

function methodNotAllowed() {
  return new Response(
    JSON.stringify(
      rpcError(
        null,
        RPC_ERRORS.invalidRequest,
        "This endpoint accepts POST only. Streams are opened per request; there are no sessions.",
      ),
    ),
    {
      status: 405,
      headers: { "content-type": "application/json", allow: "POST" },
    },
  );
}

/* -------------------------------------------------------------------------- */
/*  The endpoint                                                               */
/* -------------------------------------------------------------------------- */

export async function POST(request: Request) {
  /*
   * Origin first, before anything is parsed or authenticated.
   *
   * The specification makes this a MUST for a reason that is easy to miss on a
   * hosted server: it is the DNS-rebinding defence. A page on the open web can
   * make a browser POST here, and while it cannot read a cross-origin response
   * without CORS — and nothing here sends CORS headers — a request that
   * *executes* is already too far when the tools include writes. An absent
   * Origin is the normal case, because MCP clients are not browsers.
   */
  const origin = request.headers.get("origin");
  if (origin && origin !== appUrl()) {
    return json(
      rpcError(null, RPC_ERRORS.invalidRequest, "Origin not allowed."),
      403,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(rpcError(null, RPC_ERRORS.parse, "Body is not valid JSON."), 400);
  }

  if (!isJsonRpcRequest(body)) {
    return json(
      rpcError(null, RPC_ERRORS.invalidRequest, "Expected a single JSON-RPC 2.0 request."),
      400,
    );
  }

  const rpc = body;
  const id = rpc.id ?? null;
  const headerVersion = request.headers.get("mcp-protocol-version");
  const era = eraOf(rpc, headerVersion);

  /*
   * A notification carries no id and expects no result — the transport says
   * answer `202` with an empty body. `notifications/initialized` is the only
   * one a legacy client sends, and a server that replied to it with a JSON-RPC
   * result would be sending a response to something that is not a request.
   */
  if (rpc.id === undefined || rpc.method.startsWith("notifications/")) {
    return new Response(null, { status: 202 });
  }

  /* ---- Version ---------------------------------------------------------- */

  const asked = protocolVersionFrom(rpc) ?? headerVersion;
  if (asked && !(SUPPORTED_VERSIONS as readonly string[]).includes(asked)) {
    /*
     * The `supported` list is the whole point of this error: a client that
     * asked for something we do not speak can pick one from here and retry,
     * which is the entire negotiation mechanism now that there is no
     * handshake to negotiate in.
     */
    return json(
      rpcError(id, RPC_ERRORS.unsupportedVersion, "Unsupported protocol version", {
        supported: SUPPORTED_VERSIONS,
        requested: asked,
      }),
      400,
    );
  }

  /* ---- Header/body agreement, modern only -------------------------------- */

  if (era === "modern") {
    const check = checkHeaders(rpc, {
      protocolVersion: headerVersion,
      method: request.headers.get("mcp-method"),
      name: request.headers.get("mcp-name"),
    });
    if (!check.ok) {
      return json(
        rpcError(id, RPC_ERRORS.headerMismatch, `Header mismatch: ${check.message}`),
        400,
      );
    }
  }

  /* ---- The handshake, legacy only ---------------------------------------- */

  /*
   * Answered *before* authentication, on purpose.
   *
   * `initialize` is how a legacy client discovers what it is talking to, and a
   * 401 in its place is a dead end it cannot diagnose — several clients report
   * it as "server unreachable". Nothing is disclosed: the answer is our name,
   * our version and the fact that we have tools, all of which are public.
   * Every tool call still needs a key.
   */
  if (rpc.method === "initialize") {
    const wanted = readString(rpc.params?.protocolVersion);
    return json(
      rpcResult(id, {
        /*
         * Echo the client's version when we speak it, rather than always
         * naming our newest. A client that asked for `2025-06-18` and is told
         * `2025-11-25` has been handed a dialect it may not implement.
         */
        protocolVersion:
          wanted && isLegacyVersion(wanted) ? wanted : LEGACY_VERSIONS[0],
        capabilities: CAPABILITIES,
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      }),
    );
  }

  /* ---- Discovery, modern's replacement for it ----------------------------- */

  if (rpc.method === "server/discover") {
    return json(
      rpcResult(
        id,
        completeResult(era, {
          supportedVersions: SUPPORTED_VERSIONS,
          capabilities: CAPABILITIES,
          instructions: INSTRUCTIONS,
          _meta: { [SERVER_INFO_META]: SERVER_INFO },
        }),
      ),
    );
  }

  /* ---- Everything else needs a key --------------------------------------- */

  const auth = await authenticateApi(request);
  if (!auth.ok) {
    const status = auth.failure.code === "rate_limited" ? 429 : 401;
    /*
     * The refusal is passed through as it is. It already names the header to
     * use when that is what is missing, and appending a second copy of the
     * same sentence — which an earlier version did — reads as a bug in the
     * one place a person is already confused.
     */
    return json(
      rpcError(id, RPC_ERRORS.invalidRequest, auth.failure.message),
      status,
      status === 401
        ? { "www-authenticate": `Bearer realm="Sailo", error="invalid_token"` }
        : undefined,
    );
  }

  switch (rpc.method) {
    case "tools/list":
      return json(rpcResult(id, completeResult(era, { tools: listTools(auth.caller) })));

    case "tools/call":
      return callTool(auth.caller, rpc, id, era);

    /*
     * Declared in no capability, so a conformant client never asks — but a
     * client that probes anyway gets an empty list rather than a 404, which is
     * the friendlier of two correct answers.
     */
    case "resources/list":
      return json(rpcResult(id, completeResult(era, { resources: [] })));
    case "prompts/list":
      return json(rpcResult(id, completeResult(era, { prompts: [] })));

    default:
      /*
       * 404 with a JSON-RPC body, which the transport specifies precisely so a
       * client can tell "this server does not implement that method" from a
       * bare 404 served by something that is not an MCP endpoint at all.
       */
      return json(
        rpcError(id, RPC_ERRORS.methodNotFound, `Unknown method: ${rpc.method}`),
        404,
      );
  }
}

/* -------------------------------------------------------------------------- */

function listTools(caller: ApiCaller) {
  return toolsFor(caller).map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

async function callTool(
  caller: ApiCaller,
  rpc: JsonRpcRequest,
  id: JsonRpcId,
  era: Era,
): Promise<Response> {
  const name = readString(rpc.params?.name);
  if (!name) {
    return json(rpcError(id, RPC_ERRORS.invalidParams, "`name` is required."), 400);
  }

  const tool = findTool(caller, name);
  if (!tool) {
    /*
     * A protocol error rather than a tool error, and the message names the
     * likely cause. A read-only key genuinely does not have `create_contact`,
     * and "unknown tool" without that hint sends whoever is debugging to look
     * for a typo that is not there.
     */
    return json(
      rpcError(
        id,
        RPC_ERRORS.invalidParams,
        `Unknown tool: ${name}. It may exist but need a key with write access.`,
      ),
      400,
    );
  }

  const args =
    rpc.params?.arguments && typeof rpc.params.arguments === "object"
      ? (rpc.params.arguments as Record<string, unknown>)
      : {};

  try {
    return json(rpcResult(id, completeResult(era, toolResponse(await tool.run(caller, args)))));
  } catch (error) {
    console.error(`[sailo] mcp tool ${name} failed`, error);
    /*
     * Reported as a tool error, not a protocol one, and with nothing about the
     * cause in it. A stack trace or a Postgres message here goes straight into
     * a model's context and from there into whatever it writes next.
     */
    return json(
      rpcResult(
        id,
        completeResult(era, {
          content: [{ type: "text", text: "That failed on Sailo's side. Try again." }],
          isError: true,
        }),
      ),
    );
  }
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.jsonrpc === "2.0" && typeof candidate.method === "string";
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function json(body: unknown, status = 200, extra?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      /*
       * Echoed so an intermediary can see which revision this exchange used.
       * Named unconditionally rather than mirroring the request, because a
       * response that omits it is one a strict client may reject.
       */
      "mcp-protocol-version": MODERN_VERSION,
      "cache-control": "no-store, private",
      ...extra,
    },
  });
}
