"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Globe } from "lucide-react";
import { LOCALES, type Locale } from "@/i18n/config";
import { setLocale } from "@/lib/actions/locale";
import { cn } from "@/lib/utils";

/**
 * Writes the choice to a cookie and refreshes so the server re-renders in the
 * new language. A cookie rather than a URL segment keeps shop links stable —
 * `/handle` is what sellers put in their bio.
 */
export function LanguageSwitcher({
  current,
  align = "center",
  label = "Language",
}: {
  current: Locale;
  align?: "start" | "center" | "end";
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(code: Locale) {
    setOpen(false);
    startTransition(async () => {
      await setLocale(code);
      router.refresh();
    });
  }

  const active = LOCALES.find((l) => l.code === current) ?? LOCALES[0];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-expanded={open}
        disabled={pending}
        className="surface-card inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition hover:opacity-70 disabled:opacity-50"
      >
        <Globe className="size-3.5" />
        {active.native}
      </button>

      {open ? (
        <div
          className={cn(
            "surface-card absolute bottom-full z-50 mb-2 max-h-72 w-48 overflow-y-auto rounded-xl p-1 shadow-xl",
            align === "start" && "start-0",
            align === "center" && "left-1/2 -translate-x-1/2",
            align === "end" && "end-0",
          )}
        >
          {LOCALES.map((locale) => (
            <button
              key={locale.code}
              type="button"
              onClick={() => choose(locale.code)}
              dir={locale.dir}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-start text-sm transition hover:opacity-70",
                locale.code === current && "surface-elevated font-medium",
              )}
            >
              <span>{locale.native}</span>
              {locale.code === current ? <Check className="size-3.5" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
