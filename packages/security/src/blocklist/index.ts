/**
 * Whether a shop's mail can be trusted to leave the building.
 *
 * `check` asks the public blocklists whether our sending IP or domain is
 * listed; `state` remembers the answer so every send does not re-ask; `alert`
 * tells the staff when it turns bad. Together they are the gate that stops a
 * shop broadcasting from a reputation that is already burnt.
 */
export * from "./check";
export * from "./state";
export * from "./alert";
