/**
 * How a thing is shaped for somebody outside Sailo.
 *
 * One serialiser per resource, used by both the public REST API and the
 * outbound webhook payloads. That sharing is the whole point: an integrator who
 * reads `GET /api/v1/orders/{id}` and subscribes to `order.paid` must be handed
 * the same object, or every field they map is a guess.
 */
export * from "./resources";
