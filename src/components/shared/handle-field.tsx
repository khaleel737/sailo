"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { checkHandle, type HandleStatus } from "@/lib/actions/shop";
import {
  HANDLE_MESSAGES,
  normalizeHandle,
  validateHandleFormat,
  type HandleProblem,
} from "@/lib/handle";
import type { Dictionary } from "@/i18n";
import { interpolate } from "@/i18n";
import { cn } from "@/lib/utils";

type State =
  | { kind: "idle" }
  | { kind: "unchanged" }
  | { kind: "checking" }
  | { kind: "available" }
  | { kind: "taken"; message: string; suggestions: string[] };

type Remote = { handle: string; result: HandleStatus | "error" };

/**
 * Shop link input with live availability. Format problems are caught locally
 * so no request goes out for something obviously wrong; only a well-formed
 * handle costs a round trip, debounced while typing.
 */
export function HandleField({
  name = "handle",
  defaultValue = "",
  /** Present when editing — the shop's own handle shouldn't read as taken. */
  currentHandle,
  prefix = "sailo.store/",
  label,
  autoFocus = false,
  onChange,
  onResolved,
  t,
}: {
  name?: string;
  defaultValue?: string;
  currentHandle?: string;
  prefix?: string;
  label?: string;
  autoFocus?: boolean;
  /** Mirrors the normalised handle out, for a live preview. */
  onChange?: (handle: string) => void;
  /** Fires whenever the field settles on a verdict — lets a stepper gate on it. */
  onResolved?: (usable: boolean) => void;
  t: Dictionary;
}) {
  const [handle, setHandle] = useState(() => normalizeHandle(defaultValue));
  const [remote, setRemote] = useState<Remote | null>(null);

  // Guards against a slow earlier response overwriting a newer one.
  const requestId = useRef(0);

  // Everything decidable without the server is derived during render, so the
  // effect never sets state synchronously.
  const local: "unchanged" | "idle" | HandleProblem | null =
    currentHandle && handle === currentHandle
      ? "unchanged"
      : !handle
        ? "idle"
        : validateHandleFormat(handle);

  useEffect(() => {
    if (local !== null) return;

    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      let result: HandleStatus | "error";
      try {
        result = await checkHandle(handle);
      } catch {
        // Network hiccup — stay quiet and let the server decide on submit.
        result = "error";
      }
      if (id === requestId.current) setRemote({ handle, result });
    }, 400);

    return () => clearTimeout(timer);
  }, [handle, local]);

  const fresh = remote?.handle === handle ? remote.result : null;

  const state: State =
    local === "unchanged"
      ? { kind: "unchanged" }
      : local === "idle"
        ? { kind: "idle" }
        : local !== null
          ? { kind: "taken", message: HANDLE_MESSAGES[local], suggestions: [] }
          : fresh === null
            ? { kind: "checking" }
            : fresh === "error"
              ? { kind: "idle" }
              : fresh.available
                ? { kind: "available" }
                : {
                    kind: "taken",
                    message: fresh.message ?? HANDLE_MESSAGES.taken,
                    suggestions: fresh.suggestions,
                  };

  // A handle is usable once it is either free or the one this shop already
  // has. `checking` deliberately counts as not-yet, so a stepper can't be
  // walked past while a request is still in flight.
  const usable = state.kind === "available" || state.kind === "unchanged";

  useEffect(() => {
    onResolved?.(usable);
  }, [usable, onResolved]);

  function commit(next: string) {
    const normalized = normalizeHandle(next);
    setHandle(normalized);
    onChange?.(normalized);
  }

  const tone =
    state.kind === "available"
      ? "border-emerald-400 ring-4 ring-emerald-500/10"
      : state.kind === "taken"
        ? "border-red-300 ring-4 ring-red-500/10"
        : "border-ink-200 focus-within:border-brand-600 focus-within:ring-4 focus-within:ring-brand-600/12";

  return (
    <div>
      <label
        htmlFor={name}
        className="mb-1.5 block text-sm font-medium text-ink-800"
      >
        {label ?? t.onboarding.yourLink}
      </label>

      <div
        className={cn(
          "flex items-center rounded-xl border bg-white shadow-xs",
          "transition-[border-color,box-shadow] duration-150",
          tone,
        )}
      >
        <span className="shrink-0 ps-3.5 text-sm text-ink-400 select-none">
          {prefix}
        </span>
        <input
          id={name}
          name={name}
          required
          autoFocus={autoFocus}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={handle}
          onChange={(e) => commit(e.target.value)}
          aria-invalid={state.kind === "taken"}
          aria-describedby={`${name}-status`}
          className="h-11 min-w-0 flex-1 bg-transparent pe-2 ps-0.5 text-sm font-semibold text-ink-900 focus:outline-none"
          placeholder="yourshop"
        />
        <span className="flex w-9 shrink-0 justify-center">
          {state.kind === "checking" ? (
            <Loader2 className="size-4 animate-spin text-ink-300" />
          ) : state.kind === "available" ? (
            <Check className="animate-pop size-4 text-emerald-600" strokeWidth={3} />
          ) : state.kind === "taken" ? (
            <X className="animate-pop size-4 text-red-500" strokeWidth={3} />
          ) : null}
        </span>
      </div>

      <div id={`${name}-status`} aria-live="polite" className="mt-1.5">
        {state.kind === "available" ? (
          <p className="text-xs font-medium text-emerald-600">
            {interpolate(t.handle.available, { handle })}
          </p>
        ) : state.kind === "taken" ? (
          <>
            <p className="text-xs font-medium text-red-600">{state.message}</p>
            {state.suggestions.length > 0 ? (
              <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
                {t.handle.tryInstead}
                {state.suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => commit(s)}
                    className="focus-ring rounded-md bg-ink-100 px-1.5 py-0.5 font-medium text-ink-800 transition hover:bg-ink-200"
                  >
                    {s}
                  </button>
                ))}
              </p>
            ) : null}
          </>
        ) : state.kind === "unchanged" ? (
          <p className="text-xs text-ink-400">{t.handle.current}</p>
        ) : (
          <p className="text-xs text-ink-400">{t.handle.hint}</p>
        )}
      </div>
    </div>
  );
}
