/**
 * Every message in one namespace, for the preview renderer alone.
 *
 * `preview.test.ts` renders one of each to HTML so a person can look at them
 * side by side, and "one of each" is the only caller that legitimately wants
 * all four audiences at once. Nothing that *sends* mail should import this —
 * the whole point of the `/transactional`, `/shop`, `/system` and `/lifecycle`
 * split is that a call site states which kind it is sending.
 */
export * from "./transactional";
export * from "./shop";
export * from "./system";
export * from "./lifecycle";
