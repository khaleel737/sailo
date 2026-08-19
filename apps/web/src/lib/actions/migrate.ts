"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { importJobs, type ImportReportRow } from "@sailo/db/schema";
import { revalidateShop } from "@/lib/cache";
import { publishShopEvent } from "@sailo/events";
import { requireShop } from "@/lib/session";
import { rateLimit } from "@sailo/rate-limit";
import { can, upgradeMessage } from "@sailo/core/plans";
import { parse } from "@/lib/import/parse";
import {
  GATED_SOURCES,
  isImportSource,
  mapTabular,
  type ImportPlan,
  type ImportSource,
  type SourceBatch,
} from "@sailo/commerce/import";
import { fetchShopify, fetchStripe, runImport } from "@sailo/commerce/import/server";

/**
 * Bringing a catalogue in from Stripe, Shopify, Etsy, Gumroad or a CSV —
 * spec 47.
 *
 * **Dry run, always.** The first submit fetches, maps and plans, and writes
 * nothing; the second runs the plan the seller just read. A bulk write with no
 * preview is a bulk mistake, and this is not a setting.
 *
 * The action is thin on purpose. Fetching is `@sailo/commerce/import/server`,
 * mapping is pure, planning is pure, and writing goes through `saveProduct` —
 * the same function the product form uses. What is here is the part that is
 * genuinely this app's: who is asking, what their plan allows, and how often.
 */

export type MigrateState =
  | { ok: false; error?: string }
  | {
      ok: true;
      source: ImportSource;
      plan: ImportPlan;
      report: ImportReportRow[];
      committed: boolean;
      /** Anything the fetch itself has to say — a page cap, a skipped kind. */
      notes: string[];
    };

/** A spreadsheet a seller uploads. The CSV importer's ceiling, unchanged. */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Ceilings, and both of them fail closed.
 *
 * A preview reaches a third-party API with a token; a run writes a catalogue
 * and fetches an image per product from a host the seller named. Failing open
 * while Redis is down leaves both unmetered, and the second one is our IP
 * address pointed at somebody else's CDN as fast as a form can be submitted.
 */
const PREVIEW_LIMIT = 20;
const PREVIEW_WINDOW = 600;
const RUN_LIMIT = 5;
const RUN_WINDOW = 3600;

export async function migrateCatalogue(
  _prev: MigrateState,
  formData: FormData,
): Promise<MigrateState> {
  const { shop, user } = await requireShop();

  const source = String(formData.get("source") ?? "");
  if (!isImportSource(source)) return { ok: false, error: "Unknown source." };

  /*
   * Stripe, Etsy and the plain CSV are ungated, and that is a decision.
   *
   * Etsy is a spreadsheet upload that costs us nothing, and it is the
   * migration this product's own marketing promises — `layout.tsx` ships
   * "Etsy alternative" as a targeting keyword. Gating it would be charging for
   * the door.
   */
  if (GATED_SOURCES.includes(source) && !can(shop, "catalogueImport")) {
    return {
      ok: false,
      error: upgradeMessage("catalogueImport", SOURCE_NAMES[source] ?? "This import"),
    };
  }

  const commit = formData.get("commit") === "1";

  const gate = await rateLimit(
    commit ? `import:run:${shop.id}` : `import:preview:${shop.id}`,
    commit ? RUN_LIMIT : PREVIEW_LIMIT,
    commit ? RUN_WINDOW : PREVIEW_WINDOW,
    { onOutage: "closed" },
  );
  if (!gate.allowed) {
    return { ok: false, error: "Too many imports just now. Try again shortly." };
  }

  const batch = await readSource(source, shop, formData);
  if (!batch.ok) return { ok: false, error: batch.error };

  const db = getDb();

  /*
   * The claim is the insert.
   *
   * `import_jobs_one_running_idx` is unique on `shop_id` where the status is
   * `running`, so a second job under the same shop is a constraint violation
   * rather than a lookup that races. Two simultaneous imports of one catalogue
   * would both plan against a shop with no links, both decide every row is a
   * create, and leave the seller with two of everything.
   *
   * A dry run claims nothing: it writes no rows, so it cannot race one.
   */
  let jobId = "";
  if (commit) {
    const [claimed] = await db
      .insert(importJobs)
      .values({
        shopId: shop.id,
        source,
        kind: "products",
        status: "running",
        createdBy: user.id,
        startedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: importJobs.id });

    if (!claimed) {
      return { ok: false, error: "An import is already running for this shop." };
    }
    jobId = claimed.id;
  }

  try {
    const result = await runImport({ shop, jobId, batch: batch.batch, dryRun: !commit });

    if (result.plan.refusal) {
      if (commit) await release(jobId, "failed");
      return {
        ok: false,
        error:
          /*
           * Named rather than generic. "Currency mismatch" tells a seller
           * nothing; "your shop is in EUR and this catalogue is priced in USD"
           * tells them exactly which of the two to change. Nothing is
           * converted, here or anywhere — a rate nobody recorded is a price
           * nobody agreed.
           */
          `This catalogue is priced in ${result.plan.refusal.detail.split(" → ")[0]} and your shop sells in ${shop.currency}. Change one of them and try again — nothing is converted.`,
      };
    }

    if (commit) {
      revalidatePath("/admin/products");
      revalidatePath("/admin/categories");
      revalidatePath(`/${shop.handle}`);
      revalidateShop(shop.id, shop.handle);
      after(() => publishShopEvent(shop.id, "catalog"));
    }

    return {
      ok: true,
      source,
      plan: result.plan,
      report: result.report,
      committed: commit,
      notes: batch.batch.notes,
    };
  } catch (error) {
    /*
     * The job is released rather than left `running`, or the claim above locks
     * this shop out of importing for ever after one bad run. What it is *not*
     * is rolled back: rows already created are real products and the report
     * says which — undoing a bulk product write would delete rows a seller may
     * already have edited.
     */
    if (commit) await release(jobId, "failed");
    return {
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 200) : "That import failed.",
    };
  }
}

async function release(jobId: string, status: string) {
  if (!jobId) return;
  await getDb()
    .update(importJobs)
    .set({ status, finishedAt: new Date() })
    .where(and(eq(importJobs.id, jobId), eq(importJobs.status, "running")));
}

/* -------------------------------------------------------------------------- */
/*  Reading a source                                                           */
/* -------------------------------------------------------------------------- */

type Read = { ok: true; batch: SourceBatch } | { ok: false; error: string };

/**
 * Credentials: collect, use, discard.
 *
 * The Shopify token arrives in `formData`, is passed to the fetch, and is never
 * written anywhere. A stored third-party token is a credential at rest with no
 * ongoing purpose — this is a one-off errand, and a seller re-running it can
 * paste it again. Continuous sync is a different feature with a different
 * security posture and must not be smuggled in through this one.
 */
async function readSource(
  source: ImportSource,
  shop: { id: string; currency: string; stripeAccountId: string | null },
  formData: FormData,
): Promise<Read> {
  if (source === "stripe") {
    if (!shop.stripeAccountId) {
      return { ok: false, error: "Connect Stripe first — there is nothing to read yet." };
    }
    const fetched = await fetchStripe(shop.stripeAccountId);
    return fetched.ok
      ? { ok: true, batch: fetched.batch }
      : { ok: false, error: `Stripe: ${fetched.reason}` };
  }

  if (source === "shopify") {
    const token = String(formData.get("token") ?? "").trim();
    const storeDomain = String(formData.get("storeDomain") ?? "").trim();
    if (!token || !storeDomain) {
      return { ok: false, error: "Paste your store address and an Admin API token." };
    }

    const fetched = await fetchShopify({ storeDomain, token });
    if (fetched.ok) return { ok: true, batch: fetched.batch };

    return { ok: false, error: SHOPIFY_REASONS[fetched.reason] ?? `Shopify: ${fetched.reason}` };
  }

  // Etsy, Gumroad and the plain CSV are all a spreadsheet.
  const csv = await readCsv(formData);
  if (!csv.ok) return csv;

  const rows = parse(csv.text);
  if (rows.length === 0) {
    return { ok: false, error: "No rows found — is the header row present?" };
  }

  const dialect = source === "etsy" ? "etsy" : source === "gumroad" ? "gumroad" : "csv";
  return {
    ok: true,
    batch: { source, ...mapTabular(rows, dialect, shop.currency) },
  };
}

/**
 * What each source is called, for the upgrade sentence.
 *
 * A refusal that says "This import is on Pro" is a refusal a seller cannot act
 * on when three of the five sources are free — naming the one they picked is
 * the difference between an upsell and a bug report.
 */
const SOURCE_NAMES: Partial<Record<ImportSource, string>> = {
  shopify: "Importing from Shopify",
  gumroad: "Importing from Gumroad",
};

const SHOPIFY_REASONS: Record<string, string> = {
  not_a_shopify_domain: "That doesn't look like a Shopify store address — it ends in .myshopify.com.",
  bad_token: "Shopify refused that token. Check it has read access to products.",
  store_not_found: "Shopify has no store at that address.",
  throttled: "Shopify is rate-limiting us. Wait a minute and try again.",
};

async function readCsv(formData: FormData): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const inline = String(formData.get("csv") ?? "");
  if (inline.trim()) return { ok: true, text: inline };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Choose a file first." };
  if (file.size === 0) return { ok: false, error: "That file is empty." };
  if (file.size > MAX_BYTES) return { ok: false, error: "Keep the file under 5 MB." };

  return { ok: true, text: await file.text() };
}
