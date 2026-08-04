import { NextResponse } from "next/server";
import { getInvoiceByToken } from "@/lib/queries";
import { renderInvoicePdf } from "@/lib/invoice-pdf";

export async function GET(
  _request: Request,
  { params }: RouteContext<"/invoice/[token]/pdf">,
) {
  const { token } = await params;
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
