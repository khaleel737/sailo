import { NextResponse } from "next/server";
import { getInvoiceByToken } from "@/lib/queries";
import { renderInvoicePdf } from "@/lib/invoice-pdf";
import { rateLimit } from "@sailo/rate-limit";
import { callerIp } from "@sailo/rate-limit/client-ip";

export async function GET(
  _request: Request,
  { params }: RouteContext<"/invoice/[token]/pdf">,
) {
  const { token } = await params;

  /*
   * Public — the token is the credential, so a buyer can fetch their own
   * invoice without an account — and every request renders a PDF from
   * scratch. That is CPU a caller chooses to spend on our behalf, so it gets a
   * ceiling like every other public route.
   *
   * Keyed on the token as well as the address: a buyer refreshing their own
   * invoice is normal, and one token being hammered is the thing worth
   * stopping. Fails open, like the rest.
   */
  /*
   * Two ceilings, because one of them is bypassable on its own.
   *
   * The token key bounds what any single link can cost — which is the point,
   * since the token is what identifies the thing being spent. But the token
   * comes from the URL, so a caller who makes up a new one each time gets a
   * fresh bucket every request: the limit never binds, and each attempt still
   * costs a Redis round trip and a database lookup before it 404s. The address
   * key is what bounds *that*, and it sits first so a made-up token is refused
   * before it can buy a query.
   */
  const byCaller = await rateLimit(`invoice-ip:${await callerIp()}`, 120, 300);
  if (!byCaller.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const gate = await // DECISION B — fails closed. Same argument as the download token: an
  // invoice names a buyer, their address and what they bought.
  rateLimit(`invoice-pdf:${token}`, 20, 300, { onOutage: "closed" });
  if (!gate.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const data = await getInvoiceByToken(token);
  if (!data) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const pdf = await renderInvoicePdf(data);

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${data.invoice.number}.pdf"`,
      "Content-Length": String(pdf.length),
      // The token is unguessable but the contents are personal.
      "Cache-Control": "private, no-store",
    },
  });
}
