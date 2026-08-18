import { isValidElement, type ReactElement, type ReactNode } from "react";

/**
 * A reference component, rendered as Markdown.
 *
 * WHY THIS EXISTS RATHER THAN `renderToStaticMarkup`
 *
 * Two reasons, and the second is the better one.
 *
 * Next refuses to bundle `react-dom/server` into a Route Handler at all — the
 * build fails with "you're importing a component that imports
 * react-dom/server" — so `/llms-full.txt` could not have been built that way
 * even if it wanted to be.
 *
 * And it should not want to be. That route exists so a model can read this
 * site in one fetch, and a `<table>` full of `<td>` is a worse thing to hand a
 * model than a pipe table. Markdown is the format the convention asks for, so
 * emitting HTML and calling it Markdown would have been the shortcut rather
 * than the answer.
 *
 * WHAT THIS IS NOT
 *
 * It is not a general HTML-to-Markdown converter, and it must not grow into
 * one. It walks the element trees that `components/reference/*` actually
 * produce — tables, code blocks, headings, paragraphs, lists, and a handful of
 * inline tags — and renders an unknown tag as its own children rather than
 * pretending to handle it. A component that starts emitting something exotic
 * will read a little flat here, which is the correct failure: visible, and not
 * wrong.
 *
 * The point of doing it this way at all is that there is **one** description of
 * the API. The obvious alternative — a hand-written Markdown twin of every
 * component — is a second one, and the twin that somebody forgets to write is
 * invisible until a model reads the file and finds a gap nobody knew was there.
 */

/* -------------------------------------------------------------------------- */
/*  Walking                                                                    */
/* -------------------------------------------------------------------------- */

type Props = { children?: ReactNode } & Record<string, unknown>;

function childrenOf(node: ReactNode): ReactNode[] {
  if (!isValidElement(node)) return [];
  const props = node.props as Props;
  return toArray(props.children);
}

function toArray(node: ReactNode): ReactNode[] {
  if (node === null || node === undefined || node === false || node === true) return [];
  return Array.isArray(node) ? node.flatMap(toArray) : [node];
}

/**
 * The tag name, or null for anything that is not an intrinsic element.
 *
 * A component (a function type) is *called* rather than named — these are plain
 * server functions with no hooks and no state, which is what makes rendering
 * them outside React possible at all. If one ever grows a hook this returns
 * garbage rather than throwing, so the rule is worth stating: components under
 * `components/reference/` are pure functions of their props.
 */
function tagOf(node: ReactNode): string | null {
  if (!isValidElement(node)) return null;
  return typeof node.type === "string" ? node.type : null;
}

function expand(node: ReactNode): ReactNode {
  if (!isValidElement(node)) return node;
  if (typeof node.type === "function") {
    const Component = node.type as (props: Props) => ReactNode;
    return expand(Component(node.props as Props));
  }
  return node;
}

/* -------------------------------------------------------------------------- */
/*  Inline                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A subtree as one line of inline Markdown, **without collapsing whitespace**.
 *
 * The distinction from `inlineText` below is not cosmetic. Several components
 * put a deliberate space between two nested elements — the table note, the
 * `write` pill — precisely so the text reads "status query · string" rather
 * than "statusquery". Trimming at every level of the recursion ate exactly
 * those spaces, because a nested fragment's own output began with one.
 *
 * So the recursion preserves whitespace and only the entry point collapses it.
 */
function inlineParts(node: ReactNode): string {
  const parts = toArray(node).map((child) => {
    const resolved = expand(child);

    if (typeof resolved === "string") return resolved;
    if (typeof resolved === "number") return String(resolved);
    if (!isValidElement(resolved)) return "";

    const inner = inlineParts(childrenOf(resolved));

    switch (tagOf(resolved)) {
      case "code":
        /* Already-fenced content would nest; these are always short literals. */
        return `\`${inner.trim()}\``;
      case "em":
      case "i":
        return inner.trim() ? `*${inner.trim()}*` : "";
      case "strong":
      case "b":
        return inner.trim() ? `**${inner.trim()}**` : "";
      case "a": {
        const href = (resolved.props as Props).href;
        return typeof href === "string" ? `[${inner.trim()}](${href})` : inner;
      }
      case "br":
        return " ";
      default:
        return inner;
    }
  });

  return parts.join("");
}

/** A subtree as one line of inline Markdown, whitespace collapsed. */
export function inlineText(node: ReactNode): string {
  return inlineParts(node).replace(/\s+/g, " ").trim();
}

/* -------------------------------------------------------------------------- */
/*  Tables                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A pipe ends a cell and a newline ends a row, so both have to go. Every
 * nullable type in the field tables spells `string | null`, which would
 * otherwise silently become two columns.
 */
function cell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

/** Every `<tr>` beneath a node, in document order, with its cells. */
function rowsIn(node: ReactNode): { head: boolean; cells: string[] }[] {
  const rows: { head: boolean; cells: string[] }[] = [];

  const visit = (current: ReactNode, inHead: boolean): void => {
    for (const child of toArray(current)) {
      const resolved = expand(child);
      if (!isValidElement(resolved)) continue;

      const tag = tagOf(resolved);
      if (tag === "caption") continue; // Screen-reader text; the heading says it already.
      if (tag === "thead") {
        visit(childrenOf(resolved), true);
        continue;
      }
      if (tag === "tr") {
        const cells = toArray(childrenOf(resolved))
          .map(expand)
          .filter((candidate): candidate is ReactElement => isValidElement(candidate))
          .map((candidate) => cell(inlineText(childrenOf(candidate))));
        if (cells.length > 0) rows.push({ head: inHead, cells });
        continue;
      }
      visit(childrenOf(resolved), inHead);
    }
  };

  visit(childrenOf(node), false);
  return rows;
}

function table(node: ReactNode): string {
  const rows = rowsIn(node);
  if (rows.length === 0) return "";

  const width = Math.max(...rows.map((row) => row.cells.length));
  const pad = (cells: string[]) => [...cells, ...Array(width - cells.length).fill("")];

  const explicitHead = rows.find((row) => row.head);
  const body = rows.filter((row) => row !== explicitHead);

  /*
   * A table with no `<thead>` still needs a header row, because Markdown has no
   * syntax for a headerless table — every renderer treats the first row as one
   * regardless. Blank cells are the honest filler: inventing column names would
   * be this file asserting something the component never said.
   */
  const head = explicitHead ? pad(explicitHead.cells) : Array(width).fill("");

  return [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${pad(row.cells).join(" | ")} |`),
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/*  Blocks                                                                     */
/* -------------------------------------------------------------------------- */

function blocks(node: ReactNode): string[] {
  return toArray(node).flatMap((child) => {
    const resolved = expand(child);

    if (typeof resolved === "string" || typeof resolved === "number") {
      const text = String(resolved).trim();
      return text ? [text] : [];
    }
    if (!isValidElement(resolved)) return [];

    const tag = tagOf(resolved);

    switch (tag) {
      case "table":
        return [table(resolved)];

      case "pre":
        /*
         * No language tag. These blocks hold `curl` lines and JSON bodies and
         * the component does not say which, so guessing would put `json` on a
         * shell command a fifth of the time.
         */
        return [`\`\`\`\n${inlineTextPreserving(childrenOf(resolved))}\n\`\`\``];

      case "h1":
      case "h2":
      case "h3":
      case "h4": {
        /*
         * One level deeper than the tag, because every one of these is nested
         * inside a page whose own `##` sections are in the MDX around it.
         */
        const depth = Number(tag.slice(1)) + 1;
        return [`${"#".repeat(Math.min(depth, 6))} ${inlineText(childrenOf(resolved))}`];
      }

      case "ul":
      case "ol": {
        const items = toArray(childrenOf(resolved))
          .map(expand)
          .filter((item): item is ReactElement => isValidElement(item))
          .map((item, index) =>
            tag === "ol"
              ? `${index + 1}. ${inlineText(childrenOf(item))}`
              : `- ${inlineText(childrenOf(item))}`,
          );
        return items.length > 0 ? [items.join("\n")] : [];
      }

      case "p": {
        const text = inlineText(childrenOf(resolved));
        return text ? [text] : [];
      }

      default:
        /*
         * Structural or unknown — `section`, `div`, `span`, a fragment. Descend
         * rather than drop: the content is in the children, and a tag this file
         * has not met is far more likely to be a wrapper than a leaf.
         */
        return blocks(childrenOf(resolved));
    }
  });
}

/** Inside a `<pre>`, whitespace is the content. */
function inlineTextPreserving(node: ReactNode): string {
  return toArray(node)
    .map((child) => {
      const resolved = expand(child);
      if (typeof resolved === "string" || typeof resolved === "number") return String(resolved);
      if (!isValidElement(resolved)) return "";
      return inlineTextPreserving(childrenOf(resolved));
    })
    .join("");
}

/* -------------------------------------------------------------------------- */

export type Rendered = {
  text: string;
  /**
   * Whether this belongs in the middle of a sentence.
   *
   * The reference modules export two quite different kinds of component and MDX
   * uses both the same way. `<ErrorCodeTable />` is a block and needs blank
   * lines around it or no parser will see a table; `<MaxLimit />` renders the
   * single character `100` in the middle of "up to <MaxLimit /> per page", and
   * putting blank lines around *that* would split one sentence into three
   * paragraphs.
   *
   * Decided by what came out rather than declared per component, so a component
   * added later needs no annotation: one line with no table pipe, list bullet
   * or fence in it is a scalar.
   */
  inline: boolean;
};

/** A component's rendered output, as Markdown. */
export function elementToMarkdown(node: ReactNode): Rendered {
  const rendered = blocks(node)
    .map((block) => block.trim())
    .filter(Boolean);

  const [only] = rendered;
  if (only === undefined) return { text: "", inline: true };

  /*
   * Re-rendered through the inline path rather than reusing the block output,
   * because `blocks` descends into an `<a>` and keeps only its text — which is
   * right inside a table cell and wrong for `<KeyLink />`, whose entire purpose
   * is the href.
   */
  if (rendered.length === 1 && !only.includes("\n")) {
    return { text: inlineText(node), inline: true };
  }

  return { text: rendered.join("\n\n"), inline: false };
}
