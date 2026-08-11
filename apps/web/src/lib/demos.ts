import type { MarketingDictionary } from "@/i18n/marketing";

/**
 * The showcase shops the landing page puts on display.
 *
 * Deliberately a static list rather than a query. The screenshots beside it
 * are committed files, so reading the live rows would only let the two drift —
 * and it would put the marketing page, the one page that has to render for a
 * stranger on a bad connection, behind a database call it doesn't need.
 *
 * Kept in step by hand with `scripts/seed-demos.ts` (and `scripts/seed.ts` for
 * `/demo`). Change a handle there, change it here, and re-run `npm run shots`.
 */
export type Demo = {
  handle: string;
  name: string;
  /** The fake account the link lives in — the whole point of the hero. */
  instagram: string;
  city: string;
  /** The shop's own accent, so the gallery tab matches the page it opens. */
  accent: string;
  /** Which of the two screenshot pairs is dark, for the frame's chrome. */
  theme: "light" | "dark";
  kicker: keyof MarketingDictionary["demos"];
  line: keyof MarketingDictionary["demos"];
};

const CLAY: Demo = {
  handle: "demo",
  name: "Clay & Co.",
  instagram: "clayandco",
  city: "Portland",
  accent: "#b45309",
  theme: "light",
  kicker: "d1kicker",
  line: "d1line",
};

const FORNO: Demo = {
  handle: "forno",
  name: "Forno Nove",
  instagram: "fornonove",
  city: "Naples",
  accent: "#c2410c",
  theme: "light",
  kicker: "d2kicker",
  line: "d2line",
};

const LUMI: Demo = {
  handle: "lumi",
  name: "Lumière Nails",
  instagram: "lumierenails",
  city: "Paris",
  accent: "#db2777",
  theme: "light",
  kicker: "d3kicker",
  line: "d3line",
};

const SERENE: Demo = {
  handle: "serene",
  name: "Serenity Rooms",
  instagram: "serenityrooms",
  city: "Austin",
  accent: "#14b8a6",
  theme: "dark",
  kicker: "d4kicker",
  line: "d4line",
};

const INKWELL: Demo = {
  handle: "inkwell",
  name: "Inkwell Press",
  instagram: "inkwellpress",
  city: "Berlin",
  accent: "#6366f1",
  theme: "dark",
  kicker: "d5kicker",
  line: "d5line",
};

/** Gallery order. The pottery studio leads because it is the oldest demo. */
export const DEMOS: Demo[] = [CLAY, FORNO, LUMI, SERENE, INKWELL];

/** The one the hero uses to tell the bio-link story. */
export const HERO_DEMO = FORNO;

/** The shop captured a second time with the language cookie set to Arabic. */
export const RTL_DEMO = FORNO;

export const shotUrl = (handle: string) => `/demos/${handle}.png`;
export const phoneShotUrl = (handle: string) => `/demos/${handle}-phone.png`;
export const rtlShotUrl = (handle: string) => `/demos/${handle}-rtl-phone.png`;
