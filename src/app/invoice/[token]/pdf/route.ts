import { NextResponse } from "next/server";
import { getInvoiceByToken } from "@/lib/queries";
import { renderInvoicePdf } from "@/lib/invoice-pdf";
import { rateLimit } from "@/lib/redis";

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
  const gate = await rateLimit(`invoice-pdf:${token}`, 20, 300);
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
