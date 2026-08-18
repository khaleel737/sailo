/**
 * The web half of the design system.
 *
 * These components were `apps/web/src/components/{ui,overlays,shared}` until
 * the phone got a design system of its own and the two started answering the
 * same questions — what a card's radius is, what a disabled button looks like,
 * how a chart's cursor reads — from two files that nothing held together.
 * Both halves now sit over one set of tokens, so a colour cannot move on one
 * platform without moving on the other.
 *
 * WHAT IS HERE AND WHAT STAYED IN THE APP
 *
 * A component belongs here when it can be rendered without knowing anything
 * about Sailo: a Button, a Table, a Skeleton, a chart plot. A component that
 * calls a server action, reads a shop row or names the trading entity stayed in
 * `apps/web/src/components` — `handle-field`, `language-switcher`,
 * `powered-by`, the consent banners and the two subscribe forms. They are
 * screens' worth of product decisions wearing a component's shape, and moving
 * them would have made this package depend on the app it serves.
 *
 * `cn` is deliberately not re-exported from this barrel — see `./cn`.
 */

export * from "./button";
export * from "./card";
export * from "./feedback";
export * from "./form";
export * from "./progress";
export * from "./segmented-control";

/**
 * The stateful surfaces. They were split out of the kit so that importing a
 * Button never dragged a client bundle along; the split is kept, and the
 * barrel re-exports both halves because no caller cares which is which.
 */
export * from "./dialog";
export * from "./modal-layer";
export * from "./panel";

export * from "./skeleton";
export * from "./table";
export * from "./page-header";
export * from "./copy-link";
export * from "./local-time";
export * from "./live-refresh";
export * from "./route-progress";
export * from "./brand-icons";

/**
 * The wordmark, and the chrome that frames a signed-in panel.
 *
 * Both were `apps/web/src/components` until the staff panel moved to its own
 * deployment and needed them too. An app cannot import another app, so the
 * shared half came here — which is also where it belonged: a logo and a legal
 * footer are the two things every Sailo surface renders identically.
 *
 * apps/web still imports them from their old paths; those files are now
 * one-line re-exports, so nothing over there had to change.
 */
export * from "./brand";
export * from "./panel-footer";

/**
 * The evidence attachment row on a chargeback. Shared because both panels show
 * the same case from different sides: the seller's, in apps/web, and staff's,
 * in apps/hq. Presentation only — who may attach or remove a document is
 * decided by the action each app passes in.
 */
export * from "./evidence-files";

/**
 * The form chrome a sign-in page is built from. Shared because both apps have
 * one — apps/web's for sellers, apps/hq's for staff — and they should look
 * like the same company. It reads `--ink` and `--mute-*`, which are declared by
 * `auth-surface.css` here and by `.brand-surface` in apps/web; render it inside
 * one of those two or it inherits nothing.
 */
export * from "./auth-kit";
