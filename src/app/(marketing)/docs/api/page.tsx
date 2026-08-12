import type { Metadata } from "next";
import { appUrl } from "@/lib/app-url";
import { API_VERSION, MAX_LIMIT } from "@/lib/api/respond";
import { WEBHOOK_EVENTS } from "@/lib/webhooks/events";
import { MODERN_VERSION, SUPPORTED_VERSIONS } from "@/lib/mcp/protocol";

export const metadata: Metadata = {
  title: "API, webhooks and MCP — Sailo",
  description:
    "Connect Sailo to Zapier, n8n, Make or an AI assistant. Signed webhooks, a REST API and an MCP server.",
};

/**
 * The documentation for everything a program can do with a Sailo shop.
 *
 * Public and unauthenticated on purpose. Someone evaluating whether Sailo can
 * fit their stack needs to read this *before* they have an account, and an
 * integration guide behind a login is one nobody finds. It is also the only
 * honest place to put the signature recipe — a verifier written from a
 * half-remembered description is a verifier that rejects real messages.
 *
 * Rendered from the same constants the server uses — the event list, the
 * protocol versions, the page limit — rather than from prose repeating them.
 * Documentation that states a number by hand is documentation that is wrong
 * the first time the number changes, and nobody notices for months.
 */
export default function ApiDocsPage() {
  const base = appUrl();

  return (
    <main id="main" className="mx-auto max-w-3xl px-5 py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
        API, webhooks and MCP
      </h1>
      <p className="mt-3 text-ink-600">
        Sailo speaks three ways to the outside world, and one key opens all
        three: webhooks push events to you, the REST API lets you ask questions,
        and the MCP server lets an AI assistant do both. Create a key under{" "}
        <strong>Settings → Integrations</strong>.
      </p>

      <Section title="Getting a key">
        <p>
          Keys are shown once, at creation, and stored hashed — there is no way
          to recover one, so a lost key is rotated rather than looked up. Every
          key is read-only unless you tick <Code>write</Code>.
        </p>
        <Pre>{`curl ${base}/api/v1/shop \\
  -H "Authorization: Bearer sailo_sk_…"`}</Pre>
        <p>
          Send the key in the <Code>Authorization</Code> header and nowhere
          else. A key in a query string is written into every access log and
          proxy it passes through.
        </p>
      </Section>

      <Section title="Webhooks">
        <p>
          Add an endpoint under Settings → Integrations, tick the events you
          want, and Sailo will <Code>POST</Code> signed JSON to it. Anything
          that accepts a webhook works — Zapier&rsquo;s{" "}
          <em>Catch Hook</em>, n8n&rsquo;s <em>Webhook</em> node,
          Make&rsquo;s <em>Custom webhook</em>, Pipedream, or your own server.
        </p>

        <h3 className="mt-6 text-sm font-semibold text-ink-900">Events</h3>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {WEBHOOK_EVENTS.map((event) => (
            <li key={event}>
              <Code>{event}</Code>
            </li>
          ))}
        </ul>
        <p className="mt-3">
          On a card sale <Code>order.created</Code> and <Code>order.paid</Code>{" "}
          arrive together, when the payment lands — not when the buyer opens the
          checkout, because a third of those are abandoned. On bank transfer,
          cash or any other manual rail, <Code>order.created</Code> fires at
          checkout and <Code>order.paid</Code> when you confirm the money
          arrived.
        </p>

        <h3 className="mt-6 text-sm font-semibold text-ink-900">The payload</h3>
        <Pre>{`{
  "id": "8f2b…",              // also the webhook-id header
  "type": "order.paid",
  "timestamp": "2026-08-12T09:41:07.221Z",
  "version": 1,
  "test": false,              // true only for the "Send test" button
  "shop": { "id": "…", "handle": "acme" },
  "data": { /* the same object GET /api/v1/orders/{id} returns */ }
}`}</Pre>
        <p>
          New fields may appear inside <Code>data</Code> without the{" "}
          <Code>version</Code> changing. It is bumped only when something
          already there changes meaning or disappears, so build your mapping to
          ignore fields it does not recognise.
        </p>
        <p>
          Money is always an object:{" "}
          <Code>{`{ "cents": 4999, "amount": "49.99", "currency": "GBP" }`}</Code>.
          Use <Code>cents</Code> for arithmetic and <Code>amount</Code> for
          anything a person will read — <Code>cents</Code> is correct for
          zero-decimal currencies like JPY too, where dividing by 100 is not.
        </p>

        <h3 className="mt-6 text-sm font-semibold text-ink-900">
          Verifying a signature
        </h3>
        <p>
          Sailo signs with{" "}
          <a
            className="text-brand-600 underline underline-offset-2"
            href="https://www.standardwebhooks.com"
            rel="noreferrer noopener"
            target="_blank"
          >
            Standard Webhooks
          </a>
          , so you can use an off-the-shelf library rather than transcribing a
          recipe. Three headers arrive:
        </p>
        <Pre>{`webhook-id:        8f2b…             (unique per delivery)
webhook-timestamp: 1786527667        (seconds since epoch)
webhook-signature: v1,K5oZfzN95Z9…   (base64 HMAC-SHA256)`}</Pre>
        <Pre>{`import { Webhook } from "standardwebhooks";

const wh = new Webhook(process.env.SAILO_WEBHOOK_SECRET); // whsec_…
const payload = wh.verify(rawBody, headers);              // throws if invalid`}</Pre>
        <p>
          By hand: the signed content is{" "}
          <Code>{"`${id}.${timestamp}.${rawBody}`"}</Code>, HMAC-SHA256 with the{" "}
          <em>base64-decoded</em> bytes of the secret (drop the{" "}
          <Code>whsec_</Code> prefix first), base64-encoded. Sign the raw body
          exactly as received — re-serialising the parsed JSON will not match.
        </p>

        <h3 className="mt-6 text-sm font-semibold text-ink-900">
          Delivery and retries
        </h3>
        <p>
          Delivery is at-least-once. A POST that succeeded on your side but
          timed out on ours is retried, so <strong>deduplicate on{" "}
          <Code>webhook-id</Code></strong> — it stays the same across every
          retry of one event, while the timestamp and signature are fresh each
          attempt.
        </p>
        <p>
          Answer with any 2xx as soon as you have stored the event; do the work
          afterwards. We wait five seconds. Failures are retried after 1m, 5m,
          30m, 2h and 12h, then abandoned. Redirects are not followed — a 3xx
          counts as a failure, so register the final URL. After 20 consecutive
          failures the endpoint is switched off and you are emailed.
        </p>
      </Section>

      <Section title="REST API">
        <p>
          Base URL <Code>{`${base}/api/v1`}</Code>. Everything returns{" "}
          <Code>{`{ "data": … }`}</Code>; failures return{" "}
          <Code>{`{ "error": { "code", "message" } }`}</Code> with a matching
          HTTP status. Responses carry a <Code>sailo-version</Code> header,
          currently <Code>{API_VERSION}</Code>.
        </p>

        <Table
          rows={[
            ["GET", "/shop", "The shop this key belongs to"],
            ["GET", "/orders", "Orders, newest first"],
            ["GET", "/orders/{id}", "One order, with line items"],
            ["GET", "/products", "Catalogue, newest first"],
            ["GET", "/products/{id}", "One product, with variants"],
            ["GET", "/contacts", "The shop's list"],
            ["GET", "/contacts/{id}", "One contact"],
            ["POST", "/contacts", "Create or update a contact (write)"],
            ["POST", "/contacts/{id}/tags", "Add and remove tags (write)"],
          ]}
        />

        <h3 className="mt-6 text-sm font-semibold text-ink-900">Paging</h3>
        <p>
          Cursor-based, up to {MAX_LIMIT} per page. Pass the{" "}
          <Code>next_cursor</Code> from one response as <Code>?cursor=</Code> on
          the next, and stop when <Code>has_more</Code> is false. Cursors name a
          position rather than an offset, so orders arriving mid-scan cannot
          make you skip one.
        </p>
        <Pre>{`curl "${base}/api/v1/orders?limit=50&payment_status=paid" \\
  -H "Authorization: Bearer sailo_sk_…"`}</Pre>

        <h3 className="mt-6 text-sm font-semibold text-ink-900">
          Adding contacts
        </h3>
        <p>
          <Code>POST /contacts</Code> is idempotent by person: sending somebody
          twice updates them and merges tags rather than duplicating them.
        </p>
        <p>
          <strong>It cannot mark anyone as consenting to marketing email.</strong>{" "}
          A contact created this way always has{" "}
          <Code>marketingConsentAt: null</Code>, whatever you send — consent is
          something a person gave, not something a request body can assert. To
          get it, pass <Code>{`"sendOptIn": true`}</Code>: Sailo emails them the
          same double opt-in link the public signup form uses, and consent is
          recorded when they click it.
        </p>
        <Pre>{`curl -X POST ${base}/api/v1/contacts \\
  -H "Authorization: Bearer sailo_sk_…" \\
  -H "Content-Type: application/json" \\
  -d '{"email":"ada@example.com","name":"Ada","tags":["webinar"],"sendOptIn":true}'`}</Pre>
        <p>
          Filter with <Code>?consented=true</Code> when syncing to a newsletter
          tool. Everyone else on the list is a customer who never agreed to be
          emailed.
        </p>

        <h3 className="mt-6 text-sm font-semibold text-ink-900">Limits</h3>
        <p>
          240 requests a minute per key. There is no CORS: keys are for servers,
          and a key a browser can send is a key in somebody&rsquo;s bundle.
        </p>
      </Section>

      <Section title="MCP — connecting an AI assistant">
        <p>
          Sailo runs a Model Context Protocol server at{" "}
          <Code>{`${base}/api/mcp`}</Code>. Point Claude, or any MCP client, at
          that address with an API key as a bearer token, and it can read your
          orders, products and contacts — and, with a write key, add contacts
          and change their tags.
        </p>
        <Pre>{`{
  "mcpServers": {
    "sailo": {
      "url": "${base}/api/mcp",
      "headers": { "Authorization": "Bearer sailo_sk_…" }
    }
  }
}`}</Pre>
        <p>
          The server is stateless and speaks protocol version{" "}
          <Code>{MODERN_VERSION}</Code>, and still answers the{" "}
          <Code>initialize</Code> handshake for older clients — supported
          versions are {SUPPORTED_VERSIONS.join(", ")}. A read-only key does not
          see the write tools at all, so an assistant given one cannot promise
          to change something it may not.
        </p>
      </Section>

      <Section title="What Sailo does not do">
        <p>
          There is no per-app directory and no OAuth app registration. A signed
          webhook plus a key reaches Zapier, n8n, Make, Pipedream and everything
          behind them, which is a larger set than any list of logos we could
          maintain — and it means nothing you build here depends on us shipping
          a connector for your tool.
        </p>
      </Section>
    </main>
  );
}

/* -------------------------------------------------------------------------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="text-xl font-semibold tracking-tight text-ink-900">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-600">
        {children}
      </div>
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[0.8125rem] text-ink-900">
      {children}
    </code>
  );
}

function Pre({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl bg-ink-900 px-4 py-3 font-mono text-xs leading-relaxed text-ink-50">
      {children}
    </pre>
  );
}

function Table({ rows }: { rows: [string, string, string][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="mt-2 w-full min-w-[30rem] text-sm">
        <tbody className="divide-y divide-ink-200">
          {rows.map(([method, path, what]) => (
            <tr key={`${method} ${path}`}>
              <td className="py-2 pe-3 font-mono text-xs font-semibold text-ink-900">
                {method}
              </td>
              <td className="py-2 pe-3 font-mono text-xs text-ink-900">{path}</td>
              <td className="py-2 text-xs text-ink-600">{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
