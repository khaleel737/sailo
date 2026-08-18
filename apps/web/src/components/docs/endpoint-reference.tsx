import { appOrigin } from "@sailo/core/origin";
import {
  API_ERROR_CODES,
  API_VERSION,
  DEFAULT_LIMIT,
  ENDPOINTS,
  MAX_BODY_KB,
  MAX_LIMIT,
  type Endpoint,
} from "@sailo/api/rest";
import { Code, DefTable, Heading, Pre, Table } from "./kit";

/**
 * The REST reference, rendered from `ENDPOINTS`.
 *
 * **This is the component `rest-contract.test.ts` renders.** That test walks
 * `app/api/v1/**` for real `route.ts` files in both mounts and demands that
 * every method/path pair it finds appears in the markup below — and that the
 * markup describes no pair that has no route. Adding an endpoint without
 * describing it in `@sailo/api/rest` fails the build rather than shipping a
 * page that looks authoritative and is a route short.
 *
 * Which is why the reference is a component and not MDX prose. Prose is where
 * the explanations live; anything enumerable stays here, generated, where it
 * cannot fall behind the thing it describes.
 */

export function EndpointIndex() {
  return (
    <Table
      rows={ENDPOINTS.map((endpoint) => [
        endpoint.method,
        endpoint.path,
        endpoint.scope === "write" ? `${endpoint.summary} (write)` : endpoint.summary,
      ])}
    />
  );
}

/** How many endpoints there are, for prose that would otherwise count by hand. */
export function EndpointCount() {
  return <>{ENDPOINTS.length}</>;
}

/*
 * The three numbers the prose quotes.
 *
 * Components rather than digits typed into MDX, for the reason the endpoint
 * table is generated: a page that says "50 per page" is a page that says the
 * wrong thing the day somebody changes the constant, and it keeps saying it
 * with total confidence. `MAX_BODY_KB` in particular is pinned by
 * `rest-contract.test.ts` against the literal `readJson` actually enforces.
 */

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

export function ErrorCodeTable() {
  return (
    <DefTable
      caption="Error codes and their HTTP statuses"
      rows={Object.entries(API_ERROR_CODES).map(([code, status]) => ({
        term: code,
        note: String(status),
        body: ERROR_MEANINGS[code as keyof typeof API_ERROR_CODES],
      }))}
    />
  );
}

export function EndpointReference() {
  const base = appOrigin();

  return (
    <>
      {ENDPOINTS.map((endpoint) => (
        <EndpointEntry base={base} endpoint={endpoint} key={endpoint.id} />
      ))}
    </>
  );
}

/* -------------------------------------------------------------------------- */

const ERROR_MEANINGS: Record<keyof typeof API_ERROR_CODES, string> = {
  unauthorized: "No credential, or one we do not recognise.",
  forbidden: "A real key, but not one allowed to do this — the scope, or the shop's plan.",
  not_found: "No such object in this shop. Never distinguishes 'not yours' from 'not there'.",
  invalid_request: "Malformed input — a bad cursor, an unparseable body, a missing field.",
  rate_limited: "Too many calls. Slow down and retry.",
  server_error: "Our fault. Retry; the body says nothing about the cause.",
};

/**
 * One endpoint's entry.
 *
 * The heading renders `METHOD /path` as a single text node on purpose — that
 * exact string is what `rest-contract.test.ts` looks for in the rendered HTML,
 * and splitting it across two elements would put markup in the middle of the
 * thing being asserted.
 */
function EndpointEntry({ base, endpoint }: { base: string; endpoint: Endpoint }) {
  return (
    <div className="mt-8 border-t border-ink-200 pt-6" id={endpoint.id}>
      <h3 className="font-mono text-sm font-semibold text-ink-900">
        {`${endpoint.method} ${endpoint.path}`}
        {endpoint.scope === "write" ? (
          <span className="ms-2 rounded bg-ink-100 px-1.5 py-0.5 font-sans text-[0.6875rem] font-medium text-ink-900">
            write
          </span>
        ) : null}
      </h3>

      <p className="mt-2 text-sm leading-relaxed text-ink-600">{endpoint.description}</p>

      {endpoint.params.length > 0 ? (
        <>
          <Heading>
            {endpoint.params.some((p) => p.in === "path") && endpoint.params.length === 1
              ? "Path parameter"
              : "Parameters"}
          </Heading>
          <DefTable
            caption={`Parameters for ${endpoint.method} ${endpoint.path}`}
            rows={endpoint.params.map((param) => ({
              term: param.name,
              note: `${param.in}${param.required ? ", required" : ""}`,
              body: param.description,
            }))}
          />
        </>
      ) : null}

      {endpoint.body ? (
        <>
          <Heading>Body</Heading>
          <DefTable
            caption={`Body fields for ${endpoint.method} ${endpoint.path}`}
            rows={endpoint.body.fields.map((field) => ({
              term: field.name,
              note: field.required ? "required" : "optional",
              body: field.description,
            }))}
          />
          <div className="mt-3">
            <Pre>{endpoint.body.example}</Pre>
          </div>
        </>
      ) : null}

      <Heading>Example</Heading>
      <Pre>{endpoint.curl(base)}</Pre>

      <Heading>{endpoint.result.shape === "page" ? "200 — a page" : "200"}</Heading>
      <Pre>{endpoint.successExample}</Pre>

      {endpoint.resultExtra?.map((extra) => (
        <p className="mt-2 text-xs text-ink-600" key={extra.name}>
          <Code>{extra.name}</Code> — {extra.description}
        </p>
      ))}

      <Heading>Failures</Heading>
      <DefTable
        caption={`Failure modes for ${endpoint.method} ${endpoint.path}`}
        rows={dedupeErrors(endpoint).map((error) => ({
          term: error.code,
          note: String(API_ERROR_CODES[error.code]),
          body: error.when,
        }))}
      />
    </div>
  );
}

/**
 * Two entries can share a code — a write endpoint refuses a read-only key and a
 * free plan with the same `forbidden` — and a table with the same term twice
 * reads as a mistake. Merged into one row carrying both reasons.
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
