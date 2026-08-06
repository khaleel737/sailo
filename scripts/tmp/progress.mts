import { chromium } from "@playwright/test";
const OUT = "/private/tmp/claude-501/-Users-khaleelmusleh-Desktop-Shopik/ac36c06e-0b1f-49d2-8d1b-799407288c73/scratchpad";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();

// Throttle so the loading states are actually observable.
const cdp = await ctx.newCDPSession(p);
await cdp.send("Network.emulateNetworkConditions", {
  offline: false, downloadThroughput: 180_000, uploadThroughput: 90_000, latency: 350,
});

await p.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(1500);

const states: string[] = [];
await p.exposeFunction("record", (s: string) => { states.push(s); });
await p.evaluate(() => {
  const el = document.querySelector(".route-progress");
  if (!el) return;
  new MutationObserver(() => (window as unknown as { record: (s: string | null) => void }).record(el.getAttribute("data-state")))
    .observe(el, { attributes: true, attributeFilter: ["data-state"] });
});

console.log("bar present:", await p.locator(".route-progress").count());
await p.locator('a[href="/privacy"]').first().click();
await p.waitForTimeout(400);
await p.screenshot({ path: `${OUT}/progress-mid.png` });
await p.waitForURL(/privacy/, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(1200);
console.log("data-state transitions:", states.join(" -> ") || "(none)");
await b.close();
