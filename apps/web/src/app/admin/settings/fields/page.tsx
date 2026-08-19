import type { Metadata } from "next";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { fieldsFor } from "@sailo/marketing/contacts/server";
import { PageHeader } from "@sailo/design-system/web";
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
      <PageHeader
        title={a.broadcasts.fieldsTitle}
        description={a.broadcasts.fieldsDescription}
      />
      <FieldManager fields={fields} />
    </>
  );
}
