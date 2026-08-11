"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  Bold,
  Heading2,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  Minus,
  Quote,
  Sparkles,
} from "lucide-react";
import { renderBody, readingSeconds, MERGE_TAGS } from "@/lib/broadcasts/markdown";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { interpolate } from "@/i18n";
import { Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Writing the message.
 *
 * The v1 composer was a bare textarea whose help text explained Markdown in
 * one line and then left the seller to it — which is fine for somebody who
 * already writes Markdown and a wall for everybody else. What actually
 * happened is that people wrote plain paragraphs, never used a heading or a
 * link, and had no idea what the email would look like until they sent
 * themselves a test.
 *
 * So: buttons that write the syntax, and a preview that renders through the
 * *same* function the sender uses. The preview is not an approximation —
 * `renderBody` is the identical module, so what is on screen is the HTML that
 * will be in the inbox, minus the shop's own frame around it.
 */

/** The toolbar's edits, each described as what it wraps or prefixes. */
type Edit =
  | { kind: "wrap"; before: string; after: string; placeholder: string }
  | { kind: "line"; prefix: string; placeholder: string }
  | { kind: "insert"; text: string };

function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="focus-ring flex size-8 items-center justify-center rounded-lg text-ink-500 transition hover:bg-ink-100 hover:text-ink-900"
    >
      {children}
    </button>
  );
}

export function MarkdownEditor({
  value,
  onChange,
  disabled,
  maxLength,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  maxLength: number;
}) {
  const a = useAdminT();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [tagsOpen, setTagsOpen] = useState(false);

  /**
   * Applies an edit at the cursor and puts the cursor back where a person
   * would expect it.
   *
   * The selection restore is the part that matters: without it every button
   * press drops the caret at the end of the message, so a seller styling a
   * word in the second paragraph has to find their place again — which is
   * enough friction that they stop using the buttons.
   */
  function apply(edit: Edit) {
    const el = ref.current;
    if (!el || disabled) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end);

    let next = value;
    let caret = end;

    if (edit.kind === "wrap") {
      const inner = selected || edit.placeholder;
      next = `${value.slice(0, start)}${edit.before}${inner}${edit.after}${value.slice(end)}`;
      caret = selected
        ? start + edit.before.length + inner.length + edit.after.length
        : start + edit.before.length + inner.length;
    } else if (edit.kind === "line") {
      // From the start of the line the cursor is on, so a prefix lands where
      // Markdown needs it rather than mid-sentence.
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const inner = selected || edit.placeholder;
      next = `${value.slice(0, lineStart)}${edit.prefix}${value.slice(lineStart, start)}${inner}${value.slice(end)}`;
      caret = start + edit.prefix.length + inner.length;
    } else {
      next = `${value.slice(0, start)}${edit.text}${value.slice(end)}`;
      caret = start + edit.text.length;
    }

    onChange(next.slice(0, maxLength));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  const seconds = readingSeconds(value);

  return (
    <div className="rounded-xl border border-ink-200 bg-white">
      <div className="flex flex-wrap items-center gap-1 border-b border-ink-100 px-2 py-1.5">
        <ToolButton
          label={a.broadcasts.toolbarBold}
          onClick={() => apply({ kind: "wrap", before: "**", after: "**", placeholder: "bold" })}
        >
          <Bold className="size-4" />
        </ToolButton>
        <ToolButton
          label={a.broadcasts.toolbarItalic}
          onClick={() => apply({ kind: "wrap", before: "*", after: "*", placeholder: "italic" })}
        >
          <Italic className="size-4" />
        </ToolButton>
        <ToolButton
          label={a.broadcasts.toolbarHeading}
          onClick={() => apply({ kind: "line", prefix: "## ", placeholder: "Heading" })}
        >
          <Heading2 className="size-4" />
        </ToolButton>
        <ToolButton
          label={a.broadcasts.toolbarLink}
          onClick={() =>
            apply({ kind: "wrap", before: "[", after: "](https://)", placeholder: "link text" })
          }
        >
          <Link2 className="size-4" />
        </ToolButton>
        <ToolButton
          label={a.broadcasts.toolbarList}
          onClick={() => apply({ kind: "line", prefix: "- ", placeholder: "item" })}
        >
          <List className="size-4" />
        </ToolButton>
        <ToolButton
          label={a.broadcasts.toolbarQuote}
          onClick={() => apply({ kind: "line", prefix: "> ", placeholder: "quote" })}
        >
          <Quote className="size-4" />
        </ToolButton>
        <ToolButton
          label={a.broadcasts.toolbarImage}
          onClick={() => apply({ kind: "insert", text: "![](https://)" })}
        >
          <ImageIcon className="size-4" />
        </ToolButton>
        <ToolButton
          label={a.broadcasts.toolbarDivider}
          onClick={() => apply({ kind: "insert", text: "\n\n---\n\n" })}
        >
          <Minus className="size-4" />
        </ToolButton>

        <span className="mx-1 h-5 w-px bg-ink-100" />

        {/*
          Merge tags, behind one button rather than five.
          A seller who wants them finds them; a seller who does not never has
          to wonder what `{{first_name}}` in a toolbar means.
        */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setTagsOpen((open) => !open)}
            aria-expanded={tagsOpen}
            className="focus-ring flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-ink-500 transition hover:bg-ink-100 hover:text-ink-900"
          >
            <Sparkles className="size-3.5" />
            {a.broadcasts.mergeTags}
          </button>
          {tagsOpen ? (
            <div className="absolute z-20 mt-1 w-52 rounded-xl border border-ink-200 bg-white p-1 shadow-lg">
              {MERGE_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => {
                    apply({ kind: "insert", text: `{{${tag}}}` });
                    setTagsOpen(false);
                  }}
                  className="focus-ring flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-start text-xs transition hover:bg-ink-50"
                >
                  <span className="font-medium text-ink-800">
                    {tag === "first_name"
                      ? a.broadcasts.mergeFirstName
                      : tag === "name"
                        ? a.broadcasts.mergeName
                        : tag === "shop"
                          ? a.broadcasts.mergeShop
                          : a.broadcasts.mergeCode}
                  </span>
                  <code className="text-[10px] text-ink-400">{`{{${tag}}}`}</code>
                </button>
              ))}
              <p className="px-2.5 py-1.5 text-[11px] leading-relaxed text-ink-500">
                {interpolate(a.broadcasts.mergeHint, { tag: "{{first_name}}" })}
              </p>
            </div>
          ) : null}
        </div>

        <div className="ms-auto flex items-center gap-1">
          {(["write", "preview"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              className={cn(
                "focus-ring h-8 rounded-lg px-2.5 text-xs font-medium transition",
                tab === key
                  ? "bg-ink-900 text-white"
                  : "text-ink-500 hover:bg-ink-100 hover:text-ink-900",
              )}
            >
              {key === "write" ? a.broadcasts.write : a.broadcasts.preview}
            </button>
          ))}
        </div>
      </div>

      {tab === "write" ? (
        <Textarea
          ref={ref}
          id="body"
          name="body"
          rows={16}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={maxLength}
          disabled={disabled}
          required
          className="rounded-none border-0 font-mono text-xs shadow-none focus:ring-0"
        />
      ) : value.trim() ? (
        /*
         * `renderBody` has already stripped everything that is not on its
         * allowlist and rebuilt every surviving tag from its name, which is
         * the same guarantee the inbox gets. Rendering it any other way here
         * would mean previewing something other than what is sent.
         */
        <div
          className="max-h-[32rem] overflow-y-auto px-4 py-3"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: renderBody(value) }}
        />
      ) : (
        <p className="px-4 py-6 text-sm text-ink-400">{a.broadcasts.emptyPreview}</p>
      )}

      <div className="flex items-center justify-between border-t border-ink-100 px-3 py-1.5 text-[11px] text-ink-400">
        <span>{interpolate(a.broadcasts.readTime, { seconds })}</span>
        <span className="tabular">
          {value.length.toLocaleString()} / {maxLength.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
