/**
 * Escaping, which every value that reaches the markup goes through.
 *
 * Its own module because it is the one function here with a security property rather
 * than a visual one: an order note carrying `<script>` is a stored payload, and an
 * inbox is a rendering target we do not control. Everything else in this folder is
 * about what an email looks like; this is about what it cannot do.
 */



export const esc = (v: string) =>
  v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
