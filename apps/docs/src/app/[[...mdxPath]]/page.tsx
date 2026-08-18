import type { Metadata } from "next";
import { generateStaticParamsFor, importPage } from "nextra/pages";
import { useMDXComponents } from "@/mdx-components";
import { docsUrl } from "@/lib/origins";

/**
 * Every page on this site, from one catch-all.
 *
 * Nextra compiles `content/**` at build time and `importPage` resolves a URL
 * segment list to the compiled module. There is no per-page `page.tsx`, which
 * is the point: adding documentation is adding one `.mdx` file, and there is no
 * second file to forget.
 */

type Props = { params: Promise<{ mdxPath?: string[] }> };

/*
 * Prerendered, all of them.
 *
 * These pages read no request and no database — every table on them comes from
 * a constant compiled into the bundle — so there is nothing a per-request
 * render could discover. It also keeps them cheap for the audience they are
 * written for: a crawler, and somebody evaluating Sailo before they have an
 * account.
 */
export const generateStaticParams = generateStaticParamsFor("mdxPath");

export default async function Page(props: Props) {
  const params = await props.params;
  const { default: MDXContent, toc, metadata, sourceCode } = await importPage(params.mdxPath);
  const components = useMDXComponents();
  const Wrapper = components.wrapper;

  if (!Wrapper) {
    /*
     * The theme supplies the wrapper — the article shell, the table of
     * contents, the previous/next links. Rendering without it would produce a
     * page that looks broken rather than one that fails, so this says which
     * piece is missing instead.
     */
    throw new Error("nextra-theme-docs did not supply an MDX wrapper.");
  }

  return (
    <Wrapper toc={toc} metadata={metadata} sourceCode={sourceCode}>
      <MDXContent {...props} params={params} />
    </Wrapper>
  );
}

/**
 * Title, description and a self-referencing canonical.
 *
 * The canonical is the part worth being deliberate about. Thirty-odd sibling
 * pages covering one API is exactly the shape a crawler treats as
 * near-duplicates — four of them say "every key is read-only unless you tick
 * write" because a reader arriving at any one of them needs to know it — and
 * which page gets dropped is Google's decision unless each one names itself.
 */
export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const { metadata } = await importPage(params.mdxPath);
  const path = `/${(params.mdxPath ?? []).join("/")}`;

  return {
    ...metadata,
    alternates: { canonical: docsUrl(path) },
  };
}
