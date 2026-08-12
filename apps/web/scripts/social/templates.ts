/**
 * The post canvases.
 *
 * Same rule as `scripts/social-covers`: these borrow the product's design
 * language rather than inventing a marketing one. Tokens mirror `covers.css`,
 * the phone bezel mirrors `PhoneFrame`, and the only colour on the page comes
 * from the seller's own accent. Sailo is the neutral frame.
 *
 * Two canvases per post — a 1:1 for Instagram and a 1.91:1 for Facebook and
 * LinkedIn — authored at 1x here and captured at deviceScaleFactor 2, landing
 * on 1080x1080 and 1200x630 exactly.
 *
 * Craft notes, since a feed is a hostile viewing environment:
 * - Containers are nested (outer tray, inner plate) with concentric radii, so
 *   cards read as machined objects rather than divs with a border.
 * - Shadows are wide, low-opacity and warm-tinted; a hard grey drop shadow on
 *   a cream ground looks like a rendering bug at thumbnail size.
 * - Type is set large. A 1080px square is ~180px wide in a phone feed, so
 *   anything under ~26px at 1x is illegible where it actually gets seen.
 */
import type { Post } from "./content";

export type Canvas = "square" | "wide";
export type Tone = "paper" | "ink";

export const CANVAS = {
  square: { width: 540, height: 540 },
  wide: { width: 600, height: 315 },
} as const;

/** Accents lifted from the demo shops themselves, not chosen for the graphic. */
const ACCENT: Record<string, string> = {
  lumi: "#db2777",
  forno: "#c2410c",
  serene: "#14b8a6",
  demo: "#0d9488",
  inkwell: "#7c3aed",
};

const SHOP_NAME: Record<string, string> = {
  lumi: "sailo.store/lumi",
  forno: "sailo.store/forno",
  serene: "sailo.store/serene",
  demo: "sailo.store/demo",
  inkwell: "sailo.store/inkwell",
};

/**
 * Film grain. A fixed, pointer-events-free overlay at 3% — enough to stop the
 * flat cream reading as an empty PNG, not enough to survive JPEG recompression
 * as visible noise.
 */
const GRAIN =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="140"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3"/></filter><rect width="140" height="140" filter="url(#n)" opacity="0.55"/></svg>`,
  );

/**
 * Ink is the same palette inverted, not a second design.
 *
 * A feed is a hostile place for a cream card: it sits on a white app
 * background and reads as empty space. The product already has an ink surface
 * — `Section tone="ink"` carries the demos on the landing page — so a dark
 * post is on-brand rather than a departure, and alternating the two down the
 * library makes the profile *grid* look composed instead of accidental, which
 * is the surface a new visitor actually judges.
 */
const INK_TOKENS = `
  --paper: #0d0d0c;
  --paper-sunk: #17171500;
  --surface: #191816;
  --ink: #f7f6f2;
  --mute-100: #24231f;
  --mute-200: #2f2e29;
  --mute-300: #56544d;
  --mute-400: #97938a;
  --mute-500: #a8a49a;
  --signal: #2ecc84;
`;

function shell(canvas: Canvas, body: string, extraCss = "", tone: Tone = "paper"): string {
  const { width, height } = CANVAS[canvas];
  const ink = tone === "ink";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="../social-covers/fonts/fonts.css">
<style>
:root {
  --paper: #fbfbf9;
  --paper-sunk: #f6f5f1;
  --ink: #0d0d0c;
  --mute-100: #f0efea;
  --mute-200: #e0ddd5;
  --mute-300: #c2beb3;
  --mute-400: #75726c;
  --mute-500: #6f6b64;
  --signal: #12b76a;
  --pad: ${canvas === "square" ? "52px" : "44px"};
}
${ink ? `:root {${INK_TOKENS}}` : ""}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  position: relative;
  width: ${width}px;
  height: ${height}px;
  overflow: hidden;
  background: var(--paper);
  color: var(--ink);
  font-family: "Geist", ui-sans-serif, system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
/* Warm floor light: keeps the cream from going flat without adding a gradient
   the product itself doesn't use. */
body::before {
  content: "";
  position: absolute;
  inset: 0;
  background: ${ink
    ? "radial-gradient(120% 85% at 50% 0%, rgb(255 255 255 / 0.07) 0%, transparent 62%)"
    : "radial-gradient(120% 85% at 50% 0%, #ffffff 0%, transparent 60%)"};
  pointer-events: none;
}
body::after {
  content: "";
  position: absolute;
  inset: 0;
  background-image: url("${GRAIN}");
  opacity: ${ink ? "0.05" : "0.03"};
  pointer-events: none;
  z-index: 40;
}
.frame {
  position: relative;
  z-index: 2;
  width: 100%;
  height: 100%;
  padding: var(--pad);
  display: flex;
  flex-direction: column;
}
.display {
  font-family: "Outfit", "Geist", sans-serif;
  font-weight: 500;
  letter-spacing: -0.035em;
  line-height: 1.04;
}
/* The landing page's underline, skip-ink off — at cover sizes the gap a
   descender punches in the line reads as a broken render. */
em, .hl {
  font-style: normal;
  text-decoration-line: underline;
  text-decoration-color: var(--mute-300);
  text-decoration-thickness: 0.055em;
  text-underline-offset: 0.15em;
  text-decoration-skip-ink: none;
}
.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.75em;
  font-size: ${canvas === "square" ? "12px" : "11px"};
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  color: var(--mute-400);
}
.eyebrow .dot {
  width: 5px; height: 5px;
  border-radius: 999px;
  background: var(--signal);
}
.spacer { flex: 1; }
.foot {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}
.wordmark { height: ${canvas === "square" ? "22px" : "19px"}; display: block; }
.note {
  font-size: ${canvas === "square" ? "14px" : "12.5px"};
  color: var(--mute-400);
  letter-spacing: -0.01em;
  text-align: right;
  line-height: 1.35;
}
/* Doppelrand: an outer tray with a hairline ring, an inner plate with its own
   ground and a mathematically smaller radius so the curves stay concentric. */
.tray {
  background: ${ink ? "rgb(255 255 255 / 0.045)" : "var(--mute-100)"};
  border-radius: 26px;
  padding: 7px;
  box-shadow: ${ink
    ? "0 1px 0 rgb(255 255 255 / 0.05) inset, 0 0 0 1px rgb(255 255 255 / 0.06)"
    : "0 1px 0 rgb(255 255 255 / 0.7) inset, 0 0 0 1px rgb(13 13 12 / 0.045)"};
}
.plate {
  background: ${ink ? "var(--surface)" : "#fff"};
  border-radius: 19px;
  box-shadow: ${ink
    ? "0 0 0 1px rgb(255 255 255 / 0.05)"
    : "0 1px 1px rgb(13 13 12 / 0.03), 0 18px 36px -22px rgb(13 13 12 / 0.28)"};
}
${extraCss}
</style>
</head>
<body><div class="frame">${body}</div></body>
</html>`;
}

const logo = (tone: Tone) =>
  `<img class="wordmark" src="../../public/brand/sailo-logo${tone === "ink" ? "-white" : ""}.svg" alt="Sailo">`;
const LOGO = logo("paper");

function foot(note?: string, tone: Tone = "paper"): string {
  return `<div class="foot">${logo(tone)}${note ? `<div class="note">${note}</div>` : "<span></span>"}</div>`;
}

function phone(slug: string, dy = 0): string {
  return `<figure class="shop" style="--dy:${dy}px; --accent:${ACCENT[slug] ?? "#12b76a"}">
    <span class="pill"><span class="dot"></span>${SHOP_NAME[slug] ?? slug}</span>
    <div class="phone"><div class="screen"><img src="../../public/demos/${slug}-phone.png" alt=""></div></div>
  </figure>`;
}

const PHONE_CSS = `
.shops { display: flex; justify-content: center; align-items: flex-start; }
.shop {
  position: relative;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  transform: translateY(var(--dy, 0px));
  margin-left: -14px;
}
.shop:first-child { margin-left: 0; }
.shop:nth-child(2) { z-index: 2; }
.pill {
  display: inline-flex; align-items: center; gap: 0.55em;
  padding: 0.45em 0.95em;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 0 0 1px rgb(13 13 12 / 0.07), 0 6px 14px -8px rgb(13 13 12 / 0.3);
  color: var(--mute-500);
  font-size: var(--pill-size, 11.5px);
  letter-spacing: -0.01em;
  white-space: nowrap;
}
.pill .dot { width: 0.5em; height: 0.5em; border-radius: 999px; background: var(--accent); }
.phone {
  position: relative;
  width: var(--w);
  padding: calc(var(--w) * 0.0208);
  border-radius: calc(var(--w) * 0.14);
  background: var(--ink);
  box-shadow: 0 calc(var(--w) * 0.125) calc(var(--w) * 0.2917) calc(var(--w) * -0.125) rgb(11 11 12 / 0.5);
}
.phone::before {
  content: "";
  position: absolute; left: 50%; top: calc(var(--w) * 0.054);
  transform: translateX(-50%);
  width: calc(var(--w) * 0.1833);
  height: max(2px, calc(var(--w) * 0.0167));
  border-radius: 999px;
  background: rgb(255 255 255 / 0.25);
  z-index: 2;
}
/* The screenshots are full-length pages; left to their natural height they run
   off the bottom of the canvas. Cropping to a fixed portrait ratio from the top
   keeps the shop's header and first row of products — the part that carries the
   argument — and makes the phone's total height predictable enough to lay out. */
.screen {
  overflow: hidden;
  border-radius: calc(var(--w) * 0.12);
  height: calc(var(--w) * 1.62);
}
.screen img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top center;
}
`;

const s = (v: unknown) => String(v ?? "");
const toneOf = (p: Post): Tone => (s(p.art.tone) === "ink" ? "ink" : "paper");
const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);

/**
 * The 1.91:1 is 315px tall at 1x, which is not enough to stack a headline over
 * a list — the wordmark gets pushed off the bottom edge. Anything with a block
 * of content under the type therefore splits sideways on the wide canvas: type
 * and wordmark left, the block filling the right.
 */
const SPLIT_CSS = `
.split { display: flex; gap: 20px; height: 100%; align-items: stretch; }
.left { display: flex; flex-direction: column; width: 42%; flex: none; }
.right { flex: 1; display: flex; flex-direction: column; justify-content: center; min-width: 0; }
`;

function split(eyebrow: string, headline: string, right: string, tone: Tone = "paper"): string {
  return `<div class="split">
    <div class="left">
      <div class="eyebrow"><span class="dot"></span>${eyebrow}</div>
      <h1 class="display headline">${headline}</h1>
      <div class="spacer"></div>
      ${logo(tone)}
    </div>
    <div class="right">${right}</div>
  </div>`;
}

/* ---------------------------------------------------------------- templates */

function statement(post: Post, c: Canvas): string {
  const tone = toneOf(post);
  const size = c === "square" ? 54 : 40;
  return shell(
    c,
    `<div class="eyebrow"><span class="dot"></span>${s(post.art.eyebrow)}</div>
     <div class="spacer"></div>
     <h1 class="display headline">${s(post.art.headline)}</h1>
     <div class="spacer"></div>
     ${foot(s(post.art.footnote), tone)}`,
    `.headline { font-size: ${size}px; max-width: ${c === "square" ? "96%" : "78%"}; }
     .eyebrow { align-self: flex-start; }`,
    tone,
  );
}

function playbook(post: Post, c: Canvas): string {
  const tone = toneOf(post);
  const lines = arr(post.art.lines)
    .map(
      (l, i) => `<li><span class="idx">${String(i + 1).padStart(2, "0")}</span><span>${l}</span></li>`,
    )
    .join("");
  const tray = `<div class="tray listwrap"><ul class="plate list">${lines}</ul></div>`;
  return shell(
    c,
    c === "square"
      ? `<div class="eyebrow"><span class="dot"></span>${s(post.art.eyebrow)}</div>
         <div class="spacer"></div>
         <h1 class="display headline">${s(post.art.headline)}</h1>
         ${tray}
         <div class="spacer"></div>
         ${foot(undefined, tone)}`
      : split(s(post.art.eyebrow), s(post.art.headline), tray, tone),
    `${c === "square" ? "" : SPLIT_CSS}
     .headline { font-size: ${c === "square" ? 38 : 27}px; max-width: ${c === "square" ? "94%" : "100%"}; margin-top: ${c === "square" ? 0 : 12}px; }
     .listwrap { margin-top: ${c === "square" ? 26 : 0}px; }
     .list { list-style: none; padding: ${c === "square" ? "6px 8px" : "4px 8px"}; }
     .list li {
       display: flex; align-items: center; gap: 14px;
       padding: ${c === "square" ? "13px 14px" : "9px 12px"};
       font-size: ${c === "square" ? 17 : 14}px;
       letter-spacing: -0.015em;
       color: var(--ink);
     }
     .list li + li { border-top: 1px solid var(--mute-100); }
     .idx {
       font-family: "Outfit", sans-serif;
       font-size: ${c === "square" ? 12 : 10.5}px;
       color: var(--mute-300);
       letter-spacing: 0.06em;
       min-width: ${c === "square" ? 20 : 17}px;
     }`,
    tone,
  );
}

/**
 * Square stacks the phones under the headline; the 1.91:1 is too short for that
 * so it splits — type on the left, the shops filling the right. Same content,
 * two honest layouts, rather than one layout squeezed until it breaks.
 */
function phones(post: Post, c: Canvas): string {
  const tone = toneOf(post);
  const slugs = arr(post.art.shops);
  const square = c === "square";
  /*
   * Sized from the height budget, not by eye. A phone costs
   * pill + gap + w*1.62 + bezel, and the tallest column also carries the lift,
   * so an over-wide phone silently pushes the wordmark off the canvas.
   */
  const w = square ? 118 : 78;
  const lift = square ? 22 : 16;
  const body = slugs.map((slug, i) => phone(slug, i === 1 ? 0 : lift)).join("");

  if (square) {
    return shell(
      c,
      `<div class="eyebrow"><span class="dot"></span>${s(post.art.eyebrow)}</div>
       <h1 class="display headline">${s(post.art.headline)}</h1>
       <div class="shops">${body}</div>
       <div class="spacer"></div>
       ${foot(undefined, tone)}`,
      `${PHONE_CSS}
       .shop { --w: ${w}px; }
       .headline { font-size: 40px; margin-top: 16px; max-width: 90%; }
       .shops { margin-top: 30px; }`,
    );
  }

  return shell(
    c,
    `<div class="split">
       <div class="left">
         <div class="eyebrow"><span class="dot"></span>${s(post.art.eyebrow)}</div>
         <h1 class="display headline">${s(post.art.headline)}</h1>
         <div class="spacer"></div>
         ${LOGO}
       </div>
       <div class="shops">${body}</div>
     </div>`,
    `${PHONE_CSS}
     /* The address pills are wider than the phones they label and overhang on
        both sides, so the row's real width is the phones plus that overhang —
        which is what clips the last shop if only the phones are measured. */
     .shop { --w: ${w}px; --pill-size: 9.5px; margin-left: -12px; }
     .split { display: flex; gap: 20px; height: 100%; align-items: stretch; }
     .left { display: flex; flex-direction: column; width: 42%; flex: none; }
     .headline { font-size: 30px; margin-top: 14px; }
     .shops { flex: 1; align-items: center; justify-content: center; }`,
    tone,
  );
}

/**
 * Two columns, left dimmed. The green bullets on the right read as "this is the
 * recommended one", so a post where *both* options are the problem — the empty
 * middle argument — must opt out of them via `rightTone: "muted"`. Rendering
 * that post with the default would tell the reader the opposite of the caption.
 */
function contrast(post: Post, c: Canvas): string {
  const tone = toneOf(post);
  /*
   * Three tones, because a two-column comparison carries three different
   * arguments and only one of them is "pick the right-hand one".
   *
   *   default  right column is the recommendation — full strength, green
   *   muted    neither side is good (the empty-middle case) — both dimmed
   *   neutral  the right column is the important truth but not a thing to
   *            want, e.g. what a discount actually costs. Full strength so it
   *            carries the post, grey bullets so it doesn't read as advice.
   */
  const rightTone = s(post.art.rightTone);
  const muted = rightTone === "muted";
  const plainBullets = muted || rightTone === "neutral";
  const col = (label: string, lines: string[], dim: boolean) => `
    <div class="tray col${dim ? " dim" : ""}">
      <div class="plate colin">
        <div class="collabel">${label}</div>
        <ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul>
      </div>
    </div>`;
  const cols = `<div class="cols">
       ${col(s(post.art.leftLabel), arr(post.art.leftLines), true)}
       ${col(s(post.art.rightLabel), arr(post.art.rightLines), false)}
     </div>`;
  return shell(
    c,
    c === "square"
      ? `<div class="eyebrow"><span class="dot"></span>${s(post.art.eyebrow)}</div>
         <h1 class="display headline">${s(post.art.headline)}</h1>
         ${cols}
         <div class="spacer"></div>
         ${foot(s(post.art.footnote), tone)}`
      : split(s(post.art.eyebrow), s(post.art.headline), cols, tone),
    `${c === "square" ? "" : SPLIT_CSS}
     .headline { font-size: ${c === "square" ? 38 : 27}px; margin-top: ${c === "square" ? 16 : 12}px; max-width: ${c === "square" ? "86%" : "100%"}; }
     /* The spacer below collapses to nothing when the columns run tall, which
        walks the cards into the wordmark; the explicit margin is the floor. */
     .cols {
       display: grid; grid-template-columns: 1fr 1fr;
       gap: ${c === "square" ? 14 : 10}px;
       margin-top: ${c === "square" ? 22 : 0}px;
       margin-bottom: ${c === "square" ? 26 : 0}px;
     }
     .col.dim { opacity: 0.62; }
     .colin { padding: ${c === "square" ? "16px 16px 18px" : "12px 12px 13px"}; height: 100%; }
     .collabel {
       font-size: ${c === "square" ? 11 : 9.5}px;
       text-transform: uppercase; letter-spacing: 0.16em;
       color: var(--mute-400);
       padding-bottom: ${c === "square" ? 11 : 8}px;
       border-bottom: 1px solid var(--mute-100);
     }
     .colin ul { list-style: none; margin-top: ${c === "square" ? 11 : 8}px; }
     .colin li {
       font-size: ${c === "square" ? 15 : 12}px;
       letter-spacing: -0.015em;
       padding: ${c === "square" ? "5px 0" : "3.5px 0"};
       display: flex; gap: 9px; align-items: baseline;
     }
     .colin li::before {
       content: ""; flex: none;
       width: 4px; height: 4px; border-radius: 999px;
       background: var(--mute-300);
       transform: translateY(-2px);
     }
     .col:not(.dim) .colin li::before { background: ${plainBullets ? "var(--mute-300)" : "var(--signal)"}; }
     ${muted ? ".col:not(.dim) { opacity: 0.62; }" : ""}`,
    tone,
  );
}

function stat(post: Post, c: Canvas): string {
  const tone = toneOf(post);
  return shell(
    c,
    `<div class="eyebrow"><span class="dot"></span>${s(post.art.eyebrow)}</div>
     <div class="spacer"></div>
     <div class="figure">
       <span class="display value">${s(post.art.value)}</span>
       <span class="unit">${s(post.art.unit)}</span>
     </div>
     <h1 class="display headline">${s(post.art.headline)}</h1>
     <div class="spacer"></div>
     ${foot(s(post.art.footnote), tone)}`,
    `.figure { display: flex; align-items: baseline; gap: ${c === "square" ? 14 : 10}px; }
     .value { font-size: ${c === "square" ? 150 : 104}px; line-height: 0.86; letter-spacing: -0.05em; }
     .unit {
       font-size: ${c === "square" ? 22 : 17}px;
       color: var(--mute-400);
       letter-spacing: -0.02em;
     }
     .headline {
       font-size: ${c === "square" ? 34 : 25}px;
       margin-top: ${c === "square" ? 22 : 14}px;
       max-width: ${c === "square" ? "88%" : "68%"};
     }`,
    tone,
  );
}

const RENDERERS: Record<Post["template"], (p: Post, c: Canvas) => string> = {
  statement,
  playbook,
  phones,
  contrast,
  stat,
};

export function html(post: Post, canvas: Canvas): string {
  return RENDERERS[post.template](post, canvas);
}
