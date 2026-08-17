import { APP_URL } from "@/lib/seo";
import { API_ERROR_CODES, API_VERSION, DEFAULT_LIMIT, MAX_LIMIT } from "@sailo/api/rest";
import { ENDPOINTS, MAX_BODY_KB, type Endpoint } from "@sailo/api/rest";
import {
  Code,
  DefTable,
  DocsShell,
  Heading,
  Pre,
  Section,
  Table,
  docsMetadata,
  docsPath,
} from "../_components/docs-kit";

export const metadata = docsMetadata(
  "api",
  "REST API — Sailo",
  "Read a Sailo shop's orders, products and contacts over HTTP, and add people to its list. Cursor-paged, one envelope for every answer.",
);

/**
 * The REST reference.
 *
 * **Every endpoint below is rendered from `lib/api/endpoints.ts`**, which is
 * also what `/api/v1/openapi.json` is built from and what `endpoints.test.ts`
 * compares against the route tree. Prose describing an endpoint by hand is
 * prose that stops being true the first time somebody adds a filter, and the
 * page carries on looking authoritative while it lies. Adding a route without
 * describing it there fails the gate rather than shipping.
 *
 * This URL is unchanged from when it was the whole of the documentation. It is
 * what is linked from outside and already indexed, so the split moved the
 * webhook and MCP material *out* to siblings and left this page where it was.
 */
export default function ApiDocsPage() {
  const base = APP_URL;

  return (
    <DocsShell
      page="api"
      title="REST API"
      lede={
        <>
          Base URL <Code>{`${base}/api/v1`}</Code>. Everything returns{" "}
          <Code>{`{ "data": … }`}</Code>; failures return{" "}
          <Code>{`{ "error": { "code", "message" } }`}</Code> with a matching
          HTTP status. Responses carry a <Code>sailo-version</Code> header,
          currently <Code>{API_VERSION}</Code>.
        </>
      }
    >
      <Section title="The endpoints">
        <Table
          rows={ENDPOINTS.map((endpoint) => [
            endpoint.method,
            endpoint.path,
            endpoint.scope === "write" ? `${endpoint.summary} (write)` : endpoint.summary,
          ])}
        />
        <p>
          A machine-readable description of all {ENDPOINTS.length} lives at{" "}
          <a
            className="text-brand-600 underline underline-offset-2"
            href="/api/v1/openapi.json"
          >
            <Code>/api/v1/openapi.json</Code>
          </a>{" "}
          — OpenAPI 3.1, no key required, which is what you point Postman or an
          SDK generator at.
        </p>
      </Section>

      <Section title="Authenticating">
        <p>
          Send the key in the <Code>Authorization</Code> header and nowhere
          else. A key in a query string is written into every access log and
          proxy it passes through.
        </p>
        <Pre>{`curl ${base}/api/v1/shop \\
  -H "Authorization: Bearer sailo_sk_…"`}</Pre>
        <p>
          Keys are shown once, at creation, and stored hashed — there is no way
          to recover one, so a lost key is rotated rather than looked up. Every
          key is read-only unless you tick <Code>write</Code>, and a read-only
          key reaching a write endpoint is told exactly that rather than given a
          bare 403.
        </p>
        <p>
          A key we will not accept is refused identically whether it never
          existed, was revoked, or belongs to a shop that has since been
          deleted. That is deliberate: learning <em>which</em> would tell the
          holder of a token that it used to be real.
        </p>
      </Section>

      <Section title="Paging">
        <p>
          Cursor-based, {DEFAULT_LIMIT} per page by default and up to{" "}
          {MAX_LIMIT}. Pass the <Code>next_cursor</Code> from one response as{" "}
          <Code>?cursor=</Code> on the next, and stop when <Code>has_more</Code>{" "}
          is false. Loop on <Code>has_more</Code> rather than on whether the
          cursor is null — the two answer different questions, and a consumer
          branching on the cursor gets the wrong one on the last full page.
        </p>
        <p>
          Cursors name a position in the ordering rather than an offset, so
          orders arriving mid-scan cannot make you skip one. They are opaque;
          building anything on their internals is building on something that
          will change. A cursor we did not issue is a{" "}
          <Code>invalid_request</Code>, not an empty page.
        </p>
        <p>
          Asking for more than {MAX_LIMIT} is clamped rather than refused, so a
          caller who sends <Code>limit=1000</Code> gets {MAX_LIMIT} and a
          working integration.
        </p>
      </Section>

      <Section title="Errors">
        <p>
          Branch on <Code>code</Code>. It is stable — one is never renamed, only
          added to — while <Code>message</Code> is a sentence for a person and
          may be reworded at any time.
        </p>
        <DefTable
          caption="Error codes and their HTTP statuses"
          rows={Object.entries(API_ERROR_CODES).map(([code, status]) => ({
            term: code,
            note: String(status),
            body: ERROR_MEANINGS[code as keyof typeof API_ERROR_CODES],
          }))}
        />
        <p>
          A <Code>server_error</Code> body never says what went wrong. A stack
          trace, a Postgres message or a constraint name in a response is a
          description of our schema handed to whoever provoked it.
        </p>
      </Section>

      <Section title="Limits">
        <p>
          <strong>240 requests a minute per key.</strong> Per key rather than
          per address, deliberately: an integration and a seller&rsquo;s browser
          routinely share an office IP, and a Zap running flat out must not be
          able to throttle its owner out of their own admin. High enough that no
          ordinary integration will meet it.
        </p>
        <p>
          Requests that fail to authenticate are separately and more tightly
          limited, per source address. That budget is for guessing, so its size
          is not published and you should not calibrate against it — a client
          that has a valid key will never encounter it, and one that is probing
          for keys learns nothing from the response either way.
        </p>
        <p>
          Request bodies are capped at {MAX_BODY_KB} KB. There is no CORS on any
          of this: keys are for servers, and a key a browser can send is a key
          in somebody&rsquo;s bundle.
        </p>
      </Section>

      <Section title="Consent, on the contact endpoints">
        <p>
          <strong>
            Nothing here can mark anyone as consenting to marketing email.
          </strong>{" "}
          A contact created through the API always has{" "}
          <Code>marketingConsentAt: null</Code>, whatever you send — consent is
          something a person gave, not something a request body can assert. To
          get it, pass <Code>{`"sendOptIn": true`}</Code>: Sailo emails them the
          same double opt-in link the public signup form uses, and consent is
          recorded when they click it.
        </p>
        <p>
          Filter with <Code>?consented=true</Code> when syncing to a newsletter
          tool. Everyone else on the list is a customer who never agreed to be
          emailed.
        </p>
      </Section>

      <Section title="Reference">
        <p>
          Every endpoint, with what it takes and what it answers. Ids in the
          examples are illustrative; yours are UUIDs.
        </p>
        {ENDPOINTS.map((endpoint) => (
          <EndpointEntry base={base} endpoint={endpoint} key={endpoint.id} />
        ))}
      </Section>

      <Section title="Next">
        <p>
          Events pushed to you rather than polled for are on{" "}
          <a className="text-brand-600 underline underline-offset-2" href={docsPath("webhooks")}>
            webhooks
          </a>
          . The same endpoints, exposed to an AI assistant, are on{" "}
          <a className="text-brand-600 underline underline-offset-2" href={docsPath("mcp")}>
            MCP
          </a>
          .
        </p>
      </Section>
    </DocsShell>
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
 * exact string is what `endpoints.test.ts` looks for in the rendered HTML, and
 * splitting it across two elements would put markup in the middle of the thing
 * being asserted.
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

      <p className="mt-2">{endpoint.description}</p>

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
        <p className="mt-2 text-xs" key={extra.name}>
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
