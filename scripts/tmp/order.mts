import { chromium } from "@playwright/test";
const OUT = "/private/tmp/claude-501/-Users-khaleelmusleh-Desktop-Shopik/ac36c06e-0b1f-49d2-8d1b-799407288c73/scratchpad";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
p.on("console", (m) => { if (m.type() === "error") console.log("  [console]", m.text().slice(0, 160)); });
p.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 200)));
p.on("response", async (r) => {
  if (r.request().method() === "POST") console.log(`  [POST] ${r.status()} ${r.url().replace("http://localhost:3000","")}`);
});

await p.goto("http://localhost:3000/khaleel-musleh", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(2500);
console.log("buy buttons:", await p.locator('button:has-text("Buy"), button:has-text("Order")').count());
await p.locator('button:has-text("Buy"), button:has-text("Order")').first().click();
await p.waitForTimeout(1800);
await p.screenshot({ path: `${OUT}/order-1-sheet.png` });
// Fill the buyer details, then press the order button and watch what happens.
const inputs = p.locator('input:visible[type="text"], input:visible[type="email"], input:visible:not([type])');
const n = await inputs.count();
for (let i = 0; i < n; i++) {
  const el = inputs.nth(i);
  const ph = (await el.getAttribute("placeholder")) ?? "";
  const nm = (await el.getAttribute("name")) ?? "";
  const type = (await el.getAttribute("type")) ?? "";
  const val = type === "email" || /mail/i.test(nm + ph) ? "test@example.com"
            : /phone|tel/i.test(nm + ph) ? "+15551234567"
            : "TEST ORDER - please delete";
  await el.fill(val).catch(() => {});
  console.log(`  filled ${nm || ph || type}`);
}
await p.screenshot({ path: `${OUT}/order-2-filled.png` });

const order = p.locator('button:has-text("Order by email")').first();
console.log("pressing 'Order by email' ...");
await order.click({ noWaitAfter: true });

for (let i = 0; i < 10; i++) {
  await p.waitForTimeout(1000);
  const disabled = await order.isDisabled().catch(() => null);
  const busy = await order.getAttribute("aria-busy").catch(() => null);
  const err = await p.locator('[role="alert"], .text-red-600, [data-error]').first().textContent().catch(() => null);
  console.log(`  t+${i + 1}s disabled=${disabled} aria-busy=${busy} error=${(err ?? "").trim().slice(0, 70) || "none"}`);
  if (busy !== "true" && disabled === false) break;
}
await p.screenshot({ path: `${OUT}/order-3-after.png` });
await b.close();
