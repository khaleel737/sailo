import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALES } from "./config";

/**
 * Sets `<html lang>` and `<html dir>` in the browser, before the first paint.
 *
 * WHY THIS EXISTS
 * The root layout used to await `getLocale()` to render these two attributes.
 * That reads a cookie, which makes the layout request-bound, which makes every
 * route beneath it request-bound — and because the attributes sit on `<html>`
 * itself there is no child to wrap in `<Suspense>` and stream. One `await`
 * held all forty-odd routes out of the CDN and made every response in the
 * product `Cache-Control: private, no-store`.
 *
 * So the server emits a default and the browser corrects it. This is the
 * pattern Next documents for exactly this case; see `preventing-flash-before-
 * hydration` in their guides.
 *
 * WHY IT DOES NOT FLASH
 * The tag is inline and in the document body's first position, so the browser
 * executes it synchronously while parsing, before anything is painted. An
 * Arabic reader never sees a left-to-right frame.
 *
 * WHY IT IS SAFE FOR SEARCH AND SCREEN READERS
 * Google does not use `lang` to detect a page's language — it reads the
 * content, and the `hreflang` cluster in `<head>` is server-rendered and
 * unaffected. Screen readers read the live DOM, which this has already
 * corrected by the time anything is announced.
 *
 * The body is generated from `LOCALES` rather than written out, so a locale
 * added to the config cannot be missed here.
 */
const CODES = LOCALES.map((l) => l.code);
const RTL = LOCALES.filter((l) => l.dir === "rtl").map((l) => l.code);

export const LANG_SCRIPT = `(function(){try{
var codes=${JSON.stringify(CODES)};
var rtl=${JSON.stringify(RTL)};
var m=document.cookie.match(/(?:^|;\\s*)${LOCALE_COOKIE}=([^;]*)/);
var l=m&&codes.indexOf(m[1])>-1?m[1]:null;
if(!l){var langs=navigator.languages||[navigator.language||""];
for(var i=0;i<langs.length&&!l;i++){var c=String(langs[i]).toLowerCase();
if(codes.indexOf(c)>-1){l=c;}else{var b=c.split("-")[0];if(codes.indexOf(b)>-1){l=b;}}}}
l=l||"${DEFAULT_LOCALE}";
var e=document.documentElement;
if(e.lang!==l){e.lang=l;}
var d=rtl.indexOf(l)>-1?"rtl":"ltr";
if(e.dir!==d){e.dir=d;}
}catch(_){}})()`;
