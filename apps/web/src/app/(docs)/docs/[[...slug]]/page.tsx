import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import { createRelativeLink } from "fumadocs-ui/mdx";
import { absolute } from "@sailo/core/origin";
import { source } from "@/lib/docs-source";
import { getMDXComponents } from "@/components/docs/mdx-components";

/**
 * Every page under `/docs`, from one catch-all.
 *
 * The four URLs are unchanged from when each was its own `page.tsx` —
 * `/docs`, `/docs/api`, `/docs/webhooks`, `/docs/mcp`. `/docs/api` in
 * particular is linked from outside and already indexed, and the whole point of
 * mounting the docs in this app rather than in a separate one was that nothing
 * a reader has bookmarked had to move.
 */

export default async function Page(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={getMDXComponents({ a: createRelativeLink(source, page) })} />
      </DocsBody>
    </DocsPage>
  );
}

/*
 * Prerendered, all four of them.
 *
 * These pages read no request and no database — every table on them comes from
 * a constant — so there is nothing for a per-request render to discover. It
 * also keeps them cheap for the audience they are written for: a crawler, and
 * somebody evaluating Sailo before they have an account.
 */
export function generateStaticParams() {
  return source.generateParams();
}

/**
 * Title, description and a self-referencing canonical.
 *
 * The canonical is the part worth keeping from the hand-written pages. Four
 * sibling pages covering one subject are exactly the shape a crawler treats as
 * near-duplicates, and the page that gets dropped is chosen by Google rather
 * than by us unless each one names itself.
 */
export async function generateMetadata(props: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const title = `${page.data.title} — Sailo`;
  const description = page.data.description ?? "";
  const url = absolute(page.url);

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "article" },
    twitter: { card: "summary", title, description },
  };
}
