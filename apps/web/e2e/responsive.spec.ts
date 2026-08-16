import { expect, test, type Page } from "@playwright/test";

/**
 * The admin panel, measured at the sizes it is actually used at.
 *
 * WHY THIS EXISTS
 *
 * Every other suite here drives the panel at one width — `Desktop Chrome`, the
 * only project in `playwright.config.ts` until this file arrived. So the panel
 * had a mobile layout that nothing checked, and the faults it grew were the
 * ones a desktop run cannot see by construction:
 *
 *   - The four filter selects on Orders were 36pt tall, and the two per row
 *     that move an order to Cancelled or Refunded were 32pt. Under a mouse
 *     that is density; under a thumb it is the wrong order refunded.
 *   - The client rows were 36pt, so the tap target for "open this person's
 *     record" was shorter than the gap between two of them.
 *   - Nine formatting buttons in the broadcast composer were 32pt squares
 *     packed edge to edge.
 *   - The header's "View shop" link and the language switcher were 36pt and
 *     30pt — invisible as a fault, because that header is `lg:flex` and does
 *     not render on a phone at all. It renders on an iPad, which is 1024pt
 *     wide *and* a touch screen.
 *
 * None of those fail a type check, and none of them are visible in a
 * screenshot: a 32pt button looks fine. They are only findable by measuring,
 * which is what this does.
 *
 * WHAT IT MEASURES, AND WHY THOSE THREE
 *
 *   1. **Horizontal overflow.** The one fault that makes a page feel broken
 *      rather than tight. Checked as the document being wider than the window,
 *      which is what a person experiences as "it scrolls sideways".
 *   2. **Text-entry font size.** Safari zooms the page when a field under 16px
 *      takes focus and never zooms back out, so one tap on one field leaves the
 *      seller in a viewport they have to pinch their way out of.
 *   3. **Touch-target height.** 44pt is Apple's floor and the one this codebase
 *      already keeps elsewhere via `pointer-coarse:`. Measured against the
 *      enclosing `<label>` where there is one, because tapping a label
 *      activates its control — a 14pt checkbox in a 44pt row is fine.
 *
 * HOW IT AUTHENTICATES, AND WHY IT SKIPS BY DEFAULT
 *
 * The panel is behind a session, so this has to sign in. It only ever issues
 * GETs afterwards — no form is submitted and no row is written — but the
 * credentials still have to come from somewhere, and this repo's `.env.local`
 * points at production. So it takes them from the environment and skips when
 * they are absent, the same latch `journey.spec.ts` uses:
 *
 *   E2E_SELLER_EMAIL=... E2E_SELLER_PASSWORD=... npx playwright test e2e/responsive.spec.ts
 *
 * Run it against a seeded local stack (`scripts/seed.ts` prints the demo
 * login) rather than against a real seller.
 */

const EMAIL = process.env.E2E_SELLER_EMAIL;
const PASSWORD = process.env.E2E_SELLER_PASSWORD;

/**
 * The shop the public sweep reads.
 *
 * A handle rather than a fixture: the storefront is generated from a real
 * seller's catalogue, and a hard-coded HTML fixture of one would stop
 * resembling the thing it stands for the first time the template changes.
 * `scripts/seed.ts` creates `demo`; override for another database.
 */
const SHOP = process.env.E2E_SHOP_HANDLE ?? "demo";

/**
 * The widths worth checking, and why each one is here rather than a device.
 *
 * `bp-avoid-device-widths` — breakpoints belong where the content breaks, not
 * where a phone happens to be — but a *test* is the opposite case: it wants the
 * real sizes people hold. These four are the narrowest screen still in use, the
 * common phone, the tablet width that lands *below* the `lg` breakpoint and so
 * gets the phone chrome, and the one that lands above it and gets the desktop
 * rail with a finger on it.
 */
const VIEWPORTS = [
  { name: "narrow phone", width: 320, height: 568 },
  { name: "phone", width: 390, height: 844 },
  { name: "tablet portrait", width: 744, height: 1133 },
  { name: "tablet landscape", width: 1024, height: 1366 },
] as const;

/**
 * The routes anyone can reach, and the reason they are checked *harder* than
 * the admin rather than as an afterthought.
 *
 * The admin is a tool a seller learns; a storefront is a page a stranger opens
 * once, on a phone, having tapped a link in a message. If a product page
 * scrolls sideways or the Add to basket button is 36pt, nobody files a bug —
 * they leave, and the seller sees a number that does not go up.
 *
 * These need no session, so unlike the admin sweep below they run on every
 * `playwright test` with no credentials and no seeded seller — which is what
 * makes them a real gate rather than one that only fires when somebody
 * remembers to set two environment variables.
 */
const PUBLIC_ROUTES = [
  // The storefront, in the order a buyer meets it.
  `/${SHOP}`,
  `/${SHOP}/subscribe`,
  `/${SHOP}/affiliate`,
  // Marketing and docs.
  "/",
  "/pricing",
  "/blog",
  "/docs",
  "/docs/api",
  "/docs/webhooks",
  // Everywhere a password or an email address is typed.
  "/login",
  "/signup",
  "/forgot-password",
  "/hq/login",
  // The pages a regulator and a buyer both read on a phone.
  "/privacy",
  "/terms",
  "/refunds",
  "/gdpr",
  "/anti-spam",
] as const;

/** Every admin route that renders without an id from the database. */
const ROUTES = [
  "/admin",
  "/admin/products",
  "/admin/products/new",
  "/admin/categories",
  "/admin/orders",
  "/admin/checkin",
  "/admin/clients",
  "/admin/members",
  "/admin/reviews",
  "/admin/coupons",
  "/admin/broadcasts",
  "/admin/broadcasts/new",
  "/admin/affiliates",
  "/admin/payments",
  "/admin/delivery",
  "/admin/settings",
  "/admin/settings/billing",
  "/admin/settings/data",
  "/admin/settings/integrations",
  "/admin/settings/security",
  "/admin/support",
] as const;

/** Apple's floor, and the one `pointer-coarse:min-h-11` keeps. */
const MIN_TARGET = 44;

/** Below this, Safari zooms on focus and does not zoom back. */
const MIN_FIELD_FONT = 16;

/**
 * Answer the cookie question before the first paint.
 *
 * Not a convenience: the banner is `fixed bottom-3`, so on a 568pt window it
 * covers the bottom of the page — including, on `/login`, the submit button.
 * Every measurement below would otherwise be of the banner.
 */
async function acceptConsent(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem(
        "sailo_consent",
        JSON.stringify({ analytics: "denied", version: 1, at: "2020-01-01T00:00:00.000Z" }),
      );
    } catch {
      // Private browsing. The banner shows and the run reports it, which is
      // the safe direction to fail in.
    }
  });
}

async function signIn(page: Page) {
  await acceptConsent(page);
  /*
   * `networkidle`, not `domcontentloaded`, and the difference is not
   * flakiness-padding.
   *
   * The sign-in form is a client component whose `onSubmit` calls
   * `preventDefault`. Until it hydrates it is plain HTML, so a click on the
   * button submits it the way the browser would — which is how this suite
   * found that the form had no `method` and was therefore submitting the
   * password as a GET query string. That is fixed at the source
   * (`components/auth-form.tsx`), and the test still has to wait for the
   * handler it means to exercise, or it measures the unhydrated page.
   */
  await page.goto("/login", { waitUntil: "load" });
  /* Hydration, waited for by its effect rather than by a sleep: the submit
     handler is only attached once the client component has mounted, and the
     button is what carries it. */
  await page.locator('button[type="submit"]').waitFor({ state: "visible" });
  await page.waitForLoadState("domcontentloaded");
  await page.fill('input[type="email"]', EMAIL!);
  await page.fill('input[type="password"]', PASSWORD!);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(admin|onboarding)/, { timeout: 60_000 });
}

/**
 * Everything measurable about a rendered page, collected in one pass.
 *
 * In the page rather than through the Playwright API on purpose: this walks
 * every element, and a round trip per element would make the suite take
 * minutes rather than seconds.
 */
const MEASURE = ({ minTarget, minFont }: { minTarget: number; minFont: number }) => {
  const vw = window.innerWidth;

  const describe = (el: Element) => {
    const cls = typeof el.className === "string" ? el.className : "";
    const text = (el.textContent || el.getAttribute("aria-label") || "").trim();
    return `<${el.tagName.toLowerCase()}> "${text.slice(0, 40)}" .${cls.slice(0, 90)}`;
  };

  /* Hidden, or a visually-hidden input standing in for a painted control.
     Both are real elements with a box and neither is something to tap. */
  const invisible = (el: Element) => {
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none" || st.opacity === "0") return true;
    if (st.position === "absolute" && st.clipPath !== "none") return true;
    const r = el.getBoundingClientRect();
    return r.width <= 2 && r.height <= 2;
  };

  const overflowing: string[] = [];
  for (const el of document.body.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (invisible(el)) continue;
    /*
     * Inside something that deliberately handles its own width is not
     * overflow. Two shapes qualify and both are `overflow-x` other than
     * `visible`:
     *
     *   - `auto`/`scroll` — a wide table given `overflow-x-auto`, a row of
     *     category chips that scrolls sideways on purpose. That is the *fix*
     *     for overflow, not an instance of it.
     *   - `hidden` — the marketing home's marquee is a `w-max` list of shop
     *     names translated across a clipped window. It is wider than the
     *     viewport by construction and always will be; the parent is what
     *     stops anyone seeing it. Counting its 33 children as faults buries
     *     the real ones.
     *
     * The page-level check above still catches genuine overflow, because a
     * clipped subtree cannot make the document wider than the window.
     */
    let contained = false;
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (getComputedStyle(p).overflowX !== "visible") { contained = true; break; }
    }
    if (contained) continue;
    if (r.right > vw + 1) overflowing.push(describe(el));
  }

  const smallFields: string[] = [];
  for (const el of document.querySelectorAll("input, select, textarea")) {
    const type = el.getAttribute("type");
    if (type && ["checkbox", "radio", "range", "file", "hidden", "submit", "button"].includes(type)) continue;
    if (invisible(el)) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < minFont) smallFields.push(`${describe(el)} @${size}px`);
  }

  /*
   * A textarea that has *collapsed* to the touch floor.
   *
   * The counterpart to the check below, and the reason it exists: the 44pt
   * floor was briefly written into the shell that `Input`, `Select` and
   * `Textarea` all share. `Textarea` sets `min-h-20`, which is the same CSS
   * property — and a variant is emitted after the plain utility, so inside
   * `@media (pointer: coarse)` the floor won and every multi-line field in the
   * panel shrank from 80pt to 44pt. A minimum that is also a maximum is not a
   * floor, and the symptom is a "message" box one line tall on the device it
   * is most awkward to type on.
   */
  const shrunkFields: string[] = [];
  for (const el of document.querySelectorAll("textarea")) {
    if (invisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 72) shrunkFields.push(`${describe(el)} ${Math.round(r.height)}pt tall`);
  }

  const smallTargets: string[] = [];
  for (const el of document.querySelectorAll(
    'button, select, textarea, input:not([type="hidden"]), [role="button"], [role="tab"], summary',
  )) {
    if (invisible(el)) continue;
    /* The label is the target when there is one — tapping it activates the
       control, so a 14pt checkbox inside a 44pt row is not a small target. */
    const label = el.closest("label");
    const box = label && (el.tagName === "INPUT" || el.tagName === "SELECT") ? label : el;
    const r = box.getBoundingClientRect();
    if (r.height < minTarget) smallTargets.push(`${describe(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }

  return {
    documentWidth: document.documentElement.scrollWidth,
    windowWidth: vw,
    overflowing,
    smallFields,
    shrunkFields,
    smallTargets,
  };
};

/*
 * `<a>` is measured separately from the list above, and mostly forgiven.
 *
 * WCAG 2.5.8 exempts a target "in a sentence or block of text", because the
 * only way to grow it is to break the line it sits in. That covers the order
 * reference and the invoice links in an order's metadata line, and the "Read
 * the guide" links under a settings field — all of which are inline in running
 * text and correctly left alone.
 *
 * What it does not cover is a link that *is* a row: the client list, a nav
 * item, a card. Those are block-level, so that is the test — a link whose own
 * `display` is not inline has no excuse for being 30pt tall.
 */
const MEASURE_BLOCK_LINKS = ({ minTarget }: { minTarget: number }) =>
  [...document.querySelectorAll("a[href]")]
    .filter((el) => {
      const st = getComputedStyle(el);
      if (st.visibility === "hidden" || st.display === "none") return false;
      if (st.display.startsWith("inline") && st.display !== "inline-flex" && st.display !== "inline-grid") return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      /* An inline-flex link sitting inside a paragraph is still inline in
         text — judge by the parent, which is where the line comes from. */
      const parent = el.parentElement;
      if (parent && ["P", "SPAN", "LI", "TD"].includes(parent.tagName)) {
        const pd = getComputedStyle(parent).display;
        if (pd === "block" && parent.tagName === "P") return false;
      }
      return r.height < minTarget;
    })
    .map((el) => {
      const r = el.getBoundingClientRect();
      const cls = typeof el.className === "string" ? el.className : "";
      return `<a> "${(el.textContent || "").trim().slice(0, 40)}" ${Math.round(r.width)}x${Math.round(r.height)} .${cls.slice(0, 90)}`;
    });

/**
 * The measurements, run over one list of routes on one already-open page.
 *
 * Shared by the public sweep and the admin sweep because the question is the
 * same for both — only the routes and whether a session is needed differ.
 */
async function sweep(page: Page, routes: readonly string[]): Promise<string[]> {
  const failures: string[] = [];

  for (const route of routes) {
    /*
     * `load`, never `networkidle`.
     *
     * `admin/layout.tsx` mounts `<LiveRefresh url="/api/admin/events" />`, an
     * EventSource that is *designed* never to close — it is what makes the
     * panel update when a webhook settles an order. To Playwright that is a
     * request permanently in flight, so `networkidle` waits for a quiet
     * network that this page has promised never to have, and the run dies on
     * its own timeout rather than on anything it measured.
     *
     * 90s because against `next dev` the first hit on a route compiles it, and
     * on a loaded machine that alone can pass 45 seconds — which would fail the
     * run on the build server's speed rather than on anything about the page.
     */
    const response = await page.goto(route, { waitUntil: "load", timeout: 90_000 });
    expect(response?.status(), `${route} should render`).toBeLessThan(400);
    /* Client components measure after mount — a chart's plot, a popover's
       position — so the first paint is not the layout. */
    await page.waitForTimeout(500);

    const m = await page.evaluate(MEASURE, { minTarget: MIN_TARGET, minFont: MIN_FIELD_FONT });
    const links = await page.evaluate(MEASURE_BLOCK_LINKS, { minTarget: MIN_TARGET });

    if (m.documentWidth > m.windowWidth + 1) {
      failures.push(`${route}: scrolls sideways — document ${m.documentWidth}px in a ${m.windowWidth}px window`);
    }
    for (const el of m.overflowing) failures.push(`${route}: past the right edge — ${el}`);
    for (const el of m.smallFields) failures.push(`${route}: field under ${MIN_FIELD_FONT}px, Safari will zoom — ${el}`);
    for (const el of m.shrunkFields) failures.push(`${route}: multi-line field collapsed to a single row — ${el}`);
    for (const el of m.smallTargets) failures.push(`${route}: target under ${MIN_TARGET}pt — ${el}`);
    for (const el of links) failures.push(`${route}: block link under ${MIN_TARGET}pt — ${el}`);
  }

  return failures;
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} — ${vp.width}x${vp.height}`, () => {
    test.use({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: true,
      isMobile: true,
    });

    /*
     * The storefront and the public pages, with no session and therefore no
     * reason to skip. This is the half a stranger sees.
     */
    test(`every public page fits, and can be operated with a finger`, async ({ page }) => {
      test.setTimeout(PUBLIC_ROUTES.length * 30_000 + 60_000);
      await acceptConsent(page);
      const failures = await sweep(page, PUBLIC_ROUTES);
      expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
    });

    test(`every admin page fits, and can be operated with a finger`, async ({ page }) => {
      test.skip(
        !EMAIL || !PASSWORD,
        "needs a seller to sign in as — set E2E_SELLER_EMAIL and E2E_SELLER_PASSWORD against a seeded database",
      );
      /*
       * One test walks every route, so it needs a budget for every route.
       *
       * The default 60s is a per-*test* timeout, and against `next dev` the
       * first hit on each of these compiles it. Splitting this into 21 tests
       * per viewport would give each its own budget and cost 84 sign-ins, which
       * is the slower trade.
       */
      /*
       * One test walks every route, so it needs a budget for every route. The
       * default 60s is a per-*test* timeout, and against `next dev` the first
       * hit on each of these compiles it. Splitting this into 21 tests per
       * viewport would give each its own budget and cost 84 sign-ins, which is
       * the slower trade.
       */
      test.setTimeout(ROUTES.length * 30_000 + 60_000);

      await signIn(page);
      const failures = await sweep(page, ROUTES);
      expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
    });
  });
}
