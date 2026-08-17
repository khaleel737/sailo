import { APP_URL } from "@/lib/seo";
import { MCP_TOOLS, type McpTool } from "@sailo/api/mcp";
import { MODERN_VERSION, SERVER_INFO, SUPPORTED_VERSIONS } from "@sailo/api/mcp";
import {
  Code,
  DefTable,
  DocsShell,
  Heading,
  Pre,
  Section,
  docsMetadata,
  docsPath,
} from "../_components/docs-kit";

export const metadata = docsMetadata(
  "mcp",
  "MCP server — Sailo",
  "Connect Claude, Cursor or any MCP client to a Sailo shop with an API key. Read orders, products and contacts; with a write key, add contacts and change tags.",
);

/**
 * The MCP reference.
 *
 * **The tool table is generated from `MCP_TOOLS`** — the same array the server
 * answers `tools/list` from — walking each `inputSchema` for its properties.
 * Hand-copying it would produce a table that is right on the day it is written
 * and quietly wrong afterwards, and this page is read by people wiring an
 * assistant to a real shop's data.
 *
 * The protocol versions come from `lib/mcp/protocol.ts` for the same reason.
 */
export default function McpDocsPage() {
  const base = APP_URL;
  const url = `${base}/api/mcp`;

  return (
    <DocsShell
      page="mcp"
      title="MCP — connecting an AI assistant"
      lede={
        <>
          Sailo runs a Model Context Protocol server at <Code>{url}</Code>.
          Point Claude, Cursor, or any MCP client at that address with an API
          key as a bearer token, and it can read your orders, products and
          contacts — and, with a write key, add contacts and change their tags.
        </>
      }
    >
      <Section title="Connecting">
        <p>
          One HTTP endpoint, one bearer token, no OAuth dance and no separate
          registration. The key is the same one the REST API takes.
        </p>

        <Heading>Claude Code</Heading>
        <Pre>{`claude mcp add --transport http sailo ${url} \\
  --header "Authorization: Bearer sailo_sk_…"`}</Pre>
        <p>
          Or commit it to a repo so everyone working in it gets the same
          connection, in <Code>.mcp.json</Code>:
        </p>
        <Pre>{`{
  "mcpServers": {
    "sailo": {
      "type": "http",
      "url": "${url}",
      "headers": { "Authorization": "Bearer sailo_sk_…" }
    }
  }
}`}</Pre>

        <Heading>Claude Desktop</Heading>
        <p>
          Settings → Connectors → <em>Add custom connector</em>, and give it{" "}
          <Code>{url}</Code>. Where a build has no connector UI, the
          configuration file reaches a remote server through the{" "}
          <Code>mcp-remote</Code> bridge:
        </p>
        <Pre>{`{
  "mcpServers": {
    "sailo": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote", "${url}",
        "--header", "Authorization: Bearer sailo_sk_…"
      ]
    }
  }
}`}</Pre>

        <Heading>Cursor</Heading>
        <p>
          <Code>.cursor/mcp.json</Code> in a project, or{" "}
          <Code>~/.cursor/mcp.json</Code> for every project:
        </p>
        <Pre>{`{
  "mcpServers": {
    "sailo": {
      "url": "${url}",
      "headers": { "Authorization": "Bearer sailo_sk_…" }
    }
  }
}`}</Pre>
        <p>
          Paste the key rather than an environment variable reference unless
          your client resolves them — a client that does not will send the
          literal string and the server will refuse it.
        </p>
      </Section>

      <Section title="What an assistant can and cannot do">
        <p>
          A key is a key. An assistant holding one can do everything that key
          can do, and it will do it without asking you again each time — so mint
          a read-only key unless you specifically want writes.
        </p>

        <Heading>With any key</Heading>
        <p>
          Read the shop&rsquo;s identity, its orders and their line items, its
          catalogue and stock, and the people on its list along with their
          consent state.
        </p>

        <Heading>With a write key</Heading>
        <p>
          Additionally add somebody to the list and change a contact&rsquo;s
          tags. That is the whole of it — {writeToolNames()} and nothing else.
        </p>

        <Heading>Never, with any key</Heading>
        <ul className="mt-2 list-disc space-y-1 ps-5">
          <li>
            <strong>Grant marketing consent.</strong> A contact it creates
            always has <Code>marketingConsentAt: null</Code>. It can ask Sailo
            to send a double opt-in email; consent is written only when the
            person clicks the link.
          </li>
          <li>
            Change an order, mark one paid or shipped, refund anything, or
            cancel anything.
          </li>
          <li>Create, edit, publish or delete a product, or change stock.</li>
          <li>Delete a contact, or read the seller&rsquo;s private notes on one.</li>
          <li>
            See anything internal — no Stripe identifiers, no download tokens,
            no payment proofs.
          </li>
          <li>Touch billing, the account, or another shop. A key names one shop.</li>
        </ul>
        <p>
          A read-only key does not see the write tools at all, rather than being
          refused when it calls one. A model that cannot see a tool does not
          spend a turn discovering it may not use it, and does not promise you
          something it then cannot do.
        </p>
        <p>
          The same limits apply as on the REST API: {MCP_TOOLS.length} tools,
          240 requests a minute per key, and the plan gate checked on every
          call rather than once when the key was minted.
        </p>
      </Section>

      <Section title="The tools">
        <p>
          {MCP_TOOLS.length} tools, generated from what the server actually
          answers <Code>tools/list</Code> with. Argument names here are the MCP
          spelling — <Code>snake_case</Code>, which differs from the REST body
          in a couple of places.
        </p>
        {MCP_TOOLS.map((tool) => (
          <ToolEntry key={tool.name} tool={tool} />
        ))}
      </Section>

      <Section title="Protocol">
        <p>
          The server is stateless and speaks protocol version{" "}
          <Code>{MODERN_VERSION}</Code>, and still answers the{" "}
          <Code>initialize</Code> handshake for older clients — supported
          versions are {SUPPORTED_VERSIONS.join(", ")}. It identifies itself as{" "}
          <Code>{SERVER_INFO.name}</Code> version <Code>{SERVER_INFO.version}</Code>.
        </p>
        <p>
          There are no sessions, no <Code>Mcp-Session-Id</Code> and no GET
          stream. Every request carries its own credential, which is what lets
          the listed tool set vary by the key on the request.
        </p>
        <p>
          A tool that refuses comes back as a result with{" "}
          <Code>isError: true</Code> and a sentence, not as a JSON-RPC error.
          Those are different things to a model: a protocol error says the call
          was malformed and it can do nothing with that, while &ldquo;no contact
          with that id&rdquo; is something it can act on by going and finding
          the right one.
        </p>
      </Section>

      <Section title="Next">
        <p>
          The same operations over plain HTTP are on the{" "}
          <a className="text-brand-600 underline underline-offset-2" href={docsPath("api")}>
            REST reference
          </a>
          , with an{" "}
          <a className="text-brand-600 underline underline-offset-2" href="/api/v1/openapi.json">
            OpenAPI document
          </a>
          . Events pushed to you are on{" "}
          <a className="text-brand-600 underline underline-offset-2" href={docsPath("webhooks")}>
            webhooks
          </a>
          .
        </p>
      </Section>
    </DocsShell>
  );
}

/* -------------------------------------------------------------------------- */

function writeToolNames(): string {
  const names = MCP_TOOLS.filter((tool) => tool.scope === "write").map((tool) => tool.name);
  return names.join(" and ");
}

/**
 * One tool, with every property of its input schema.
 *
 * Read off the schema rather than listed by hand, including the `required`
 * array — a tool gaining an argument gains a row here on the same deploy.
 */
function ToolEntry({ tool }: { tool: McpTool }) {
  const properties = (tool.inputSchema.properties ?? {}) as Record<
    string,
    { type?: string; description?: string; items?: { type?: string }; enum?: unknown[] }
  >;
  const required = new Set((tool.inputSchema.required ?? []) as string[]);
  const names = Object.keys(properties);

  return (
    <div className="mt-8 border-t border-ink-200 pt-6" id={tool.name}>
      <h3 className="font-mono text-sm font-semibold text-ink-900">
        {tool.name}
        {tool.scope === "write" ? (
          <span className="ms-2 rounded bg-ink-100 px-1.5 py-0.5 font-sans text-[0.6875rem] font-medium text-ink-900">
            write
          </span>
        ) : null}
      </h3>

      <p className="mt-2">{tool.description}</p>

      {names.length === 0 ? (
        <p className="mt-2 text-xs italic">Takes no arguments.</p>
      ) : (
        <DefTable
          caption={`Arguments for ${tool.name}`}
          rows={names.map((name) => {
            const property = properties[name];
            return {
              term: name,
              note: [typeName(property), required.has(name) ? "required" : null]
                .filter(Boolean)
                .join(", "),
              /*
               * Several properties carry no description in the schema. Saying
               * so is better than inventing one — and it is the same gap the
               * model sees when it decides how to fill the argument.
               */
              body: property?.description ?? <span className="italic">No description.</span>,
            };
          })}
        />
      )}
    </div>
  );
}

function typeName(property: { type?: string; items?: { type?: string } } | undefined): string {
  if (!property?.type) return "";
  if (property.type === "array") return `${property.items?.type ?? "any"}[]`;
  return property.type;
}
