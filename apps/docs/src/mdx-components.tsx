import { useMDXComponents as themeComponents } from "nextra-theme-docs";
import type { MDXComponents } from "nextra/mdx-components";
import * as endpoints from "@/components/reference/endpoints";
import * as kit from "@/components/reference/kit";
import * as mcp from "@/components/reference/mcp";
import * as objects from "@/components/reference/objects";
import * as webhooks from "@/components/reference/webhooks";

/**
 * What a `.mdx` file may use without importing it.
 *
 * Nextra looks for this module by convention — `src/mdx-components` or
 * `mdx-components` at the app root — and merges what it returns into every
 * compiled page.
 *
 * **Every generated component is in scope here on purpose.** The alternative is
 * an import block at the top of each of the thirty-odd content files, and that
 * block is where a page silently falls behind: somebody adds a table to the
 * reference, the three pages that should show it do not import it, and nothing
 * fails. A component in scope everywhere is one a page can start using in the
 * same edit that decides it should.
 */
export function useMDXComponents(components?: Readonly<MDXComponents>): MDXComponents {
  return {
    ...themeComponents(),
    ...componentsIn(kit),
    ...componentsIn(endpoints),
    ...componentsIn(mcp),
    ...componentsIn(objects),
    ...componentsIn(webhooks),
    ...components,
  };
}

/**
 * The components a module exports, and nothing else.
 *
 * The reference modules also export data and helpers — `SECTIONS`,
 * `endpointsIn`, `KEY_PATH` — that the pages themselves have no use for. This
 * takes only capitalised functions, which is exactly MDX's own rule for what
 * counts as a component: a lowercase name resolves to an HTML tag, so putting
 * `keyUrl` in this map could only ever shadow one.
 *
 * Derived rather than listed, so adding a component to a reference module makes
 * it available to every page without a second edit here — which is the whole
 * point of the map existing.
 */
function componentsIn(module: Record<string, unknown>): MDXComponents {
  return Object.fromEntries(
    Object.entries(module).filter(
      ([name, value]) => typeof value === "function" && /^[A-Z]/.test(name),
    ),
  ) as MDXComponents;
}
