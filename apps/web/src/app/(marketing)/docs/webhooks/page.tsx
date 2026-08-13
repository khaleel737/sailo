import { WEBHOOK_EVENTS } from "@/lib/webhooks/events";
import { Code, DocsShell, Heading, Pre, Section, docsMetadata, docsPath } from "../_components/docs-kit";

export const metadata = docsMetadata(
  "webhooks",
  "Webhooks — Sailo",
  "Sailo POSTs signed JSON to your endpoint when an order is paid, a booking is confirmed or a contact is created. Standard Webhooks signatures, at-least-once delivery.",
);

/**
 * How Sailo pushes events out, and how to check one is really from us.
 *
 * Public and unauthenticated on purpose — this is the only honest place to put
 * the signature recipe, because a verifier written from a half-remembered
 * description is a verifier that rejects real messages.
 *
 * The event list is rendered from `WEBHOOK_EVENTS`, the same constant the
 * delivery code filters subscriptions against, rather than from prose repeating
 * it. Documentation that states a list by hand is documentation that is wrong
 * the first time the list changes, and nobody notices for months.
 */
export default function WebhooksDocsPage() {
  return (
    <DocsShell
      page="webhooks"
      title="Webhooks"
      lede={
        <>
          Add an endpoint under Settings → Integrations, tick the events you
          want, and Sailo will <Code>POST</Code> signed JSON to it. Anything
          that accepts a webhook works — Zapier&rsquo;s <em>Catch Hook</em>,
          n8n&rsquo;s <em>Webhook</em> node, Make&rsquo;s{" "}
          <em>Custom webhook</em>, Pipedream, or your own server.
        </>
      }
    >
      <Section title="Events">
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
      </Section>

      <Section title="The payload">
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
        <p>
          Because <Code>data</Code> is the same object the REST API returns, one
          field map works against both. The full shape of each is on the{" "}
          <a className="text-brand-600 underline underline-offset-2" href={docsPath("api")}>
            REST reference
          </a>
          .
        </p>
      </Section>

      <Section title="Verifying a signature">
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
      </Section>

      <Section title="Delivery and retries">
        <p>
          Delivery is at-least-once. A POST that succeeded on your side but
          timed out on ours is retried, so{" "}
          <strong>
            deduplicate on <Code>webhook-id</Code>
          </strong>{" "}
          — it stays the same across every retry of one event, while the
          timestamp and signature are fresh each attempt.
        </p>
        <p>
          Answer with any 2xx as soon as you have stored the event; do the work
          afterwards. We wait five seconds. Failures are retried after 1m, 5m,
          30m, 2h and 12h, then abandoned. Redirects are not followed — a 3xx
          counts as a failure, so register the final URL. After 20 consecutive
          failures the endpoint is switched off and you are emailed.
        </p>

        <Heading>Testing before you go live</Heading>
        <p>
          The <em>Send test</em> button delivers a complete payload with{" "}
          <Code>{`"test": true`}</Code> and every field a real one carries —
          including the ones that would be null on a shop that has never had an
          order. That matters because Zapier builds its whole field map from the
          first payload it receives, and a thin sample is a map that breaks on
          the first real sale.
        </p>
      </Section>

      <Section title="Next">
        <p>
          To ask questions rather than be told things, use the{" "}
          <a className="text-brand-600 underline underline-offset-2" href={docsPath("api")}>
            REST API
          </a>
          . To let an AI assistant do both, see{" "}
          <a className="text-brand-600 underline underline-offset-2" href={docsPath("mcp")}>
            MCP
          </a>
          .
        </p>
      </Section>
    </DocsShell>
  );
}
