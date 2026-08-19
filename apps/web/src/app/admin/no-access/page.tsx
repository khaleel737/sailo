import type { Metadata } from "next";
import Link from "next/link";
import { ShieldOff } from "lucide-react";
import { Card } from "@sailo/design-system/web";
import { getAdminT } from "@/i18n/server";
import { interpolate } from "@sailo/i18n";
import { SHOP_PERMISSIONS } from "@sailo/auth/permissions";

export const metadata: Metadata = { title: "No access", robots: { index: false } };
export const instant = false;

/**
 * Where `requireShop` sends somebody whose role does not cover what they asked
 * for — spec 37.
 *
 * A refusal has to *be* a refusal. The alternative this replaces is a blank
 * screen or a 404, and both are indistinguishable from a bug: a colleague hits
 * one, assumes Sailo is broken, and tells the owner the admin is down rather
 * than that they need a permission.
 *
 * Deliberately not `forbidden()`. That needs an experimental flag and — more
 * decisively — renders for a *navigation*, while two thirds of `requireShop`'s
 * callers are Server Actions, where a thrown interrupt surfaces as an error
 * nobody can read. A redirect behaves the same way in both.
 */
export default async function NoAccessPage(props: PageProps<"/admin/no-access">) {
  const { a } = await getAdminT();
  const params = await props.searchParams;

  /*
   * Echoed back only if it is one of ours. The value arrives in a query string,
   * so rendering it unchecked would be a small reflected-content hole on a page
   * a signed-in person is looking at — and there is no reason to accept an
   * arbitrary string when the set is fifteen known values.
   */
  const raw = Array.isArray(params.need) ? params.need[0] : params.need;
  const permission =
    raw && (SHOP_PERMISSIONS as readonly string[]).includes(raw) ? raw : null;

  return (
    <Card className="mx-auto max-w-md space-y-3 p-6 text-center">
      <ShieldOff className="mx-auto size-8 text-ink-400" />
      <h1 className="text-lg font-semibold tracking-tight">{a.settings.noAccessTitle}</h1>
      <p className="text-sm text-ink-500">
        {permission
          ? interpolate(a.settings.noAccessBody, { permission })
          : a.settings.noAccessTitle}
      </p>
      <Link href="/admin" className="inline-block text-sm font-medium underline">
        {a.settings.noAccessBack}
      </Link>
    </Card>
  );
}
