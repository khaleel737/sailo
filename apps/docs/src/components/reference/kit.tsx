import { apiOrigin, appOrigin } from "@sailo/core/origin";
import { cheapestPlanWith } from "@sailo/core/plans";

/**
 * The primitives every generated reference section is built from.
 *
 * Small on purpose. MDX and nextra-theme-docs handle everything a page can
 * *say*; what is here is only what a page cannot say without repeating itself —
 * tables whose rows come from `ENDPOINTS`, `MCP_TOOLS` and the wire resources
 * rather than from prose somebody has to remember to update.
 *
 * Class names rather than utility classes, defined in `app/reference.css`. The
 * theme ships its own compiled stylesheet and this app has no Tailwind build of
 * its own, so a `className="mt-8 border-t"` here would resolve to nothing.
 */

/* -------------------------------------------------------------------------- */
/*  Inline                                                                     */
/* -------------------------------------------------------------------------- */

/** An inline literal — a header name, a field, a status code. */
export function Code({ children }: { children: React.ReactNode }) {
  return <code className="ref-code">{children}</code>;
}

/**
 * A code block a component owns rather than MDX.
 *
 * `children` is typed as `string` deliberately: these blocks print a value off
 * a constant verbatim, and accepting nodes would let a caller interpolate JSX
 * into what is supposed to be exactly the bytes a caller receives.
 */
export function Pre({ children }: { children: string }) {
  return <pre className="ref-pre">{children}</pre>;
}

/** The small caps label above a table inside an entry. */
export function Label({ children }: { children: React.ReactNode }) {
  return <p className="ref-label">{children}</p>;
}

/* -------------------------------------------------------------------------- */
/*  Inline markup inside a generated string                                    */
/* -------------------------------------------------------------------------- */

/**
 * `` `code` ``, `**bold**` and `*italic*` inside a description that came from a
 * constant.
 *
 * WHY THIS IS NEEDED AT ALL
 *
 * Every string this site renders in a table was written in a `.ts` file for a
 * reader — the endpoint descriptions in `@sailo/api/rest`, the tool
 * descriptions the MCP server sends to a model, the field notes in `./fields` —
 * and every one of them was written with Markdown-ish emphasis, because that is
 * how people write prose in a docstring. Rendered as a React text node they
 * come out as literal asterisks and backticks: "`status` and `payment_status`
 * are separate questions" reads with the punctuation showing.
 *
 * Stripping the markers instead would be worse. The backticks in those strings
 * are doing real work — they are what distinguishes the field `status` from the
 * word status — and the MCP tool descriptions in particular must be printed
 * exactly as the server sends them, so editing them here to suit a renderer is
 * not available.
 *
 * DELIBERATELY NOT A MARKDOWN PARSER
 *
 * Three inline forms and no block syntax, no links, no nesting. These strings
 * are one paragraph each and always will be; a real parser here would be a
 * dependency and a second content pipeline to reason about, to render emphasis
 * that MDX already handles everywhere it can reach.
 *
 * The output is `<code>`, `<strong>` and `<em>`, which is what
 * `lib/to-markdown.ts` turns back into backticks and asterisks — so
 * `/llms-full.txt` gets the markers it started with rather than a stripped
 * version.
 */
export function Prose({ children }: { children: string }) {
  return <>{format(children)}</>;
}

/*
 * One pass, alternating between the three delimiters. Ordered longest-first so
 * `**bold**` is matched before `*italic*` would take its first two characters.
 */
const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;

function format(text: string): React.ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    /*
     * The index is a stable key here in a way it usually is not: the array is
     * derived from one string, is never reordered, and is rebuilt whole
     * whenever that string changes.
     */
    const key = `${index}`;

    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code className="ref-code" key={key}>
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

/** `GET`, `POST` — coloured by whether the call is safe to repeat. */
export function Method({ method }: { method: string }) {
  return (
    <span className="ref-method" data-method={method}>
      {method}
    </span>
  );
}

/**
 * The `write` pill on an operation or tool a read-only key cannot reach.
 *
 * The leading space is inside the fragment on purpose — the same reason the
 * table note carries one. `margin-inline-start` separates it visually and does
 * nothing for the text content, so without this a screen reader and
 * `/llms-full.txt` both read "Add and remove tagswrite".
 */
export function ScopePill({ scope }: { scope: string }) {
  if (scope !== "write") return null;
  return (
    <>
      {" "}
      <span className="ref-scope">write</span>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tables                                                                     */
/* -------------------------------------------------------------------------- */

export type DefRow = {
  term: string;
  /** The second line under the term — a type, `required`, an HTTP status. */
  note?: string;
  body: React.ReactNode;
};

/**
 * The two-column reference table: parameters, body fields, tool arguments,
 * resource fields, failure modes.
 *
 * A `<caption>`, always, and visually hidden. A screen reader landing on a page
 * with six of these otherwise hears six identical tables — the heading above
 * one is not part of it, so there is nothing to say which is which.
 */
export function DefTable({
  caption,
  headers,
  rows,
}: {
  caption: string;
  /** Column headings. Omitted where the two columns are self-evident. */
  headers?: [string, string];
  rows: readonly DefRow[];
}) {
  if (rows.length === 0) return null;

  return (
    <div className="ref-scroll">
      <table className="ref-table">
        <caption className="sr-only">{caption}</caption>
        {headers ? (
          <thead>
            <tr>
              <th scope="col" className="ref-table-term">
                {headers[0]}
              </th>
              <th scope="col">{headers[1]}</th>
            </tr>
          </thead>
        ) : null}
        <tbody>
          {rows.map((row) => (
            <tr key={row.term}>
              <td className="ref-table-term">
                {row.term}
                {/*
                  A space between the term and its note, and it is load-bearing
                  rather than tidiness. The note is `display: block`, so the two
                  look like separate lines — but the text content is contiguous,
                  and a screen reader announces "statusquery · string" as one
                  word. `/llms-full.txt` had the same problem for the same
                  reason, which is how it was noticed.
                */}
                {row.note ? <> <span className="ref-table-note">{row.note}</span></> : null}
              </td>
              <td className="ref-table-body">{row.body}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  The origin, which prose must never hard-code                               */
/* -------------------------------------------------------------------------- */

/*
 * THREE ORIGINS, AND NOT ONE OF THEM IS THIS SITE
 *
 * `apiOrigin()` — api.sailo.store — is where `/api/v1` and `/api/mcp` answer,
 * and it is what every address a reader copies must say. Both it and the web
 * origin serve those routes today, from one handler in `@sailo/api`; the web
 * copies exist so no published URL 404s before its holders have moved, and
 * `docs/api-cutover.md` says what has to happen before they go. Publishing the
 * host that survives that deletion is the whole point: a reader who copies
 * `sailo.store/api/v1` today is somebody who has to be migrated later, for no
 * reason, because they arrived after the destination already worked.
 *
 * `appOrigin()` — sailo.store — is the product. Only two things below use it,
 * and both are pages a person opens in a browser rather than addresses a
 * program calls: the link that mints a key, and the pricing page in the navbar.
 *
 * `docsOrigin()` — docs.sailo.store — is this site, and appears nowhere on a
 * page. It is for canonicals and the sitemap; see `lib/origins.ts`.
 *
 * All three read the environment on every call, which is why every *one-line*
 * example comes through a component rather than being typed into MDX. A fenced
 * code block is a string and a string cannot know which environment is serving
 * it, so `curl https://…` in prose is a claim about the host that nothing can
 * keep true.
 *
 * The exception is a multi-line example in a real language — the paging loop,
 * the retry helper. Those go in fenced blocks so Shiki highlights them and the
 * copy button works, and they name the origin once as a named constant at the
 * top, which is what an integration would do with it anyway. One obvious line
 * to change beats an unhighlighted wall of monospace.
 */

/** The API origin — `https://api.sailo.store` in production. */
export function BaseUrl() {
  return <>{apiOrigin()}</>;
}

/** The REST base, `…/api/v1`. */
export function ApiBaseUrl() {
  return <>{`${apiOrigin()}/api/v1`}</>;
}

/** The MCP endpoint, `…/api/mcp`. */
export function McpUrl() {
  return <>{`${apiOrigin()}/api/mcp`}</>;
}

/** The OpenAPI document, absolute, for prose that sends a reader to it. */
export function OpenApiUrl() {
  return <>{`${apiOrigin()}/api/v1/openapi.json`}</>;
}

/**
 * A `curl` against one path beneath `/api/v1`, with the header every call needs.
 *
 * The URL is quoted whenever the path carries a query string. Unquoted, a shell
 * treats `&` as "run this in the background" and `?` as a glob — so
 * `curl …/orders?limit=50&status=paid` in a reader's terminal fetches
 * `/orders?limit=50`, detaches, and then reports `status: command not found`.
 * It is the single most common way a copied example fails for a reason that has
 * nothing to do with the API.
 */
export function CurlExample({ path }: { path: string }) {
  const url = `${apiOrigin()}/api/v1${path}`;
  const target = path.includes("?") ? `"${url}"` : url;
  return <Pre>{`curl ${target} \\\n  -H "Authorization: Bearer sailo_sk_…"`}</Pre>;
}

/* -------------------------------------------------------------------------- */
/*  Where a key comes from                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Nothing in these docs can be tried without a key, so the path to minting one
 * is written down once. It is a real route in another app that could move, and
 * a dozen hand-typed copies are a dozen chances for eleven of them to rot.
 */
export const KEY_PATH = "/admin/settings/integrations";

export function keyUrl(): string {
  return `${appOrigin()}${KEY_PATH}`;
}

export function KeyLink() {
  return (
    <a href={keyUrl()} rel="noreferrer">
      Settings → Integrations
    </a>
  );
}

/**
 * The plan the API is on, named from the plan table rather than typed out.
 *
 * `authenticateApi` refuses a key on a shop without the `integrations` feature
 * and puts this same plan's name in the refusal, so a page naming a different
 * one would contradict the error a reader is looking at. It moved once already
 * — several features came *down* from Business as the tiers were rebalanced —
 * and this is the sentence that would have been left behind.
 */
export function ApiPlanName() {
  return <>{cheapestPlanWith("integrations")?.name ?? "a paid plan"}</>;
}
