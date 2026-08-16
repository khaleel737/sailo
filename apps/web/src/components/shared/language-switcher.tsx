"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { LOCALES, type Locale } from "@sailo/i18n/config";
import { setLocale } from "@/lib/actions/locale";
import { cn } from "@/lib/utils";

/** Room the list wants before it's worth opening upwards at all. */
const MIN_SPACE = 180;
const MAX_HEIGHT = 288;
const PANEL_WIDTH = 208;
const GAP = 8;

/** The shop palette, carried across to the portal by hand. */
const SURFACE_VARS = [
  "--surface-card",
  "--surface-elevated",
  "--surface-border",
  "--surface-fg",
  "--surface-muted",
] as const;

type Panel = {
  top: number;
  left: number;
  maxHeight: number;
  dir: string;
  vars: Record<string, string>;
};

/**
 * Writes the choice to a cookie and refreshes so the server re-renders in the
 * new language. A cookie rather than a URL segment keeps shop links stable —
 * `/handle` is what sellers put in their bio.
 *
 * The list renders in a portal on `document.body`, not beside its button.
 * `position: fixed` is only relative to the viewport when no ancestor has a
 * transform, filter or backdrop-filter; the admin header has `backdrop-blur`,
 * which quietly made "fixed" mean "fixed inside the header" and threw the
 * panel a couple of hundred pixels off the right of the screen. Out on the
 * body nothing can capture it, so the measured coordinates mean what they say.
 */
export function LanguageSwitcher({
  current,
  align = "center",
  label = "Language",
  size = "sm",
}: {
  current: Locale;
  align?: "start" | "center" | "end";
  label?: string;
  /**
   * `sm` is the storefront footer's compact pill. `md` meets the 44px touch
   * target, for surfaces where this is a primary control rather than a
   * footnote.
   */
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [pending, startTransition] = useTransition();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const open = panel !== null;

  /**
   * Where the list should sit right now, measured against the viewport.
   * Called from the click handler and again whenever the page moves under it.
   */
  function measure(): Panel | null {
    const button = buttonRef.current;
    if (!button) return null;

    const rect = button.getBoundingClientRect();
    // clientWidth/Height exclude the scrollbar; innerWidth doesn't, and the
    // difference is enough to give the document a horizontal scrollbar.
    const viewportW = document.documentElement.clientWidth;
    const viewportH = document.documentElement.clientHeight;

    const above = rect.top - GAP;
    const below = viewportH - rect.bottom - GAP;
    // Prefer upwards — it's usually a footer control — unless there's no room.
    const goUp = above >= MIN_SPACE || above > below;
    const maxHeight = Math.max(120, Math.min(MAX_HEIGHT, goUp ? above : below));

    const anchored =
      align === "start"
        ? rect.left
        : align === "end"
          ? rect.right - PANEL_WIDTH
          : rect.left + rect.width / 2 - PANEL_WIDTH / 2;

    // Carry the surrounding palette into the portal, so a dark shop's picker
    // stays dark even though it now renders on the body.
    const computed = getComputedStyle(button);
    const vars: Record<string, string> = {};
    for (const name of SURFACE_VARS) {
      const value = computed.getPropertyValue(name).trim();
      if (value) vars[name] = value;
    }

    return {
      top: goUp ? Math.max(GAP, rect.top - GAP - maxHeight) : rect.bottom + GAP,
      left: Math.min(
        Math.max(GAP, anchored),
        Math.max(GAP, viewportW - PANEL_WIDTH - GAP),
      ),
      maxHeight,
      dir: button.closest("[dir]")?.getAttribute("dir") ?? "ltr",
      vars,
    };
  }

  function toggle() {
    setPanel(open ? null : measure());
  }

  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setPanel(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPanel(null);

    /**
     * The panel lives on the body, so it has to be told when the page moves
     * underneath it. Scrolling *inside* the list is not the page moving — the
     * capture listener sees those events too, and closing on them made the
     * list shut the moment anyone tried to reach the languages further down.
     */
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      setPanel(measure());
    };
    const onResize = () => setPanel(measure());

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function choose(code: Locale) {
    setPanel(null);
    startTransition(async () => {
      /*
       * The blog keeps its language in the URL, not in the cookie, so there
       * the switch is a navigation rather than a refresh. `setLocale` answers
       * with where to go when that applies and null everywhere else — the
       * client cannot work it out for itself, because whether a given article
       * exists in the chosen language is a question only the server can
       * answer.
       *
       * Refreshing on the blog changed the nav and left the article alone: a
       * French header wrapped around an English post at a URL still saying
       * `/en`.
       */
      const href = await setLocale(code, pathname);
      if (href) router.push(href);
      else router.refresh();
    });
  }

  const active = LOCALES.find((l) => l.code === current) ?? LOCALES[0];

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        /*
         * The visible name has to survive into the accessible one. A bare
         * `aria-label` of "Language" replaced the word the button actually
         * shows, so someone driving the page by voice said "click English"
         * and nothing happened — the control they could see was not the
         * control the browser had a name for. Naming both keeps the purpose
         * and gives the spoken word something to match.
         */
        aria-label={`${label}: ${active.native}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={pending}
        className={cn(
          "surface-card inline-flex items-center gap-1.5 rounded-full font-medium transition hover:opacity-70 disabled:opacity-50",
          size === "md"
            ? "min-h-11 px-4 py-2.5 text-[0.8125rem]"
            /* `sm` is the admin header's size and lands at 30px. That is fine
               under a mouse and under the floor under a thumb — and this
               header renders on an iPad, which is both wide and touched. The
               type stays at `text-xs`; only the box grows. */
            : "px-3 py-1.5 text-xs pointer-coarse:min-h-11 pointer-coarse:px-4",
        )}
      >
        <span aria-hidden className="text-sm leading-none">
          {active.flag}
        </span>
        {active.native}
      </button>

      {panel
        ? createPortal(
            <div
              ref={panelRef}
              role="listbox"
              aria-label={label}
              dir={panel.dir}
              style={{
                ...panel.vars,
                top: panel.top,
                left: panel.left,
                width: PANEL_WIDTH,
                maxHeight: panel.maxHeight,
              } as React.CSSProperties}
              className="surface-card fixed z-[100] overflow-y-auto overscroll-contain rounded-xl p-1 shadow-xl"
            >
              {LOCALES.map((locale) => (
                <button
                  key={locale.code}
                  type="button"
                  role="option"
                  aria-selected={locale.code === current}
                  onClick={() => choose(locale.code)}
                  // Each name in its own script's direction, so Arabic reads
                  // right-to-left inside an otherwise left-to-right list.
                  dir={locale.dir}
                  className={cn(
                    /* A scrolling list of twenty-odd languages, each row 30px
                       tall. Picking the wrong one here changes the language of
                       the whole panel, and the row above it is another
                       language — so the floor matters more in this list than
                       in most. */
                    "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-start text-sm transition pointer-coarse:min-h-11 hover:opacity-70",
                    locale.code === current && "surface-elevated font-medium",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span aria-hidden className="text-base leading-none">
                      {locale.flag}
                    </span>
                    <span className="truncate">{locale.native}</span>
                  </span>
                  {locale.code === current ? (
                    <Check className="size-3.5 shrink-0" />
                  ) : null}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
