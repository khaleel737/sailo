import { apiOrigin } from "@sailo/core/origin";
import {
  API_ERROR_CODES,
  API_VERSION,
  DEFAULT_LIMIT,
  ENDPOINTS,
  MAX_BODY_KB,
  MAX_LIMIT,
  endpointKey,
  type Endpoint,
} from "@sailo/api/rest";
import { Code, DefTable, Label, Method, Pre, Prose, ScopePill } from "./kit";

/**
 * The REST reference, rendered from `ENDPOINTS`.
 *
 * **This is what `src/lib/contract.test.ts` renders.** That test walks the real
 * `app/api/v1/**` route trees in apps/web and apps/api and demands that every
 * method/path pair it finds appears in the markup below — and that the markup
 * describes no pair that has no route behind it. Adding an endpoint without
 * describing it in `@sailo/api/rest` fails the build, rather than shipping a
 * reference that looks authoritative and is one route short.
 *
 * Which is the whole reason the reference is a component and not MDX prose.
 * Prose is where the explanations live; anything enumerable stays here,
 * generated, where it cannot fall behind the thing it describes.
 */

/* -------------------------------------------------------------------------- */
/*  Where each operation lives                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The REST reference is one page per resource rather than one long page, so
 * every operation has a page as well as an anchor. This is the only place that
 * mapping is written down: the index table on `/api` links through it, and
 * `contract.test.ts` fails if an endpoint ever falls outside every section.
 *
 * Matched by longest prefix, which is what makes `/contacts/{id}/tags` land on
 * the contacts page rather than needing an entry of its own.
 */
export const SECTIONS = [
  { slug: "/api/shop", title: "Shop", prefix: "/shop" },
  { slug: "/api/orders", title: "Orders", prefix: "/orders" },
  { slug: "/api/products", title: "Products", prefix: "/products" },
  { slug: "/api/contacts", title: "Contacts", prefix: "/contacts" },
] as const;

export function sectionFor(endpoint: Endpoint): (typeof SECTIONS)[number] | undefined {
  return [...SECTIONS]
    .toSorted((a, b) => b.prefix.length - a.prefix.length)
    .find((section) => endpoint.path === section.prefix || endpoint.path.startsWith(`${section.prefix}/`));
}

/** Every operation on one resource page, in catalogue order. */
export function endpointsIn(prefix: string): Endpoint[] {
  return ENDPOINTS.filter((endpoint) => sectionFor(endpoint)?.prefix === prefix);
}

/* -------------------------------------------------------------------------- */
/*  Counts and constants the prose quotes                                      */
/* -------------------------------------------------------------------------- */

/*
 * Components rather than digits typed into MDX. A page that says "50 per page"
 * is a page that says the wrong thing the day somebody changes the constant,
 * and it keeps saying it with total confidence. `MAX_BODY_KB` in particular is
 * pinned by `contract.test.ts` against the literal `readJson` enforces.
 */

/** How many endpoints there are, for prose that would otherwise count by hand. */
export function EndpointCount() {
  return <>{ENDPOINTS.length}</>;
}

/** How many operations one resource page carries. */
export function SectionEndpointCount({ prefix }: { prefix: string }) {
  return <>{endpointsIn(prefix).length}</>;
}

/** Page size when the caller asks for none. */
export function DefaultLimit() {
  return <>{DEFAULT_LIMIT}</>;
}

/** The ceiling a larger `limit` is clamped to. */
export function MaxLimit() {
  return <>{MAX_LIMIT}</>;
}

/** The request body cap, in KB. */
export function MaxBodyKb() {
  return <>{MAX_BODY_KB}</>;
}

/** The value of the `sailo-version` header every answer carries. */
export function ApiVersion() {
  return <>{API_VERSION}</>;
}

/* -------------------------------------------------------------------------- */
/*  The index                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Every operation, as one table, each row a link to the entry that describes
 * it.
 *
 * The link is the reason this is generated rather than written: an index of
 * nine hand-typed anchors is nine chances to point at a heading that has been
 * renamed, and a documentation link that 404s to its own anchor is invisible
 * until a reader hits it.
 */
export function EndpointIndex() {
  return (
    <div className="ref-scroll">
      <table className="ref-table ref-index">
        <caption className="sr-only">Every operation the REST API exposes</caption>
        <thead>
          <tr>
            <th scope="col">Method</th>
            <th scope="col">Path</th>
            <th scope="col">What it answers</th>
          </tr>
        </thead>
        <tbody>
          {ENDPOINTS.map((endpoint) => (
            <tr key={endpoint.id}>
              <td>
                <Method method={endpoint.method} />
              </td>
              <td>
                <a className="ref-index-path" href={`${sectionFor(endpoint)?.slug ?? "/api"}#${endpoint.id}`}>
                  {endpoint.path}
                </a>
              </td>
              <td className="ref-table-body">
                <Prose>{endpoint.summary}</Prose>
                <ScopePill scope={endpoint.scope} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Errors                                                                     */
/* -------------------------------------------------------------------------- */

const ERROR_MEANINGS: Record<keyof typeof API_ERROR_CODES, string> = {
  unauthorized: "No credential, or one we do not recognise.",
  forbidden: "A real key, but not one allowed to do this — the scope, or the shop's plan.",
  not_found: "No such object in this shop. Never distinguishes 'not yours' from 'not there'.",
  invalid_request: "Malformed input — a bad cursor, an unparseable body, a missing field.",
  rate_limited: "Too many calls. Slow down and retry.",
  server_error: "Our fault. Retry; the body says nothing about the cause.",
};

export function ErrorCodeTable() {
  return (
    <DefTable
      caption="Error codes and the HTTP status each carries"
      headers={["code", "What it means"]}
      rows={Object.entries(API_ERROR_CODES).map(([code, status]) => ({
        term: code,
        note: `HTTP ${status}`,
        body: <Prose>{ERROR_MEANINGS[code as keyof typeof API_ERROR_CODES]}</Prose>,
      }))}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  The entries                                                                */
/* -------------------------------------------------------------------------- */

/** Every operation, everywhere. Rendered whole only by `contract.test.ts`. */
export function EndpointReference() {
  const base = apiOrigin();

  return (
    <>
      {ENDPOINTS.map((endpoint) => (
        <EndpointEntry base={base} endpoint={endpoint} key={endpoint.id} />
      ))}
    </>
  );
}

/** The operations on one resource page. */
export function Endpoints({ match }: { match: string }) {
  const base = apiOrigin();

  return (
    <>
      {endpointsIn(match).map((endpoint) => (
        <EndpointEntry base={base} endpoint={endpoint} key={endpoint.id} />
      ))}
    </>
  );
}

/**
 * One operation's entry.
 *
 * `data-endpoint` carries `GET /orders/{id}` as one attribute value, and that
 * is what `contract.test.ts` asserts against rather than the visible heading.
 * The heading renders the method as a coloured badge beside the path, so the
 * two are separate elements and a test scraping display text would be asserting
 * on a styling decision — it would go red the day somebody moves the badge.
 */
function EndpointEntry({ base, endpoint }: { base: string; endpoint: Endpoint }) {
  return (
    <section className="ref-entry" id={endpoint.id} data-endpoint={endpointKey(endpoint)}>
      {/*
        The space between the badge and the path is a whitespace-only text node,
        which a flex container ignores for layout — the `gap` still does the
        spacing. It exists so the heading's *text* reads "GET /orders/{id}"
        rather than "GET/orders/{id}", which is what a screen reader announces
        and what `/llms-full.txt` prints.
      */}
      <h3 className="ref-entry-title">
        <Method method={endpoint.method} />{" "}
        <span>{endpoint.path}</span>
        <ScopePill scope={endpoint.scope} />
      </h3>

      <p className="ref-entry-lead">
        <Prose>{endpoint.description}</Prose>
      </p>

      {endpoint.params.length > 0 ? (
        <>
          <Label>Parameters</Label>
          <DefTable
            caption={`Parameters for ${endpointKey(endpoint)}`}
            headers={["Parameter", "What it does"]}
            rows={endpoint.params.map((param) => ({
              term: param.name,
              note: [param.in, schemaNote(param.schema), param.required ? "required" : null]
                .filter(Boolean)
                .join(" · "),
              body: <Prose>{param.description}</Prose>,
            }))}
          />
        </>
      ) : null}

      {endpoint.body ? (
        <>
          <Label>Request body</Label>
          <DefTable
            caption={`Body fields for ${endpointKey(endpoint)}`}
            headers={["Field", "What it does"]}
            rows={endpoint.body.fields.map((field) => ({
              term: field.name,
              note: [schemaNote(field.schema), field.required ? "required" : "optional"]
                .filter(Boolean)
                .join(" · "),
              body: <Prose>{field.description}</Prose>,
            }))}
          />
          <Pre>{endpoint.body.example}</Pre>
        </>
      ) : null}

      <Label>Request</Label>
      <Pre>{endpoint.curl(base)}</Pre>

      <Label>{endpoint.result.shape === "page" ? "200 — a page of results" : "200"}</Label>
      <Pre>{endpoint.successExample}</Pre>

      {endpoint.resultExtra?.map((extra) => (
        <p className="ref-entry-lead" key={extra.name}>
          <Code>{extra.name}</Code> — <Prose>{extra.description}</Prose>
        </p>
      ))}

      <Label>Failures</Label>
      <DefTable
        caption={`Failure modes for ${endpointKey(endpoint)}`}
        headers={["code", "When it happens"]}
        rows={dedupeErrors(endpoint).map((error) => ({
          term: error.code,
          note: `HTTP ${API_ERROR_CODES[error.code]}`,
          body: <Prose>{error.when}</Prose>,
        }))}
      />
    </section>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A JSON Schema fragment, as the one phrase a reader needs.
 *
 * Only the four keywords the catalogue actually uses. An enumeration is spelled
 * out in the description already — every entry that has one interpolates the
 * constant into its prose — so repeating the members here would say the same
 * thing twice and take a column doing it.
 */
function schemaNote(schema: Record<string, unknown>): string | null {
  const type = typeof schema.type === "string" ? schema.type : null;
  if (!type) return null;
  if (type === "array") {
    const items = schema.items as { type?: string } | undefined;
    return `${items?.type ?? "any"}[]`;
  }
  if (typeof schema.format === "string") return `${type} (${schema.format})`;
  return type;
}

/**
 * Two entries on one endpoint can share a code — a write endpoint refuses a
 * read-only key and a free plan with the same `forbidden` — and a table listing
 * the same term twice reads as a mistake. Merged into one row carrying both
 * reasons, in the order a caller would meet them.
 */
function dedupeErrors(endpoint: Endpoint): { code: keyof typeof API_ERROR_CODES; when: string }[] {
  const merged = new Map<keyof typeof API_ERROR_CODES, string[]>();

  for (const error of endpoint.errors) {
    const reasons = merged.get(error.code) ?? [];
    if (!reasons.includes(error.when)) reasons.push(error.when);
    merged.set(error.code, reasons);
  }

  return [...merged.entries()].map(([code, reasons]) => ({ code, when: reasons.join(" ") }));
}
