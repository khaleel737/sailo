/**
 * The shape a due delivery has once it is joined to its endpoint.
 *
 * Its own file because `./queue` produces it and `./attempt` consumes it, and a type
 * imported from whichever module happens to declare it is how two modules end up
 * importing each other.
 */

/** One due delivery joined to the endpoint it is bound for. */
export type EndpointRow = {
  id: string;
  endpointId: string;
  event: string;
  payload: unknown;
  url: string;
  secret: string;
  isActive: boolean;
};
