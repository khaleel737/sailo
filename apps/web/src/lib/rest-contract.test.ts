import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ApiDocsPage from "@/app/(marketing)/docs/api/page";
import { APP_URL } from "@/lib/seo";
import {
  API_ERROR_CODES,
  ENDPOINTS,
  MAX_BODY_KB,
  endpointKey,
  openApiDocument,
} from "@sailo/api/rest";

/**
 * The route tree, the OpenAPI document and the documentation page describe one
 * API. This is what makes them agree.
 *
 * The failure it exists to catch is not a typo. It is the ordinary, invisible
 * one: somebody adds `GET /api/v1/refunds`, ships it, and the docs carry on
 * listing nine endpoints for another year — authoritative, complete-looking,
 * and wrong. Nothing in a type system notices that, because a route file and a
 * paragraph of prose have no relationship a compiler can check.
 *
 * So the filesystem is the source of truth here, deliberately. The test walks
 * `app/api/v1/**` for real `route.ts` files, reads the HTTP methods each one
 * exports, and demands that every pair it finds is described in both places —
 * and that neither place describes a pair that does not exist. Adding an
 * endpoint without documenting it fails the gate.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Where the `/api/v1` routes live today.
 *
 * `packages/rest` exists as an empty skeleton and its own docstring says the
 * REST surface moves there "once it moves out of apps/web". When that happens
 * this constant is the single thing to repoint — and the check below is why
 * that will be obvious rather than mysterious. `readdirSync` on a directory
 * that has moved throws a bare ENOENT halfway down a stack trace, which reads
 * as a broken test rather than as a migration that left something behind.
 */
/*
 * Both mounts. `/api/v1` is served from this app *and* from `apps/api` — the
 * cutover for integrators is a URL change they make when they are ready, so for
 * now the tree exists twice and the two must not drift. A route added to one and
 * not the other is a caller who gets a 404 depending which host they used.
 */
const V1_DIRS = [
  resolve(HERE, "../app/api/v1"),
  resolve(HERE, "../../../api/src/app/api/v1"),
].filter(existsSync);

if (V1_DIRS.length === 0) {
  throw new Error(
    "No `/api/v1` route directory found in either app. The docs page and the " +
      "OpenAPI document are checked against whatever these paths point at, so " +
      "an unrepointed path means nothing is being checked — repoint V1_DIRS.",
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
 * document and the docs page use. Route groups — `(foo)` — are dropped, since
 * they organise files without appearing in a URL.
 */
function routePath(file: string): string {
  /*
   * Relative to whichever mount the file came from, so the same route served by
   * both apps yields one path and the dual mount is compared rather than
   * double-counted.
   */
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
 * The anchor is `export async function GET` / `export function GET` / `export
 * const GET`, which is every form the routes here use.
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
 * React escapes text nodes on the way into the markup, so a `curl` line
 * containing quotes is not in the HTML as it is in the source. Escaped the same
 * way here rather than loosening the assertion to a substring, because the
 * point is that the *whole* example renders — a truncated one is exactly the
 * failure a looser check would wave through.
 */
const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");

const DOCUMENT = openApiDocument("https://sailo.test");
const DOCUMENT_PATHS = DOCUMENT.paths as Record<string, Record<string, unknown>>;
const RENDERED = renderToStaticMarkup(createElement(ApiDocsPage));

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
     * Deliberately not a count. Pinning "there are eight" would go red the day
     * somebody adds a ninth *and documents it properly*, which trains the next
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
      `${method} ${path} exists as a route but is not in lib/api/endpoints.ts. ` +
        "Describe it there — the docs page and the OpenAPI document are both generated from it.",
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

  it.each(ROUTES)("$method $path is on the docs page", ({ method, path }) => {
    expect(
      RENDERED,
      `${method} ${path} is not rendered anywhere on /docs/api.`,
    ).toContain(`${method} ${path}`);
  });
});

describe("the documentation", () => {
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

  /*
   * The body cap is the one number on the docs page that is typed out rather
   * than imported, because the literal lives inside `readJson` in `route.ts`
   * and that module is being moved. Pinned here so the two cannot drift while
   * they are apart.
   */
  it("states the request body cap that route.ts actually enforces", () => {
    /*
     * Resolved through the package rather than by a relative path: the adapter
     * moved from `apps/web/src/lib/api/route.ts` to `@sailo/api/rest`, and a
     * relative path would have silently stopped finding it — the regex would
     * fail to match and the assertion below would report "readJson no longer
     * caps the body" for a cap that is fine.
     */
    const source = readFileSync(
      createRequire(import.meta.url).resolve("@sailo/api/rest").replace(/[^/]+$/, "route.ts"),
      "utf8",
    );
    const match = /declared\s*>\s*(\d+)\s*\*\s*1024/.exec(source);

    expect(match, "readJson no longer caps the body the way this test reads it").not.toBeNull();
    expect(Number(match?.[1])).toBe(MAX_BODY_KB);
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

describe("the docs page", () => {
  it.each(ENDPOINTS.map((endpoint) => [endpointKey(endpoint), endpoint] as const))(
    "%s renders its curl example in full",
    (_key, endpoint) => {
      expect(RENDERED).toContain(escape(endpoint.curl(APP_URL)));
    },
  );

  it("renders every endpoint's success body", () => {
    for (const endpoint of ENDPOINTS) {
      expect(RENDERED).toContain(escape(endpoint.successExample));
    }
  });

  it("points at the page that mints a key", () => {
    expect(RENDERED).toContain("/admin/settings/integrations");
  });

  it("links the OpenAPI document", () => {
    expect(RENDERED).toContain("/api/v1/openapi.json");
  });

  /*
   * The rate limit paragraph is load-bearing rather than decorative: publishing
   * the failed-authentication budget would turn this page into a guide for
   * telling a valid key from an invalid one by watching for a 429.
   */
  it("does not publish the failed-authentication budget", () => {
    expect(RENDERED).toContain("240 requests a minute per key");
    expect(RENDERED).not.toMatch(/30 (?:failed|attempts|requests)/i);
  });
});
