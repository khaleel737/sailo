import type { Metadata } from "next";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { fieldsFor } from "@sailo/marketing/contacts/server";
import { FieldManager } from "./_components/field-manager";

export const metadata: Metadata = { title: "Custom fields" };

export const instant = false;

/**
 * Settings → Custom fields — spec 34.
 *
 * One table serves two surfaces, which is what `scope` is for: "what size are
 * you" asked at checkout and the same question on the contact card are one
 * field with one answer. Two tables would be two answers that disagree, and no
 * screen would be wrong.
 */
export default async function CustomFieldsPage() {
  const { shop } = await requireShop("settings:read");
  const { a } = await getAdminT();

  const fields = await fieldsFor(shop.id);

  return (
    <>
      {/* The overlay's rail names this section; only the intro stays here. */}
      <p className="mb-5 -mt-3 max-w-prose text-sm leading-relaxed text-ink-500">
        {a.broadcasts.fieldsDescription}
      </p>
      <FieldManager fields={fields} />
    </>
  );
}
