/**
 * The translation pipeline's pure half.
 *
 * Everything here is string manipulation and diffing — no network, no model, no
 * dependencies. `@sailo/i18n` is imported by apps/api and by the React Native
 * app, and keeping it dependency-free is what stops a build tool's requirement
 * landing on either of them. The model call lives in `scripts/i18n/`.
 */
export * from "./gaps";
export * from "./glossary";
export * from "./splice";
export * from "./placeholders";
export * from "./report";
