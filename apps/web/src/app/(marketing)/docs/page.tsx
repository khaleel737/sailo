import { APP_URL } from "@/lib/seo";
import { WEBHOOK_EVENTS } from "@/lib/webhooks/events";
import { ENDPOINTS } from "@/lib/api/endpoints";
import { MCP_TOOLS } from "@/lib/mcp/tools";
import { Code, DocsShell, Pre, Section, docsMetadata, docsPath } from "./_components/docs-kit";

export const metadata = docsMetadata(
  "index",
  "Developer documentation — Sailo",
  "Connect Sailo to Zapier, n8n, Make or an AI assistant. Signed webhooks, a REST API and an MCP server, all opened by one key.",
);

/**
 * The index over the three things a program can do with a Sailo shop.
 *
 * Public and unauthenticated on purpose. Someone evaluating whether Sailo fits
 * their stack needs to read this *before* they have an account, and an
 * integration guide behind a login is one nobody finds.
 *
 * The counts below are read off the same arrays the server uses rather than
 * typed out. A page that says "nine endpoints" in prose is a page that says
 * eight once somebody adds one, and nobody notices for months.
 */
export default function DocsIndexPage() {
  const base = APP_URL;

  return (
    <DocsShell
      page="index"
      title="Developer documentation"
      lede={
        <>
          Sailo speaks three ways to the outside world, and one key opens all
          three: webhooks push events to you, the REST API lets you ask
          questions, and the MCP server lets an AI assistant do both.
        </>
      }
    >
      <Section title="Start here">
        <div className="grid gap-3 sm:grid-cols-3">
          <Card
            href={docsPath("api")}
            title="REST API"
            body={`${ENDPOINTS.length} endpoints over orders, products and contacts. Cursor-paged, one envelope for every answer.`}
          />
          <Card
            href={docsPath("webhooks")}
            title="Webhooks"
            body={`${WEBHOOK_EVENTS.length} events, signed with Standard Webhooks and retried on failure.`}
          />
          <Card
            href={docsPath("mcp")}
            title="MCP"
            body={`${MCP_TOOLS.length} tools an AI assistant can call, over the same key and the same rules.`}
          />
        </div>
      </Section>

      <Section title="The shape of everything">
        <p>
          One credential, sent one way. Every call carries{" "}
          <Code>Authorization: Bearer sailo_sk_…</Code> and nothing goes in a
          query string — a token in a URL is written into every access log,
          proxy log and browser history it passes through.
        </p>
        <Pre>{`curl ${base}/api/v1/shop \\
  -H "Authorization: Bearer sailo_sk_…"`}</Pre>
        <p>
          Every REST answer is <Code>{`{ "data": … }`}</Code>; every failure is{" "}
          <Code>{`{ "error": { "code", "message" } }`}</Code> with a matching
          HTTP status. Branch on <Code>code</Code> — it is stable and only ever
          added to — and never on the message, which is a sentence for a person
          and may be reworded.
        </p>
        <p>
          Money is always an object:{" "}
          <Code>{`{ "cents": 4999, "amount": "49.99", "currency": "GBP" }`}</Code>.
          Use <Code>cents</Code> for arithmetic and <Code>amount</Code> for
          anything a person will read — <Code>cents</Code> is correct for
          zero-decimal currencies like JPY too, where dividing by 100 is not.
        </p>
        <p>
          There is a machine-readable description of the REST surface at{" "}
          <a
            className="text-brand-600 underline underline-offset-2"
            href="/api/v1/openapi.json"
          >
            <Code>/api/v1/openapi.json</Code>
          </a>
          . It needs no key.
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
        <p>
          The documentation is English only for now, unlike the marketing pages
          and the blog. An integration guide half-translated is worse than one
          honestly in one language: a mistranslated signature recipe is a
          verifier that rejects real messages.
        </p>
      </Section>
    </DocsShell>
  );
}

function Card({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <a
      className="rounded-xl border border-ink-200 px-4 py-3 transition-colors hover:border-ink-900"
      href={href}
    >
      <span className="block text-sm font-semibold text-ink-900">{title}</span>
      <span className="mt-1 block text-xs text-ink-600">{body}</span>
    </a>
  );
}
