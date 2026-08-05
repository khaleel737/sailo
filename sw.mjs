import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage();
await p.goto("http://localhost:3000/demo", { waitUntil: "networkidle" });
const btns = await p.$$eval("footer button, footer [role=button]", els =>
  els.map(e => `${e.tagName}|aria-label=${e.getAttribute("aria-label")}|text=${e.textContent.trim().slice(0,20)}`));
console.log("footer controls:", JSON.stringify(btns, null, 1));
