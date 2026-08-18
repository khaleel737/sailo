import { appOrigin } from "@sailo/core/origin";

/**
 * The table primitives the generated reference sections are built from.
 *
 * Lifted out of the old `docs/_components/docs-kit.tsx` when the four pages
 * became MDX. What stayed behind there — the page shell, the breadcrumb, the
 * tab strip — Fumadocs now provides, and keeping our own copy of a sidebar
 * beside its sidebar is how two navigations end up disagreeing.
 *
 * What is here is only what MDX cannot express: tables whose rows come from
 * `ENDPOINTS`, `MCP_TOOLS` and the wire resources rather than from prose.
 */

/** Inline literal — a header name, a field, a status. */
export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[0.8125rem] text-ink-900">
      {children}
    </code>
  );
}

export function Pre({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl bg-ink-900 px-4 py-3 font-mono text-xs leading-relaxed text-ink-50">
      {children}
    </pre>
  );
}

export function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-6 text-sm font-semibold text-ink-900">{children}</h3>;
}

/** The three-column index — method, path, what it does. */
export function Table({ rows }: { rows: [string, string, string][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="mt-2 w-full min-w-[30rem] text-sm">
        <tbody className="divide-y divide-ink-200">
          {rows.map(([method, path, what]) => (
            <tr key={`${method} ${path}`}>
              <td className="py-2 pe-3 font-mono text-xs font-semibold text-ink-900">{method}</td>
              <td className="py-2 pe-3 font-mono text-xs text-ink-900">{path}</td>
              <td className="py-2 text-xs text-ink-600">{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A two-column reference table — parameters, body fields, tool arguments. */
export function DefTable({
  caption,
  rows,
}: {
  caption?: string;
  rows: { term: string; note: string; body: React.ReactNode }[];
}) {
  if (rows.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="mt-2 w-full min-w-[30rem] text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <tbody className="divide-y divide-ink-200">
          {rows.map((row) => (
            <tr key={row.term}>
              <td className="w-1/4 py-2 pe-3 align-top font-mono text-xs text-ink-900">
                {row.term}
                {row.note ? (
                  <span className="block font-sans text-[0.6875rem] font-normal text-ink-600">
                    {row.note}
                  </span>
                ) : null}
              </td>
              <td className="py-2 align-top text-xs text-ink-600">{row.body}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Where a key comes from.
 *
 * Nothing in these docs can be tried without one, so the path to minting one is
 * written down once — it is a real route that could move, and four hand-typed
 * copies are four chances for three of them to rot.
 */
export const KEY_PATH = "/admin/settings/integrations";

export function KeyLink() {
  return (
    <a className="text-brand-600 underline underline-offset-2" href={KEY_PATH}>
      Settings → Integrations
    </a>
  );
}

/* -------------------------------------------------------------------------- */
/*  The origin, which prose must never hard-code                               */
/* -------------------------------------------------------------------------- */

/*
 * `appOrigin()` is read from the environment on every call, so a preview
 * deployment documents itself rather than production. That is exactly why an
 * MDX page may not type the host out: a fenced code block is a string, and a
 * string cannot know which deployment is serving it. These components exist so
 * every address on these pages comes from the same function the API answers on.
 */

/** The deployment's own origin — `https://sailo.app` in production. */
export function BaseUrl() {
  return <>{appOrigin()}</>;
}

/** The REST base, `…/api/v1`. */
export function ApiBaseUrl() {
  return <>{`${appOrigin()}/api/v1`}</>;
}

/** The MCP endpoint, `…/api/mcp`. */
export function McpUrl() {
  return <>{`${appOrigin()}/api/mcp`}</>;
}

/** A `curl` against one path, with the bearer header every call needs. */
export function CurlExample({ path }: { path: string }) {
  return <Pre>{`curl ${appOrigin()}/api/v1${path} \\\n  -H "Authorization: Bearer sailo_sk_…"`}</Pre>;
}
