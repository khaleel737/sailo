"use client";

import { startTransition, useActionState, useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2 } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Textarea,
} from "@sailo/design-system/web";
import type { ShopPage } from "@sailo/db/schema";
import { SHOP_PAGE_KINDS, isLegalPageKind } from "@sailo/core/shop-pages";
import {
  generateShopPages,
  regenerateShopPage,
  saveShopPage,
  toggleShopPage,
  useAsCheckoutTerms,
} from "@/lib/actions/shop-pages";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

/**
 * The generator, the five pages, and the one click that turns `requireTerms` on.
 *
 * Every form here submits by hand rather than through `action={action}`. React
 * resets an uncontrolled form once a form action completes — it cannot know
 * whether the action succeeded — and on the editor below that would mean a
 * seller told "the page is empty" watching the document they had just written
 * empty itself. The same reasoning, and the same fix, as `product-form.tsx`.
 */
export function LegalPagesScreen({
  pages,
  handle,
  termsUrl,
  privacyUrl,
  requireTerms,
  usesAnalytics,
}: {
  pages: ShopPage[];
  handle: string;
  termsUrl: string | null;
  privacyUrl: string | null;
  requireTerms: boolean;
  usesAnalytics: boolean;
}) {
  const a = useAdminT();
  const byKind = new Map(pages.map((page) => [page.kind, page]));

  return (
    <div className="space-y-5">
      {/*
        Not optional and not dismissible. It is the first thing on the screen
        and it is the first thing in the footer of every page this produces —
        the honesty about what the output is *is* the difference between this
        and selling a legal-document product.
      */}
      <Alert tone="info">{a.legal.disclaimer}</Alert>

      <GeneratorCard usesAnalytics={usesAnalytics} hasPages={pages.length > 0} />

      {SHOP_PAGE_KINDS.map((kind) => {
        const page = byKind.get(kind);
        if (!page) return null;
        return (
          <PageCard
            key={page.id}
            page={page}
            handle={handle}
            usesAnalytics={usesAnalytics}
            linked={
              (kind === "terms" && Boolean(termsUrl?.includes(`/${handle}/legal/`))) ||
              (kind === "privacy" && Boolean(privacyUrl?.includes(`/${handle}/legal/`)))
            }
            requireTerms={requireTerms}
          />
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** The four questions `shops` cannot answer, and the button that renders five pages. */
function GeneratorCard({
  usesAnalytics,
  hasPages,
}: {
  usesAnalytics: boolean;
  hasPages: boolean;
}) {
  const a = useAdminT();
  const [state, action, pending] = useActionState(generateShopPages, { ok: false });

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">{a.legal.generate}</h2>
        <p className="mt-0.5 text-xs text-ink-500">{a.legal.generateBody}</p>
      </div>

      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.ok && state.message ? <Alert tone="success">{state.message}</Alert> : null}

      <form
        id="legal-generator"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          startTransition(() => action(data));
        }}
        className="space-y-4"
      >
        <Field
          label={a.legal.refundWindow}
          htmlFor="refundWindowDays"
          hint={a.legal.refundWindowHint}
        >
          <Input
            id="refundWindowDays"
            name="refundWindowDays"
            type="number"
            inputMode="numeric"
            min={0}
            max={365}
            /*
             * No default. Blank and `0` are different answers — one leaves the
             * template saying the window is unstated, the other publishes "no
             * refunds beyond the law" — and pre-filling either would put words
             * in a seller's policy that they never chose.
             */
            placeholder="14"
          />
        </Field>

        <Field
          label={a.legal.extraData}
          htmlFor="extraDataCollected"
          hint={a.legal.extraDataHint}
        >
          <Textarea id="extraDataCollected" name="extraDataCollected" rows={2} />
        </Field>

        <label className="flex cursor-pointer items-start gap-3 pointer-coarse:min-h-11">
          <input
            type="checkbox"
            name="usesAnalytics"
            defaultChecked={usesAnalytics}
            className="mt-0.5 size-4 rounded border-ink-300 accent-ink-900 pointer-coarse:size-5"
          />
          <span>
            <span className="block text-sm font-medium">{a.legal.analytics}</span>
            <span className="block text-xs text-ink-500">
              {usesAnalytics ? a.legal.analyticsDetected : a.legal.analyticsHint}
            </span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-3 pointer-coarse:min-h-11">
          <input
            type="checkbox"
            name="shipsPhysicalGoods"
            className="mt-0.5 size-4 rounded border-ink-300 accent-ink-900 pointer-coarse:size-5"
          />
          <span>
            <span className="block text-sm font-medium">{a.legal.ships}</span>
            <span className="block text-xs text-ink-500">{a.legal.shipsHint}</span>
          </span>
        </label>

        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {hasPages ? a.legal.generateMissing : a.legal.generateAll}
        </Button>
      </form>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The five kinds, named for a seller.
 *
 * A lookup rather than `a.legal.kinds[kind]`, because the admin dictionary is
 * two levels deep with a string at every leaf — `mergeAdmin` merges one section
 * at a time, so a nested object in a section breaks the whole dictionary's type.
 */
const KIND_LABELS: Record<string, (a: ReturnType<typeof useAdminT>) => string> = {
  terms: (a) => a.legal.kindTerms,
  privacy: (a) => a.legal.kindPrivacy,
  refunds: (a) => a.legal.kindRefunds,
  about: (a) => a.legal.kindAbout,
  faq: (a) => a.legal.kindFaq,
};

function PageCard({
  page,
  handle,
  usesAnalytics,
  linked,
  requireTerms,
}: {
  page: ShopPage;
  handle: string;
  usesAnalytics: boolean;
  /** Whether `shops.termsUrl` / `privacyUrl` already points at this page. */
  linked: boolean;
  requireTerms: boolean;
}) {
  const a = useAdminT();
  const [open, setOpen] = useState(false);
  const [saveState, save, saving] = useActionState(saveShopPage, { ok: false });
  const [regenState, regen, regenerating] = useActionState(regenerateShopPage, {
    ok: false,
  });
  const [toggleState, toggle, toggling] = useActionState(toggleShopPage, { ok: false });
  const [linkState, link, linking] = useActionState(useAsCheckoutTerms, { ok: false });
  const [confirming, setConfirming] = useState(false);

  const label = KIND_LABELS[page.kind]?.(a) ?? page.kind;
  const errors = [saveState.error, regenState.error, toggleState.error, linkState.error]
    .filter(Boolean)
    .join(" ");
  const messages = [saveState, regenState, toggleState, linkState]
    .filter((s) => s.ok && s.message)
    .map((s) => s.message);

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-ink-900">{label}</h2>
            <Badge tone={page.isPublished ? "green" : "neutral"} dot>
              {page.isPublished ? a.legal.published : a.legal.draft}
            </Badge>
            {page.source === "custom" ? (
              <Badge tone="neutral">{a.legal.edited}</Badge>
            ) : null}
          </div>
          {page.isPublished ? (
            <Link
              href={`/${handle}/legal/${page.slug}`}
              target="_blank"
              rel="noreferrer"
              className="focus-ring mt-1 inline-flex items-center gap-1 text-xs text-ink-500 underline underline-offset-4 hover:text-ink-900"
            >
              /{handle}/legal/{page.slug}
              <ExternalLink className="size-3" />
            </Link>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              startTransition(() => toggle(data));
            }}
          >
            <input type="hidden" name="kind" value={page.kind} />
            <Button type="submit" variant="secondary" disabled={toggling}>
              {toggling ? <Loader2 className="size-4 animate-spin" /> : null}
              {page.isPublished ? a.legal.unpublish : a.legal.publish}
            </Button>
          </form>

          <Button type="button" variant="ghost" onClick={() => setOpen((v) => !v)}>
            {open ? a.legal.closeEditor : a.common.edit}
          </Button>
        </div>
      </div>

      {errors ? <Alert>{errors}</Alert> : null}
      {messages.map((message) => (
        <Alert key={message} tone="success">
          {message}
        </Alert>
      ))}

      {/*
        The one click the whole spec exists for. Offered only on the two kinds
        the shop row can hold a link for, and only once the page is published —
        a buyer cannot agree to a draft.
      */}
      {(page.kind === "terms" || page.kind === "privacy") && page.isPublished ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            startTransition(() => link(data));
          }}
          className="rounded-xl bg-ink-50 p-3"
        >
          <input type="hidden" name="kind" value={page.kind} />
          <p className="text-xs text-ink-600">
            {page.kind === "terms"
              ? linked && requireTerms
                ? a.legal.checkoutLinked
                : a.legal.checkoutOffer
              : linked
                ? a.legal.privacyLinked
                : a.legal.privacyOffer}
          </p>
          {!(page.kind === "terms" ? linked && requireTerms : linked) ? (
            <Button type="submit" className="mt-2" disabled={linking}>
              {linking ? <Loader2 className="size-4 animate-spin" /> : null}
              {page.kind === "terms" ? a.legal.useAtCheckout : a.legal.useAsPrivacy}
            </Button>
          ) : null}
        </form>
      ) : null}

      {open ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            startTransition(() => save(data));
          }}
          className="space-y-4 border-t border-ink-100 pt-4"
        >
          <input type="hidden" name="kind" value={page.kind} />

          <Field label={a.legal.pageTitle} htmlFor={`title-${page.id}`}>
            <Input
              id={`title-${page.id}`}
              name="title"
              defaultValue={page.title ?? ""}
              maxLength={120}
              required
            />
          </Field>

          <Field
            label={a.legal.slug}
            htmlFor={`slug-${page.id}`}
            hint={`/${handle}/legal/…`}
          >
            <Input id={`slug-${page.id}`} name="slug" defaultValue={page.slug} />
          </Field>

          <Field
            label={a.legal.body}
            htmlFor={`body-${page.id}`}
            hint={isLegalPageKind(page.kind) ? a.legal.bodyHint : a.legal.bodyHintPlain}
          >
            <Textarea
              id={`body-${page.id}`}
              name="bodyMd"
              rows={18}
              defaultValue={page.bodyMd ?? ""}
              className="font-mono text-xs"
            />
          </Field>

          <label className="flex cursor-pointer items-start gap-3 pointer-coarse:min-h-11">
            <input
              type="checkbox"
              name="isPublished"
              defaultChecked={page.isPublished}
              className="mt-0.5 size-4 rounded border-ink-300 accent-ink-900 pointer-coarse:size-5"
            />
            <span className="text-sm font-medium">{a.legal.publishOnSave}</span>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              {a.common.save}
            </Button>
          </div>
        </form>
      ) : null}

      {/*
        Regeneration, and the warning that makes it safe.

        A separate form from the editor because it is the one control here that
        destroys work: it replaces the body with a fresh render of the template.
        The seller is told so before the button appears, and the confirmation
        field is what the action checks — a request that arrives without it is
        refused rather than obeyed.
      */}
      {page.source === "custom" || page.templateVersion ? (
        <div className="border-t border-ink-100 pt-4">
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="focus-ring rounded text-xs text-ink-500 underline underline-offset-4 hover:text-ink-900"
            >
              {a.legal.regenerate}
            </button>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                startTransition(() => regen(data));
              }}
              className="space-y-3"
            >
              <input type="hidden" name="kind" value={page.kind} />
              <input type="hidden" name="confirm" value="replace" />
              {/*
                The generator's answers ride along, so a regeneration produces
                the same document the generator would — otherwise the refund
                window silently resets to "unstated" every time somebody
                refreshes a page they wrote a window into.
              */}
              <input
                type="hidden"
                name="usesAnalytics"
                value={usesAnalytics ? "on" : ""}
              />
              <Alert tone="warning">{a.legal.regenerateWarning}</Alert>

              <Field
                label={a.legal.refundWindow}
                htmlFor={`regen-window-${page.id}`}
                hint={a.legal.refundWindowHint}
              >
                <Input
                  id={`regen-window-${page.id}`}
                  name="refundWindowDays"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={365}
                />
              </Field>

              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" variant="danger" disabled={regenerating}>
                  {regenerating ? <Loader2 className="size-4 animate-spin" /> : null}
                  {a.legal.regenerateConfirm}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setConfirming(false)}
                >
                  {a.common.cancel}
                </Button>
              </div>
            </form>
          )}
        </div>
      ) : null}
    </Card>
  );
}
