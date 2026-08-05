"use server";

import { revalidatePath } from "next/cache";
import { revalidateShop } from "@/lib/cache";
import { requireShop } from "@/lib/session";
import {
  importClients,
  importProducts,
  isImportType,
  type ImportReport,
} from "@/lib/importers";

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
  const { shop } = await requireShop();

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
            plan: shop,
          })
        : await importClients({ shopId: shop.id, csv, dryRun: !commit });

    if (report.parsed === 0) {
      return { ok: false, error: "No rows found — is the header row present?" };
    }

    if (commit) {
      revalidatePath("/admin/products");
      revalidatePath("/admin/clients");
      revalidatePath("/admin/categories");
      revalidatePath(`/${shop.handle}`);
      // The catalogue is cached per shop; a write has to drop it.
      revalidateShop(shop.id, shop.handle);
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
