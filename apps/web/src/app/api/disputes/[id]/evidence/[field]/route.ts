import { NextResponse } from "next/server";
import { evidenceFileLink } from "@sailo/commerce/disputes";
import { authoriseDisputeFiles } from "@/lib/dispute-access";

/**
 * Look at a document that is already on a dispute.
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
 * Staff by default, because /hq is where evidence is reviewed. `?as=seller`
 * takes the ownership path instead, for a seller checking what they attached.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/disputes/[id]/evidence/[field]">,
) {
  const { id, field } = await params;
  const as =
    new URL(request.url).searchParams.get("as") === "seller" ? "seller" : "staff";

  const access = await authoriseDisputeFiles(id, as);
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
