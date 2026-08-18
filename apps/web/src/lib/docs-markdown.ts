import { appOrigin } from "@sailo/core/origin";
import { API_ERROR_CODES, API_VERSION, DEFAULT_LIMIT, ENDPOINTS, MAX_BODY_KB, MAX_LIMIT } from "@sailo/api/rest";
import { MCP_TOOLS, MODERN_VERSION, SERVER_INFO, SUPPORTED_VERSIONS } from "@sailo/api/mcp";
import { WEBHOOK_EVENTS } from "@sailo/webhooks/events";
import { DISPUTE_FIELDS, SUBSCRIPTION_FIELDS, type PayloadField } from "@/components/docs/payload-fields";
import { KEY_PATH } from "@/components/docs/kit";

/**
 * The generated reference, as Markdown, for `/llms-full.txt`.
 *
 * WHY THIS EXISTS AT ALL
 *
 * The docs pages are MDX that imports React components for everything
 * enumerable — the endpoint table, the tool table, the payload fields — because
 * that is what stops prose drifting from the API it describes. `llms-full.txt`
 * serves the *processed Markdown*, which is the MDX after its plugins have run
 * and before React ever does, so those components are still unevaluated tags in
 * it. The first version of that route shipped a file whose "REST API" section
 * read, in full, `<EndpointIndex />`.
 *
 * That is worse than not shipping one. A model handed a page of component names
 * has been told there is documentation and given none of it, and it has no way
 * to know the difference.
 *
 * So the same constants are rendered a second way here. Not a conversion of the
 * HTML — a rendering of the source, which is what the components are too. There
 * is no version of this that can disagree with the page, because neither of
 * them is the original.
 */

/* -------------------------------------------------------------------------- */
/*  Scalars                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Components that stand in for a single value in the middle of a sentence.
 *
 * Keyed by tag name. A tag the map does not know is left alone rather than
 * deleted — a stray `<Foo />` in the output is visible and reports itself,
 * where a silent removal turns "up to 100 per page" into "up to per page".
 */
const SCALARS: Record<string, () => string> = {
  ApiVersion: () => API_VERSION,
  DefaultLimit: () => String(DEFAULT_LIMIT),
  MaxLimit: () => String(MAX_LIMIT),
  MaxBodyKb: () => String(MAX_BODY_KB),
  EndpointCount: () => String(ENDPOINTS.length),
  ToolCount: () => String(MCP_TOOLS.length),
  EventCount: () => String(WEBHOOK_EVENTS.length),
  SubscriptionEventCount: () =>
    String(WEBHOOK_EVENTS.filter((event) => event.startsWith("subscription.")).length),
  WriteToolNames: () =>
    MCP_TOOLS.filter((tool) => tool.scope === "write")
      .map((tool) => tool.name)
      .join(" and "),
  BaseUrl: () => appOrigin(),
  ApiBaseUrl: () => `${appOrigin()}/api/v1`,
  McpUrl: () => `${appOrigin()}/api/mcp`,
  ModernVersion: () => MODERN_VERSION,
  SupportedVersions: () => SUPPORTED_VERSIONS.join(", "),
  ServerName: () => SERVER_INFO.name,
  ServerVersion: () => SERVER_INFO.version,
  KeyLink: () => `[Settings → Integrations](${KEY_PATH})`,
};

/* -------------------------------------------------------------------------- */
/*  Blocks                                                                     */
/* -------------------------------------------------------------------------- */

const fence = (lang: string, body: string) => `\`\`\`${lang}\n${body}\n\`\`\``;

/* A pipe ends a cell, and every nullable type here spells one — `string | null`
   would silently become two columns. Newlines end a row for the same reason. */
const cell = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", " ");

/** A Markdown table. */
function table(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n");
}

const fieldTable = (fields: readonly PayloadField[]) =>
  table(["Field", "Type", "Meaning"], fields.map((f) => [`\`${f.name}\``, `\`${f.type}\``, f.body]));

function endpointIndex(): string {
  return table(
    ["Method", "Path", "What it does"],
    ENDPOINTS.map((e) => [
      e.method,
      `\`${e.path}\``,
      e.scope === "write" ? `${e.summary} (write)` : e.summary,
    ]),
  );
}

function endpointReference(): string {
  const base = appOrigin();

  return ENDPOINTS.map((endpoint) => {
    const parts = [
      `### ${endpoint.method} ${endpoint.path}${endpoint.scope === "write" ? " (write)" : ""}`,
      endpoint.description,
    ];

    if (endpoint.params.length > 0) {
      parts.push(
        "**Parameters**",
        table(
          ["Name", "In", "Description"],
          endpoint.params.map((p) => [
            `\`${p.name}\``,
            `${p.in}${p.required ? ", required" : ""}`,
            p.description,
          ]),
        ),
      );
    }

    if (endpoint.body) {
      parts.push(
        "**Body**",
        table(
          ["Field", "Required", "Description"],
          endpoint.body.fields.map((f) => [`\`${f.name}\``, f.required ? "yes" : "no", f.description]),
        ),
        fence("json", endpoint.body.example),
      );
    }

    parts.push(
      "**Example**",
      fence("bash", endpoint.curl(base)),
      endpoint.result.shape === "page" ? "**200 — a page**" : "**200**",
      fence("json", endpoint.successExample),
    );

    for (const extra of endpoint.resultExtra ?? []) {
      parts.push(`\`${extra.name}\` — ${extra.description}`);
    }

    parts.push(
      "**Failures**",
      table(
        ["Code", "Status", "When"],
        dedupeErrors(endpoint).map((e) => [`\`${e.code}\``, String(API_ERROR_CODES[e.code]), e.when]),
      ),
    );

    return parts.join("\n\n");
  }).join("\n\n");
}

function dedupeErrors(endpoint: (typeof ENDPOINTS)[number]) {
  const merged = new Map<keyof typeof API_ERROR_CODES, string[]>();
  for (const error of endpoint.errors) {
    const reasons = merged.get(error.code) ?? [];
    if (!reasons.includes(error.when)) reasons.push(error.when);
    merged.set(error.code, reasons);
  }
  return [...merged.entries()].map(([code, reasons]) => ({ code, when: reasons.join(" ") }));
}

const ERROR_MEANINGS: Record<keyof typeof API_ERROR_CODES, string> = {
  unauthorized: "No credential, or one we do not recognise.",
  forbidden: "A real key, but not one allowed to do this — the scope, or the shop's plan.",
  not_found: "No such object in this shop. Never distinguishes 'not yours' from 'not there'.",
  invalid_request: "Malformed input — a bad cursor, an unparseable body, a missing field.",
  rate_limited: "Too many calls. Slow down and retry.",
  server_error: "Our fault. Retry; the body says nothing about the cause.",
};

function toolReference(): string {
  return MCP_TOOLS.map((tool) => {
    const properties = (tool.inputSchema.properties ?? {}) as Record<
      string,
      { type?: string; description?: string; items?: { type?: string } }
    >;
    const required = new Set((tool.inputSchema.required ?? []) as string[]);
    const names = Object.keys(properties);

    const head = `### ${tool.name}${tool.scope === "write" ? " (write)" : ""}\n\n${tool.description}`;
    if (names.length === 0) return `${head}\n\nTakes no arguments.`;

    return `${head}\n\n${table(
      ["Argument", "Type", "Description"],
      names.map((name) => {
        const property = properties[name];
        const type = !property?.type
          ? ""
          : property.type === "array"
            ? `${property.items?.type ?? "any"}[]`
            : property.type;
        return [
          `\`${name}\``,
          [type, required.has(name) ? "required" : null].filter(Boolean).join(", "),
          property?.description ?? "No description.",
        ];
      }),
    )}`;
  }).join("\n\n");
}

const BLOCKS: Record<string, () => string> = {
  EndpointIndex: endpointIndex,
  EndpointReference: endpointReference,
  ErrorCodeTable: () =>
    table(
      ["Code", "Status", "Meaning"],
      Object.entries(API_ERROR_CODES).map(([code, status]) => [
        `\`${code}\``,
        String(status),
        ERROR_MEANINGS[code as keyof typeof API_ERROR_CODES],
      ]),
    ),
  ToolReference: toolReference,
  EventList: () => WEBHOOK_EVENTS.map((event) => `- \`${event}\``).join("\n"),
  SubscriptionFields: () => fieldTable(SUBSCRIPTION_FIELDS),
  DisputeFields: () => fieldTable(DISPUTE_FIELDS),
  ClaudeCodeSnippet: () =>
    fence(
      "bash",
      `claude mcp add --transport http sailo ${appOrigin()}/api/mcp \\\n  --header "Authorization: Bearer sailo_sk_…"`,
    ),
  McpJsonSnippet: () =>
    fence(
      "json",
      `{\n  "mcpServers": {\n    "sailo": {\n      "type": "http",\n      "url": "${appOrigin()}/api/mcp",\n      "headers": { "Authorization": "Bearer sailo_sk_…" }\n    }\n  }\n}`,
    ),
  McpRemoteSnippet: () =>
    fence(
      "json",
      `{\n  "mcpServers": {\n    "sailo": {\n      "command": "npx",\n      "args": [\n        "-y", "mcp-remote", "${appOrigin()}/api/mcp",\n        "--header", "Authorization: Bearer sailo_sk_…"\n      ]\n    }\n  }\n}`,
    ),
  CursorSnippet: () =>
    fence(
      "json",
      `{\n  "mcpServers": {\n    "sailo": {\n      "url": "${appOrigin()}/api/mcp",\n      "headers": { "Authorization": "Bearer sailo_sk_…" }\n    }\n  }\n}`,
    ),
};

/* -------------------------------------------------------------------------- */
/*  Expansion                                                                  */
/* -------------------------------------------------------------------------- */

/** `<CurlExample path="/shop" />`, the one tag that takes an argument. */
const CURL = /<CurlExample\s+path="([^"]+)"\s*\/>/g;

/** A self-closing tag with no attributes — `<EndpointIndex />`. */
const BARE_TAG = /<([A-Z][A-Za-z0-9]*)\s*\/>/g;

/*
 * The one component with children rather than attributes: the card grid on the
 * index page. A grid is a layout, and layout is the part of a page a model has
 * no use for — what it wants is the three links and what is behind each, which
 * is a list.
 */
const CARDS_BLOCK = /<Cards>([\s\S]*?)<\/Cards>/g;
const CARD = /<Card\s+href="([^"]+)"\s+title="([^"]+)"\s*>([\s\S]*?)<\/Card>/g;

function cardsToList(inner: string): string {
  const items: string[] = [];
  for (const [, href, title, body] of inner.matchAll(CARD)) {
    items.push(`- [${title}](${href}) — ${(body ?? "").trim().replace(/\s+/g, " ")}`);
  }
  return items.join("\n");
}

/**
 * The MDX a page compiled from, with its component tags rendered.
 *
 * Also strips the `import` lines, which name modules nobody outside this repo
 * can resolve, and the `[#anchor]` suffix `remark-heading` appends — a heading
 * ending in `[#the-endpoints]` reads as broken Markdown to anything that is not
 * Fumadocs.
 */
export function expandDocsMarkdown(markdown: string): string {
  return markdown
    .replace(/^import\s+[\s\S]*?from\s+"[^"]+";\s*$/gm, "")
    .replace(CARDS_BLOCK, (_match, inner: string) => cardsToList(inner))
    .replace(/^(#{1,6} .*?)\s*\[#[\w-]+\]\s*$/gm, "$1")
    .replace(CURL, (_match, path: string) =>
      fence("bash", `curl ${appOrigin()}/api/v1${path} \\\n  -H "Authorization: Bearer sailo_sk_…"`),
    )
    .replace(BARE_TAG, (match, name: string) => {
      const scalar = SCALARS[name];
      if (scalar) return scalar();
      const block = BLOCKS[name];
      if (block) return `\n\n${block()}\n\n`;
      return match;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Every component tag the MDX pages use, so a test can assert this module knows
 * all of them. A tag added to a page and not here ships a model a tag name.
 */
export const KNOWN_TAGS = new Set([...Object.keys(SCALARS), ...Object.keys(BLOCKS), "CurlExample"]);
