"use client";

import { startTransition, useActionState, useOptimistic } from "react";
import { Check, Circle, FileDown, Lock, Play } from "lucide-react";
import { markContentProgress } from "@/lib/actions/content";
import type { ReadableCollection } from "@sailo/commerce/content";

/**
 * The collection, on the buyer's own delivery page. Spec 40.
 *
 * Not a new route and not a new login wall: the page already resolves a token to
 * an order and already decides access at read time, so this is a block on it.
 * *The token is the wall.*
 *
 * ─── WHAT IS SHOWN FOR A LOCKED ITEM, AND WHY ──────────────────────────────
 *
 * Its title and when it opens. Hiding it would mean a buyer whose membership
 * lapsed cannot see what they have lost, and a seller cannot show what a course
 * contains. What is withheld is the *file link* — the only thing that yields
 * bytes — and that is withheld on the server: `fileId` is null on a locked item
 * before this component ever sees it.
 *
 * ─── AND WHY THE TICK IS OPTIMISTIC ────────────────────────────────────────
 *
 * Marking a lesson done is the most-tapped control on the page and it changes
 * nothing anybody can lose. `useOptimistic` so it responds instantly, and the
 * server write is idempotent — a double tap, a prefetch and a refresh all leave
 * one row, with the *first* completion date kept.
 */
export function CollectionList({
  token,
  data,
  labels,
}: {
  token: string;
  data: ReadableCollection;
  labels: {
    progress: string;
    continueLabel: string;
    preview: string;
    locked: string;
    unlocksIn: string;
    markDone: string;
    done: string;
    open: string;
  };
}) {
  const [, action] = useActionState(markContentProgress, { ok: false });

  const completedIds = data.sections
    .flatMap((section) => section.items)
    .filter((item) => item.completedAt !== null)
    .map((item) => item.id);

  const [done, addDone] = useOptimistic(
    new Set(completedIds),
    (current: Set<string>, change: { id: string; completed: boolean }) => {
      const next = new Set(current);
      if (change.completed) next.add(change.id);
      else next.delete(change.id);
      return next;
    },
  );

  const total = data.progress.total;
  const complete = total === 0 ? 0 : Math.round((done.size / total) * 100);

  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{data.collection.title}</h2>
        <span className="text-muted text-xs tabular-nums">
          {labels.progress.replace("{percent}", String(complete))}
        </span>
      </div>

      {/* The bar, drawn rather than imported: one div and no client bundle. */}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-black/10"
        role="progressbar"
        aria-valuenow={complete}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="accent-bg h-full transition-all" style={{ width: `${complete}%` }} />
      </div>

      {data.continueItemId ? (
        <a
          href={`#item-${data.continueItemId}`}
          className="focus-ring-accent mt-3 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
        >
          {labels.continueLabel}
        </a>
      ) : null}

      <div className="mt-4 space-y-5">
        {data.sections.map((section, index) => (
          <div key={section.section ?? `ungrouped-${index}`}>
            {section.section ? (
              <h3 className="text-muted mb-1.5 text-xs font-semibold uppercase tracking-wide">
                {section.section}
              </h3>
            ) : null}

            <ul className="surface-card divide-y divide-black/5 rounded-2xl">
              {section.items.map((item) => {
                const finished = done.has(item.id);
                return (
                  <li key={item.id} id={`item-${item.id}`} className="p-4">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 shrink-0 opacity-60">
                        {!item.available ? (
                          <Lock className="size-4" />
                        ) : item.fileId ? (
                          <FileDown className="size-4" />
                        ) : (
                          <Play className="size-4" />
                        )}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{item.title}</p>

                        {item.isPreview ? (
                          <p className="text-muted mt-0.5 text-xs">{labels.preview}</p>
                        ) : null}

                        {!item.available ? (
                          <p className="text-muted mt-0.5 text-xs">
                            {item.unlocksInDays !== null
                              ? labels.unlocksIn.replace(
                                  "{days}",
                                  String(item.unlocksInDays),
                                )
                              : labels.locked}
                          </p>
                        ) : null}

                        {item.available && item.fileId ? (
                          <a
                            href={`/api/download/${token}/${item.fileId}`}
                            className="focus-ring-accent mt-1 inline-flex min-h-11 items-center text-xs font-medium underline underline-offset-4"
                          >
                            {item.fileName ?? labels.open}
                          </a>
                        ) : null}

                        {item.available && item.externalUrl ? (
                          <a
                            href={item.externalUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="focus-ring-accent mt-1 inline-flex min-h-11 items-center text-xs font-medium underline underline-offset-4"
                          >
                            {labels.open}
                          </a>
                        ) : null}
                      </div>

                      {item.available ? (
                        <form
                          action={action}
                          onSubmit={() =>
                            startTransition(() =>
                              addDone({ id: item.id, completed: !finished }),
                            )
                          }
                          className="shrink-0"
                        >
                          <input type="hidden" name="token" value={token} />
                          <input type="hidden" name="itemId" value={item.id} />
                          {/*
                            A checkbox rather than a button, and checked from the
                            optimistic set: the control *is* the state, so a
                            failed write leaves the tick where the server put it
                            on the next render rather than lying about it.
                          */}
                          {!finished ? (
                            <input type="hidden" name="completed" value="on" />
                          ) : null}
                          <button
                            type="submit"
                            aria-label={finished ? labels.done : labels.markDone}
                            className="focus-ring-accent inline-flex size-11 items-center justify-center rounded-full transition hover:opacity-70"
                          >
                            {finished ? (
                              <Check className="size-5 opacity-80" />
                            ) : (
                              <Circle className="size-5 opacity-30" />
                            )}
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
