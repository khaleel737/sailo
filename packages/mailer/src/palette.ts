/**
 * The inks, and the one substitution email needs.
 *
 * Separated because these are decisions rather than code, and because the reason for the
 * substitution has to survive somebody "aligning email with the app": the app's faint grey
 * reads at 3.2:1 on white, under the 4.5:1 floor small text needs, so email uses a darker
 * one. A palette in the same file as the layout is a palette that gets tidied.
 */

import { absolute } from "@sailo/core/origin";

/* --------------------------------------------------------------------------
   Palette

   The app's own inks, with one substitution. The app's faint grey #8e8e9c
   reads at 3.2:1 on white — under the 4.5:1 floor small text needs — so email
   fine print uses #6b6b78 instead: the same grey the footer already had to
   adopt for exactly this reason, at 4.9:1. Nothing in an email may be lighter.
-------------------------------------------------------------------------- */

export const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
export const INK = "#1a1a20";
export const MUTED = "#565664";
export const FAINT = "#6b6b78";
export const BORDER = "#e6e6ea";
export const HAIRLINE = "#ededf0";
export const CANVAS = "#f7f7f8";
export const WELL = "#f6f6f8";
/** The leaf's green — Sailo's own mail wears it; a shop's mail wears its own accent. */
export const BRAND_GREEN = "#037740";

/* --------------------------------------------------------------------------
   The footer line

   Two things were wrong with it and they compounded. The badge was #b8b8c2 on
   a #f7f7f8 background — 1.84:1, where 4.5:1 is the floor for text this size —
   so on most screens it simply was not there. And it was never a link, so the
   one visitor who did read it had nothing to press. The free tier's whole
   argument is that a shop's own mail is a distribution channel; an invisible,
   unclickable, untagged line is not a channel.

   #6b6b78 clears the floor at 4.90:1 and stays quieter than the body text
   above it. The name itself carries the app's ink so it reads as the pressable
   part, underlined because an email has none of the hover affordances a page
   has and the underline is the only thing saying "link".
-------------------------------------------------------------------------- */

export const FOOTER = "max-width:560px;margin:16px auto 0;text-align:center;font-size:12px;color:#6b6b78;";
export const FOOTER_LINK = "color:#1a1a20;font-weight:600;text-decoration:underline;";

/**
 * The Sailo mark, as a hosted PNG. Gmail strips SVG, so the email build of the
 * logo is a raster export of the same leaf — 112px for a 28px slot, which
 * keeps it crisp on a 4× phone screen at under 3KB.
 */
export const SAILO_MARK_SRC = absolute("/brand/email/sailo-mark.png");
