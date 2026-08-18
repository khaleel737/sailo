import defaultComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { Callout } from "fumadocs-ui/components/callout";
import { Card, Cards } from "fumadocs-ui/components/card";

/**
 * What MDX can reach without importing it.
 *
 * Deliberately small. The generated reference components — the endpoint table,
 * the tool table, the payload field tables — are imported by name in the pages
 * that use them rather than being made globally available, so reading the top
 * of a `.mdx` file tells you which parts of it are generated from source and
 * which are prose somebody wrote.
 */
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultComponents,
    Callout,
    Card,
    Cards,
    ...components,
  };
}
