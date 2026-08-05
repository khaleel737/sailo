import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { clients } from "@/db/schema";
import { field } from "@/lib/csv";
import { normalizePhone } from "@/lib/utils";
import { parse } from "./parse";
import type { ImportReport } from "./types";

/** Importing a customer list. */

export async function importClients(opts: {
  shopId: string;
  csv: string;
  dryRun: boolean;
}): Promise<ImportReport> {
  const db = getDb();
  const rows = parse(opts.csv);
  const report: ImportReport = {
    type: "clients",
    parsed: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    preview: [],
  };

  // Within one file, the same person must not create two rows.
  const seen = new Set<string>();

  for (const [index, raw] of rows.entries()) {
    const line = index + 2;

    const first = field(raw, "First Name", "Firstname");
    const last = field(raw, "Last Name", "Lastname");
    const name =
      field(raw, "Name", "Customer Name") || [first, last].filter(Boolean).join(" ");

    const email = field(raw, "Email", "Email Address").toLowerCase() || null;
    const phoneRaw = field(raw, "Phone", "Phone Number");
    const phone = phoneRaw ? normalizePhone(phoneRaw) || null : null;

    if (!email && !phone) {
      report.errors.push({
        row: line,
        message: "Needs an email or a phone number to identify the customer",
      });
      report.skipped += 1;
      continue;
    }
    if (email && !email.includes("@")) {
      report.errors.push({ row: line, message: `"${email}" is not a valid email` });
      report.skipped += 1;
      continue;
    }

    const key = email ?? `phone:${phone}`;
    if (seen.has(key)) {
      report.errors.push({
        row: line,
        message: `Duplicate of an earlier row (${key})`,
      });
      report.skipped += 1;
      continue;
    }
    seen.add(key);

    // One of the two is present — the row was skipped above otherwise — and
    // binding the matcher here is what makes that visible to the compiler
    // rather than asserted at the point of use.
    const match = email
      ? eq(clients.email, email)
      : phone
        ? eq(clients.phone, phone)
        : null;
    if (!match) {
      report.errors.push({ row: line, message: "No email or phone to match on" });
      report.skipped += 1;
      continue;
    }

    const existing = await db.query.clients.findFirst({
      where: and(eq(clients.shopId, opts.shopId), match),
    });

    if (opts.dryRun) {
      report.preview.push({
        row: line,
        label: name || email || phone || "Unnamed",
        action: existing ? "update" : "create",
      });
      if (existing) report.updated += 1;
      else report.created += 1;
      continue;
    }

    const address = {
      addressLine1: field(raw, "Address1", "Address", "Street") || null,
      addressLine2: field(raw, "Address2", "Apartment") || null,
      city: field(raw, "City") || null,
      region: field(raw, "Province", "State", "Region") || null,
      postalCode: field(raw, "Zip", "Postal Code", "Postcode") || null,
      country: field(raw, "Country") || null,
    };
    // Never blank a stored value because this file didn't carry it.
    const addressUpdate = Object.fromEntries(
      Object.entries(address).filter(([, v]) => v !== null),
    );

    const notes = field(raw, "Note", "Notes") || null;

    if (existing) {
      await db
        .update(clients)
        .set({
          name: name || existing.name,
          email: email ?? existing.email,
          phone: phone ?? existing.phone,
          ...addressUpdate,
          notes: notes ?? existing.notes,
          updatedAt: new Date(),
        })
        .where(eq(clients.id, existing.id));
      report.updated += 1;
    } else {
      await db.insert(clients).values({
        shopId: opts.shopId,
        name: (name || email || phone || "Customer").slice(0, 120),
        email,
        phone,
        ...address,
        notes,
      });
      report.created += 1;
    }
  }

  return report;
}
