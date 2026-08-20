"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@sailo/design-system/web/cn";
import { useAdminT } from "./admin-i18n";

/**
 * The top bar's dirty state — Shopify's contract, adopted whole (spec 01):
 * while a form has unsaved changes, the bar's center stops being a search box
 * and becomes the save control. `⚠ Unsaved <thing> — [Discard] [Save]`, same
 * slot, same width, so nothing on the page moves.
 *
 * One registration at a time, on purpose. Two dirty forms on one screen is a
 * design bug this API refuses to paper over: the second `register` call wins
 * and the first is released, which is also what happens visually on Shopify
 * when you navigate mid-edit.
 *
 * Keyboard: ⌘S saves, and Escape is deliberately NOT discard — destroying
 * typed work wants a click, not a key you press by reflex to close things.
 */
export type SaveBarState = {
  /** What is unsaved — "Unsaved changes" interpolated with this. */
  label: string;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
};

type SaveBarContextValue = {
  state: SaveBarState | null;
  register: (state: SaveBarState) => void;
  release: () => void;
};

const SaveBarContext = createContext<SaveBarContextValue | null>(null);

export function SaveBarProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SaveBarState | null>(null);

  const register = useCallback((next: SaveBarState) => setState(next), []);
  const release = useCallback(() => setState(null), []);

  const value = useMemo(
    () => ({ state, register, release }),
    [state, register, release],
  );

  return (
    <SaveBarContext.Provider value={value}>{children}</SaveBarContext.Provider>
  );
}

/**
 * The form side. Call every render with the current dirty flag — the hook
 * registers while dirty and releases when clean or unmounted.
 *
 * The handlers are proxied through a ref on purpose: the caller's closures
 * get a new identity every render, and registering re-renders the caller
 * (it reads this context), so depending on them directly is a render loop.
 * The effect re-registers only when a *fact* changes — dirty, the label, or
 * the saving flag — while the proxies always call the latest closures.
 */
export function useSaveBar(dirty: boolean, state: SaveBarState) {
  const ctx = useContext(SaveBarContext);
  if (!ctx) throw new Error("useSaveBar must be used inside SaveBarProvider");
  const { register, release } = ctx;

  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  });
  const proxies = useMemo(
    () => ({
      onSave: () => latest.current.onSave(),
      onDiscard: () => latest.current.onDiscard(),
    }),
    [],
  );

  const { label, saving } = state;
  useEffect(() => {
    if (!dirty) return;
    register({ label, saving, ...proxies });
    return () => release();
  }, [dirty, label, saving, proxies, register, release]);
}

/** The bar side — what the topbar's center renders instead of the palette. */
export function SaveBarStrip() {
  const ctx = useContext(SaveBarContext);
  const a = useAdminT();
  const state = ctx?.state ?? null;

  /* ⌘S while dirty saves — the shortcut everyone tries anyway. */
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!state.saving) state.onSave();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [state]);

  if (!state) return null;

  return (
    <div
      role="status"
      className="animate-fade flex h-9 w-full max-w-xl items-center gap-2 rounded-lg bg-white/[0.08] ps-3 pe-1.5 ring-1 ring-inset ring-white/10 [animation-duration:150ms]"
    >
      <AlertCircle className="size-4 shrink-0 text-amber-400" />
      <span className="min-w-0 flex-1 truncate text-[13px] text-white/80">
        {state.label}
      </span>
      <button
        type="button"
        onClick={state.onDiscard}
        disabled={state.saving}
        className="focus-ring press h-7 shrink-0 rounded-md px-2.5 text-xs font-semibold text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-50 pointer-coarse:h-9"
      >
        {a.saveBar.discard}
      </button>
      <button
        type="button"
        onClick={state.onSave}
        disabled={state.saving}
        className={cn(
          "focus-ring press flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-white px-3 text-xs font-semibold text-ink-900 transition hover:bg-ink-100 disabled:opacity-60 pointer-coarse:h-9",
        )}
      >
        {state.saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
        {a.common.save}
      </button>
    </div>
  );
}

/** Whether the strip is live — the topbar hides the palette trigger behind it. */
export function useSaveBarActive(): boolean {
  const ctx = useContext(SaveBarContext);
  return Boolean(ctx?.state);
}
