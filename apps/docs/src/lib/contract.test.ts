import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { apiOrigin } from "@sailo/core/origin";
import {
  API_ERROR_CODES,
  ENDPOINTS,
  MAX_BODY_KB,
  endpointKey,
  openApiDocument,
} from "@sailo/api/rest";
import { MCP_TOOLS } from "@sailo/api/mcp";
import { WEBHOOK_EVENTS } from "@sailo/webhooks/events";
import {
  EndpointIndex,
  EndpointReference,
  SECTIONS,
  endpointsIn,
  sectionFor,
} from "@/components/reference/endpoints";
import { ToolReference } from "@/components/reference/mcp";
import { EventReference } from "@/components/reference/webhooks";
import { KEY_PATH } from "@/components/reference/kit";

/**
 * The route tree, the OpenAPI document and this site describe one API. This is
 * what makes them agree.
 *
 * The failure it exists to catch is not a typo. It is the ordinary, invisible
 * one: somebody adds `GET /api/v1/refunds`, ships it, and the documentation
 * carries on listing nine endpoints for another year — authoritative,
 * complete-looking, and wrong. Nothing in a type system notices that, because a
 * route file and a paragraph of prose have no relationship a compiler can
 * check.
 *
 * So the filesystem is the source of truth here, deliberately. The test walks
 * `app/api/v1/**` for real `route.ts` files, reads the HTTP methods each one
 * exports, and demands that every pair it finds is described in all three
 * places — and that none of them describes a pair that does not exist.
 *
 * WHY IT LIVES IN THE DOCS APP
 *
 * Because this app is the thing that can be wrong. It was in apps/web while the
 * documentation was; it moved with the pages it guards, which is also the only
 * way it can render them.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Both mounts.
 *
 * `/api/v1` is served from apps/web *and* from apps/api — the cutover for
 * integrators is a URL change they make when they are ready, so for now the
 * tree exists twice and the two must not drift. A route added to one and not
 * the other is a caller who gets a 404 depending which host they used.
 */
const V1_DIRS = [
  resolve(HERE, "../../../web/src/app/api/v1"),
  resolve(HERE, "../../../api/src/app/api/v1"),
].filter(existsSync);

if (V1_DIRS.length === 0) {
  throw new Error(
    "No `/api/v1` route directory found in either app. Everything below is checked " +
      "against whatever these paths point at, so an unrepointed path means nothing is " +
      "being checked — repoint V1_DIRS.",
  );
}

/**
 * The one route under `/api/v1` that is not part of the documented surface.
 *
 * It *is* the documentation — a self-describing document that listed itself
 * would be circular, and there is no shop data behind it to describe. Named
 * explicitly rather than filtered by a pattern, so a second exclusion has to be
 * argued for in a diff rather than quietly matched.
 */
const NOT_A_RESOURCE = new Set(["/openapi.json"]);

/** Only the verbs a Next route file exports as handlers. */
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

type Route = { method: string; path: string; file: string };

/** Every `route.ts` beneath a directory, depth-first. */
function routeFiles(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...routeFiles(full));
    else if (entry.name === "route.ts" || entry.name === "route.tsx") found.push(full);
  }

  return found.toSorted();
}

/**
 * `…/api/v1/contacts/[id]/tags/route.ts` → `/contacts/{id}/tags`.
 *
 * Next's `[id]` becomes OpenAPI's `{id}`, which is the spelling both the
 * document and this site use. Route groups — `(foo)` — are dropped, since they
 * organise files without appearing in a URL.
 */
function routePath(file: string): string {
  const root = V1_DIRS.find((dir) => file.startsWith(dir)) ?? V1_DIRS[0]!;
  const segments = relative(root, dirname(file))
    .split("/")
    .filter((segment) => segment && !segment.startsWith("("))
    .map((segment) =>
      segment.startsWith("[") && segment.endsWith("]")
        ? `{${segment.slice(1, -1).replace(/^\.\.\./, "")}}`
        : segment,
    );

  return `/${segments.join("/")}`;
}

/**
 * The verbs a route file exports.
 *
 * Read out of the source text rather than by importing the module: these files
 * pull the database, Redis and the mailer behind them, and a test that has to
 * boot all of that to find out a function is exported is a test nobody keeps.
 */
function methodsIn(source: string): string[] {
  return HTTP_METHODS.filter((method) =>
    new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let|var)\\s+${method}\\b`).test(source),
  );
}

const ROUTES: Route[] = V1_DIRS.flatMap(routeFiles)
  .flatMap((file) => {
    const path = routePath(file);
    if (NOT_A_RESOURCE.has(path)) return [];
    return methodsIn(readFileSync(file, "utf8")).map((method) => ({ method, path, file }));
  })
  .toSorted((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));

/**
 * React escapes text on the way into markup, so a `curl` line containing quotes
 * is not in the HTML as it is in the source. Escaped the same way here rather
 * than loosening the assertion to a substring, because the point is that the
 * *whole* example renders — a truncated one is exactly the failure a looser
 * check would wave through.
 */
const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");

/**
 * Rendered markup as the words a reader sees.
 *
 * The inverse of `escape` plus tag removal, for the assertions that are about
 * prose rather than about structure. Only the five entities React produces —
 * anything else in these strings would be a character it did not need to
 * escape.
 */
const plainText = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, "")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");

/** A source string with its inline emphasis markers removed, as `<Prose />` renders it. */
const withoutMarkers = (text: string) =>
  text.replaceAll("`", "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");

const DOCUMENT = openApiDocument("https://sailo.test");
const DOCUMENT_PATHS = DOCUMENT.paths as Record<string, Record<string, unknown>>;

/** The generated REST reference, rendered exactly as a page renders it. */
const REST = renderToStaticMarkup(
  createElement(() =>
    createElement("div", null, createElement(EndpointIndex), createElement(EndpointReference)),
  ),
);

const TOOLS = renderToStaticMarkup(createElement(ToolReference));
const EVENTS = renderToStaticMarkup(createElement(EventReference));

/* -------------------------------------------------------------------------- */

describe("the v1 route tree", () => {
  /*
   * A guard on the guard. Every assertion below is a loop over `ROUTES`, and a
   * walker that silently found nothing — a moved directory, a renamed folder —
   * would make all of them pass vacuously, which is the one way this whole file
   * could stop protecting anything without going red.
   */
  it("finds the routes at all", () => {
    expect(ROUTES.length).toBeGreaterThan(0);

    /*
     * Deliberately not a count. Pinning "there are nine" would go red the day
     * somebody adds a tenth *and documents it properly*, which trains the next
     * person to edit this file rather than read it. What is worth asserting is
     * that the walk still reaches a nested, parameterised route — if `[id]`
     * stopped becoming `{id}`, or the recursion stopped descending, every
     * assertion below would pass against a shorter list and mean nothing.
     */
    expect(ROUTES.some((route) => route.path.includes("/{id}"))).toBe(true);
    expect(ROUTES.some((route) => route.path.split("/").length > 3)).toBe(true);
  });

  it.each(ROUTES)("$method $path is in the endpoint registry", ({ method, path }) => {
    expect(
      ENDPOINTS.map(endpointKey),
      `${method} ${path} exists as a route but is not in @sailo/api/rest's endpoint ` +
        "catalogue. Describe it there — this site and the OpenAPI document are both " +
        "generated from it.",
    ).toContain(`${method} ${path}`);
  });

  it.each(ROUTES)("$method $path is in the OpenAPI document", ({ method, path }) => {
    const operations = DOCUMENT_PATHS[`/api/v1${path}`];
    expect(operations, `/api/v1${path} is missing from openapi.json`).toBeDefined();
    expect(
      Object.keys(operations ?? {}),
      `openapi.json describes /api/v1${path} but not its ${method}`,
    ).toContain(method.toLowerCase());
  });

  /*
   * Asserted against `data-endpoint` rather than the visible heading. The
   * heading renders the method as a badge beside the path — two elements — so
   * scraping display text would make this test an assertion about a styling
   * decision, and it would go red the day somebody moves the badge.
   */
  it.each(ROUTES)("$method $path has an entry on the site", ({ method, path }) => {
    expect(REST, `${method} ${path} is not rendered anywhere in the REST reference.`).toContain(
      `data-endpoint="${escape(`${method} ${path}`)}"`,
    );
  });
});

describe("the endpoint catalogue", () => {
  const REAL = new Set(ROUTES.map((route) => `${route.method} ${route.path}`));

  it.each(ENDPOINTS.map(endpointKey))("%s is a route that exists", (key) => {
    expect(
      [...REAL],
      `${key} is documented but no route file under app/api/v1 serves it.`,
    ).toContain(key);
  });

  it("documents every route exactly once", () => {
    const keys = ENDPOINTS.map(endpointKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every endpoint a unique anchor", () => {
    const ids = ENDPOINTS.map((endpoint) => endpoint.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * Every endpoint lands on a resource page.
   *
   * `SECTIONS` is what the index table links through, and an endpoint outside
   * every prefix would silently get a link to `/api#its-anchor` — a page that
   * does not carry its entry. That is a dead link the moment a new resource is
   * added, and it is exactly the sort of thing nobody clicks in review.
   */
  it.each(ENDPOINTS.map((endpoint) => [endpointKey(endpoint), endpoint] as const))(
    "%s belongs to a documented section",
    (key, endpoint) => {
      expect(sectionFor(endpoint), `${key} matches no section prefix in SECTIONS.`).toBeDefined();
    },
  );

  it("has no empty section", () => {
    for (const section of SECTIONS) {
      expect(endpointsIn(section.prefix).length, `${section.slug} would render nothing.`)
        .toBeGreaterThan(0);
    }
  });

  it("renders every endpoint's curl example in full", () => {
    for (const endpoint of ENDPOINTS) {
      expect(REST).toContain(escape(endpoint.curl(apiOrigin())));
    }
  });

  it("renders every endpoint's success body", () => {
    for (const endpoint of ENDPOINTS) {
      expect(REST).toContain(escape(endpoint.successExample));
    }
  });

  /*
   * The body cap is the one number quoted on this site that is typed out rather
   * than imported, because the literal lives inside `readJson` in
   * `@sailo/api/rest`'s route adapter. Pinned here so the two cannot drift.
   */
  it("states the request body cap that route.ts actually enforces", () => {
    const source = readFileSync(
      createRequire(import.meta.url).resolve("@sailo/api/rest").replace(/[^/]+$/, "route.ts"),
      "utf8",
    );
    const match = /declared\s*>\s*(\d+)\s*\*\s*1024/.exec(source);

    expect(match, "readJson no longer caps the body the way this test reads it").not.toBeNull();
    expect(Number(match?.[1])).toBe(MAX_BODY_KB);
  });

  /*
   * The path to minting a key, which is the one route on another origin this
   * site hard-codes. It is written down once in `kit.tsx`; this is what notices
   * if apps/web ever moves it.
   */
  it("points at a plausible key-minting path", () => {
    expect(KEY_PATH.startsWith("/admin/")).toBe(true);
  });
});

describe("the OpenAPI document", () => {
  it("is 3.1", () => {
    expect(DOCUMENT.openapi).toMatch(/^3\.1\.\d+$/);
  });

  it("carries the pieces a generator needs", () => {
    expect(DOCUMENT.info).toMatchObject({ title: expect.any(String), version: expect.any(String) });
    expect(DOCUMENT.servers).toEqual([expect.objectContaining({ url: "https://sailo.test" })]);
    expect(DOCUMENT.security).toEqual([{ bearerAuth: [] }]);
  });

  it("describes exactly the documented endpoints, and no more", () => {
    const operations = Object.entries(DOCUMENT_PATHS).flatMap(([path, verbs]) =>
      Object.keys(verbs).map((verb) => `${verb.toUpperCase()} ${path.replace("/api/v1", "")}`),
    );

    expect(operations.toSorted()).toEqual(ENDPOINTS.map(endpointKey).toSorted());
  });

  it("gives every operation a 200 and a 401", () => {
    for (const [path, verbs] of Object.entries(DOCUMENT_PATHS)) {
      for (const [verb, operation] of Object.entries(verbs)) {
        const responses = (operation as { responses: Record<string, unknown> }).responses;
        expect(Object.keys(responses), `${verb} ${path}`).toContain("200");
        expect(Object.keys(responses), `${verb} ${path}`).toContain(
          String(API_ERROR_CODES.unauthorized),
        );
      }
    }
  });

  it("gives every operation a unique operationId", () => {
    const ids = Object.values(DOCUMENT_PATHS).flatMap((verbs) =>
      Object.values(verbs).map((operation) => (operation as { operationId: string }).operationId),
    );

    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * Every `$ref` resolves.
   *
   * A dangling one is the failure that survives review: the document parses,
   * the page renders, and the generator produces a client with a field of type
   * `any` where an order used to be.
   */
  it("has no dangling $ref", () => {
    const schemas = (DOCUMENT.components as { schemas: Record<string, unknown> }).schemas;
    const refs = new Set<string>();

    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;

      for (const [key, value] of Object.entries(node)) {
        if (key === "$ref" && typeof value === "string") refs.add(value);
        else walk(value);
      }
    };

    walk(DOCUMENT);

    expect(refs.size).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref).toMatch(/^#\/components\/schemas\//);
      expect(Object.keys(schemas)).toContain(ref.replace("#/components/schemas/", ""));
    }
  });

  it("uses 3.1 nullability rather than 3.0's nullable keyword", () => {
    expect(JSON.stringify(DOCUMENT)).not.toContain('"nullable"');
  });
});

/**
 * The two surfaces that have no route tree to be checked against.
 *
 * A tool and an event are not files on disk, so there is nothing to walk. What
 * *can* be checked is that the reference renders every one of them — which is
 * the same failure in a different shape: a tool added to `MCP_TOOLS` that no
 * page shows is a capability an integrator cannot discover.
 */
describe("the MCP reference", () => {
  it("renders every tool", () => {
    for (const tool of MCP_TOOLS) {
      expect(TOOLS, `${tool.name} is not rendered.`).toContain(`data-tool="${tool.name}"`);
    }
  });

  /**
   * Every word the server sends a model is on the page, in order.
   *
   * Compared as text rather than as markup, because the descriptions are
   * written with backticks — `send_opt_in`, `marketingConsentAt` — and the page
   * renders those as `<code>` elements rather than as literal punctuation. That
   * is a rendering of the string, not an edit to it, so the assertion strips
   * both the tags and the markers and demands the remaining prose match
   * exactly.
   *
   * The point it protects is real: these sentences are what a model reads when
   * it decides whether it may do something, and `create_contact`'s says in
   * plain words that it cannot grant consent. A page that paraphrased them
   * would send whoever is debugging a surprising answer to look for a cause
   * that is not in the code.
   */
  it("prints each tool's description exactly as the server sends it", () => {
    const rendered = plainText(TOOLS);

    for (const tool of MCP_TOOLS) {
      expect(rendered, `${tool.name}'s description is not on the page verbatim.`).toContain(
        withoutMarkers(tool.description),
      );
    }
  });

  it("names every required argument", () => {
    for (const tool of MCP_TOOLS) {
      for (const name of (tool.inputSchema.required ?? []) as string[]) {
        expect(TOOLS, `${tool.name}.${name} is required but not documented.`).toContain(name);
      }
    }
  });
});

describe("the webhook reference", () => {
  it("renders every event", () => {
    for (const event of WEBHOOK_EVENTS) {
      expect(EVENTS, `${event} is not rendered.`).toContain(event);
    }
  });

  /*
   * `EVENT_MEANINGS` is a `Record<WebhookEvent, string>`, so an undocumented
   * event is already a typecheck failure. This catches the other half: an entry
   * that exists but is empty, which typechecks perfectly.
   */
  it("says something about each one", () => {
    const rendered = EVENTS.split("</tr>");
    for (const event of WEBHOOK_EVENTS) {
      const row = rendered.find((chunk) => chunk.includes(`>${event}`));
      expect(row, `${event} has no row.`).toBeDefined();
      expect((row ?? "").length, `${event}'s description is empty.`).toBeGreaterThan(
        event.length + 80,
      );
    }
  });
});
