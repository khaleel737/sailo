"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { revalidateShop } from "@/lib/cache";
import { publishShopEvent } from "@sailo/events";
import { requireShop } from "@/lib/session";
import {
  importClients,
  importProducts,
  importTickets,
  isImportType,
  type ImportReport,
} from "@/lib/import";

export type ImportState =
  | { ok: false; error?: string }
  | { ok: true; report: ImportReport; committed: boolean };

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Two-step by design: the first submit is a dry run that reports what would
 * happen, the second commits. Nothing is written until the seller confirms.
 */
export async function runImport(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const { shop } = await requireShop("products:write");

  const type = String(formData.get("type") ?? "");
  if (!isImportType(type)) return { ok: false, error: "Unknown import type." };

  const commit = formData.get("commit") === "1";
  const inlineCsv = String(formData.get("csv") ?? "");
  const file = formData.get("file");

  let csv = inlineCsv;
  if (!csv && file instanceof File) {
    if (file.size === 0) return { ok: false, error: "That file is empty." };
    if (file.size > MAX_BYTES) {
      return { ok: false, error: "Keep the file under 5 MB." };
    }
    csv = await file.text();
  }

  if (!csv.trim()) return { ok: false, error: "Choose a CSV file first." };

  try {
    const report =
      type === "products"
        ? await importProducts({
            shopId: shop.id,
            csv,
            dryRun: !commit,
            currency: shop.currency,
            plan: shop,
          })
        : type === "tickets"
          ? await importTickets({
              shopId: shop.id,
              csv,
              dryRun: !commit,
              // Set when the importer was opened from an event's own door, so
              // a file with no Event column still knows which room it is for.
              defaultProductId:
                String(formData.get("productId") ?? "") || null,
            })
          : await importClients({ shopId: shop.id, csv, dryRun: !commit });

    if (report.parsed === 0) {
      return { ok: false, error: "No rows found — is the header row present?" };
    }

    if (commit) {
      revalidatePath("/admin/products");
      revalidatePath("/admin/clients");
      revalidatePath("/admin/categories");
      revalidatePath("/admin/checkin", "layout");
      revalidatePath(`/${shop.handle}`);
      // The catalogue is cached per shop; a write has to drop it.
      revalidateShop(shop.id, shop.handle);
      // A door screen open on somebody's phone has just gained names, and it
      // is the one screen where a stale list is somebody standing outside.
      after(() =>
        publishShopEvent(shop.id, type === "tickets" ? "booking" : "catalog"),
      );
    }

    return { ok: true, report, committed: commit };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Couldn't read that file: ${error.message}`
          : "Couldn't read that file.",
    };
  }
}
