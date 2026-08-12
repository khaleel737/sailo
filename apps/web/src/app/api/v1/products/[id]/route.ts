import { getProduct } from "@/lib/api/handlers";
import { handleOne } from "@/lib/api/route";

/** `GET /api/v1/products/{id}` — one product, with its variants. */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/products/[id]">,
) {
  const { id } = await params;
  return handleOne(request, (caller) => getProduct(caller, id));
}
