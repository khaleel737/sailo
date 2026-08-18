import { NextResponse } from "next/server";
import { evidenceFileLink } from "@sailo/commerce/disputes";
import { authoriseDisputeFiles } from "@/lib/dispute-access";

/**
 * Look at a document that is already on a dispute, as staff.
 *
 * Staging evidence exists so a person can read it before it goes, and a person
 * cannot read a `file_1Abc…`. Stripe serves the bytes only through a `FileLink`,
 * so this mints one and redirects — there is no stored URL to leak, and the link
 * it issues expires in half an hour.
 *
 * Authorised exactly as the upload is, through the same function. A preview that
 * checked less than the write would be the more dangerous of the two: a document
 * on a dispute names a buyer, an address and what they bought.
 *
 * THE SECOND COPY, AND WHY
 * apps/web has this route too, for a seller checking their own case. This one
 * exists because the dispute detail page builds a *relative* preview URL, so on
 * hq.sailo.store the route has to be on hq.sailo.store — the panel's preview
 * links pointed at a path this deployment did not serve until this file.
 *
 * The `?as=seller` switch is gone with the copy. apps/web's version reads that
 * parameter to choose between two guards; here there is only one caller and
 * only one guard, which is the better shape: the authority you get is decided
 * by which origin you reached, not by a query string you supplied.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/disputes/[id]/evidence/[field]">,
) {
  const { id, field } = await params;

  const access = await authoriseDisputeFiles(id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: 403 });
  }

  const url = await evidenceFileLink({ disputeId: id, field });
  if (!url) {
    return NextResponse.json(
      { error: "That document is no longer on this dispute." },
      { status: 404 },
    );
  }

  /*
   * 302 rather than 301. The link behind it is short-lived, and a permanent
   * redirect would be cached by the browser and then serve a dead Stripe URL
   * for as long as it kept it.
   */
  return NextResponse.redirect(url, 302);
}
