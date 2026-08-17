import { getProduct } from "@sailo/api/rest";
import { handleOne } from "@sailo/api/rest";

/** `GET /api/v1/products/{id}` — one product, with its variants. */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/products/[id]">,
) {
  const { id } = await params;
  return handleOne(request, (caller) => getProduct(caller, id));
}
