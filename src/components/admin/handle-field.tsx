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
  prefix = "sailo.to/",
  label = "Your Sailo link",
  autoFocus = false,
}: {
  name?: string;
  defaultValue?: string;
  currentHandle?: string;
  prefix?: string;
  label?: string;
  autoFocus?: boolean;
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

  const tone =
    state.kind === "available"
      ? "border-emerald-400 focus-within:ring-emerald-500/15"
      : state.kind === "taken"
        ? "border-red-300 focus-within:ring-red-500/15"
        : "border-ink-200 focus-within:border-ink-900 focus-within:ring-ink-900/10";

  return (
    <div>
      <label
        htmlFor={name}
        className="mb-1.5 block text-sm font-medium text-ink-800"
      >
        {label}
      </label>

      <div
        className={cn(
          "flex items-center rounded-xl border bg-white transition focus-within:ring-2",
          tone,
        )}
      >
        <span className="shrink-0 pl-3 text-sm text-ink-400">{prefix}</span>
        <input
          id={name}
          name={name}
          required
          autoFocus={autoFocus}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={handle}
          onChange={(e) => setHandle(normalizeHandle(e.target.value))}
          aria-invalid={state.kind === "taken"}
          aria-describedby={`${name}-status`}
          className="h-10 min-w-0 flex-1 bg-transparent pl-0.5 pr-2 text-sm font-medium text-ink-900 focus:outline-none"
          placeholder="yourshop"
        />
        <span className="flex w-8 shrink-0 justify-center">
          {state.kind === "checking" ? (
            <Loader2 className="size-4 animate-spin text-ink-300" />
          ) : state.kind === "available" ? (
            <Check className="size-4 text-emerald-600" />
          ) : state.kind === "taken" ? (
            <X className="size-4 text-red-500" />
          ) : null}
        </span>
      </div>

      <div id={`${name}-status`} aria-live="polite" className="mt-1.5">
        {state.kind === "available" ? (
          <p className="text-xs font-medium text-emerald-600">
            {handle} is available
          </p>
        ) : state.kind === "taken" ? (
          <>
            <p className="text-xs text-red-600">{state.message}</p>
            {state.suggestions.length > 0 ? (
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
                Try:
                {state.suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setHandle(s)}
                    className="rounded-md bg-ink-100 px-1.5 py-0.5 font-medium text-ink-800 transition hover:bg-ink-200"
                  >
                    {s}
                  </button>
                ))}
              </p>
            ) : null}
          </>
        ) : state.kind === "unchanged" ? (
          <p className="text-xs text-ink-400">
            This is your current link. Changing it breaks any links already
            shared.
          </p>
        ) : (
          <p className="text-xs text-ink-400">
            Letters, numbers, hyphens and underscores.
          </p>
        )}
      </div>
    </div>
  );
}
