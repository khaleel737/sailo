/**
 * The internal platform view.
 *
 * Split by the question each part answers. `@/lib/hq` still resolves here.
 *
 * Every query in these modules opens with `requireStaff()`. The /hq layout
 * checks too, but Next renders a layout and its page in parallel, so a
 * layout's refusal is not proof the page's reads never ran. These functions
 * read across every account on the platform; the guard belongs on the reads
 * themselves. `getSession` is request-cached, so the repetition costs one
 * lookup per request, not one per call.
 */

export * from "./pagination";
export * from "./roster";
export * from "./billing-state";
export * from "./overview";
export * from "./accounts";
export * from "./subscriptions";
export * from "./lists";
export * from "./partners";
export * from "./support";
export * from "./security";
export * from "./disputes";
export * from "./system";
export * from "./marketing";
export * from "./exports";
