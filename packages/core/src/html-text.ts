/**
 * A readable text version of an HTML document.
 *
 * Not a general converter and not trying to be. It exists so that something a
 * person read can be *recorded* — an email sent to a buyer, a policy page a
 * seller agreed to — and the reader of the result is a staff member answering a
 * chargeback or an issuer reading an evidence pack. What matters is that the
 * words, the amounts and the links survive in the order they appeared; what does
 * not matter is faithful reflowing.
 *
 * `<style>` and `<script>` bodies are dropped whole rather than tag-stripped,
 * because stripping their tags leaves the CSS itself as "text" — pages of it,
 * ahead of the sentence anybody wants to read.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
