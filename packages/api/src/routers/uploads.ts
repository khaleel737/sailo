import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { rateLimit } from "@sailo/rate-limit";
/*
 * The lists, ceilings and path shape are `@sailo/storage/rules`' now.
 *
 * This file's header used to call its copy of them "TWIN, and a known one",
 * and it was right to: the web route receives the bytes and can look at them
 * while this mints every constraint into a signed token instead, so the two
 * enforce the same rules in different places. Different enforcement is fine.
 * Two copies of *what the rules are* is a drifted allowlist, and a drifted
 * allowlist is a stored cross-site-scripting hole that fails no test.
 */
import {
  FILE_TYPES,
  IMAGE_TYPES,
  maxBytesFor,
  uploadPath,
} from "@sailo/storage/rules";
import { router, shopProcedure } from "../trpc";

/**
 * Permission to put one file in blob storage, and nothing else.
 *
 * **No bytes pass through here.** A tRPC procedure is a JSON call over a
 * batched POST, and pushing a 100 MB video through one would mean base64 in a
 * request body, in memory, through a serverless function with a request-size
 * ceiling — for a file that has to end up in Blob regardless. So the phone
 * asks for a token, uploads straight to Vercel, and tells us the URL
 * afterwards through whichever write it was doing.
 *
 * That inverts where the checking happens. `apps/web/src/app/api/upload/route.ts`
 * receives the file and can look at it; here we never see it, so every
 * constraint has to be minted *into the token* — the exact path, the allowed
 * media types, the size ceiling, the expiry. Vercel enforces them at its own
 * edge and refuses the upload if the client lies about any of them.
 */

/*
 * The ceilings are `maxBytesFor` from `@sailo/storage/rules`, which this file
 * already calls — the two `MAX_*_BYTES` constants that sat here were left behind
 * by that move and used by nothing. They are worth a note rather than a silent
 * deletion: a stale copy of a size limit sitting beside the real one is how a
 * later edit picks the wrong number, and lint being switched off is why it sat
 * here long enough to be found by a tool rather than by a reader.
 */

/**
 * How long a token is good for.
 *
 * Minutes rather than hours: this is a bearer credential to write into our
 * storage, and the app asks for a fresh one per upload, so a long life buys
 * nothing and leaves a usable token in a log or a proxy cache for the rest of
 * the afternoon. The two differ because the ceiling does — eight megabytes is
 * seconds on anything, a hundred is not, and a token that expires mid-upload
 * loses the whole transfer rather than the last part of it.
 */
const IMAGE_TTL_MS = 5 * 60 * 1000;
const FILE_TTL_MS = 20 * 60 * 1000;

/** The two things a seller uploads, and they are not interchangeable. */
const PURPOSES = ["image", "download"] as const;

export const uploadsRouter = router({
  /**
   * A short-lived, single-path Vercel Blob token for one upload.
   *
   * Scoped three ways, and all three matter:
   *
   *  - **The path is fixed, not a prefix.** The token names exactly
   *    `shops/<shopId>/…/<uuid>.<ext>`, with the shop id taken from the
   *    session and never from the input, so it cannot be pointed at another
   *    seller's folder. `allowOverwrite: false` means it cannot clobber an
   *    existing object either, which a prefix-scoped token would allow.
   *  - **The media types are the route's allowlist**, so a token cannot be
   *    used to upload the `.html` or `.svg` that route refuses. Those are
   *    served back from our own domain; permitting one here would reopen the
   *    stored-XSS hole it closed.
   *  - **The size ceiling is the route's**, enforced by Vercel rather than by
   *    us, because we never see the bytes.
   */
  token: shopProcedure
    .input(
      z.object({
        purpose: z.enum(PURPOSES),
        /**
         * The media type the phone says it is about to send. Checked here so
         * the seller gets a sentence rather than a Blob API error, and pinned
         * into the token so a client that lied is refused by Vercel too.
         */
        contentType: z.string().min(1).max(255),
        /** Only its extension is used — see `extensionOf`. */
        filename: z.string().min(1).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      /*
       * The same limit, for the same reason, as the web upload route: signup
       * is open, so "an authenticated seller" is "anyone who spent thirty
       * seconds", and each of these tokens is permission to write up to a
       * hundred megabytes. Keyed per shop rather than per IP — a seller
       * uploading a catalogue of photos is the normal case and should not be
       * throttled by whoever shares their office network.
       */
      const gate = await rateLimit(`upload:${ctx.shopId}`, 60, 300);
      if (!gate.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many uploads just now. Wait a moment and try again.",
        });
      }

      const isDownload = input.purpose === "download";
      const allowed = isDownload ? FILE_TYPES : IMAGE_TYPES;

      if (!(allowed as readonly string[]).includes(input.contentType)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: isDownload
            ? "That file type can't be delivered. Try a PDF, zip, document, image, audio or video file."
            : "Use a JPG, PNG, WebP, GIF or AVIF image.",
        });
      }

      const pathname = uploadPath(
        ctx.shopId,
        isDownload ? "download" : "image",
        crypto.randomUUID(),
        input.filename,
      );
      const maxBytes = maxBytesFor(isDownload ? "download" : "image");
      const expiresAt = Date.now() + (isDownload ? FILE_TTL_MS : IMAGE_TTL_MS);

      const token = await generateClientTokenFromReadWriteToken({
        pathname,
        // One type, not the allowlist: the token is for the file the caller
        // just described, so there is no reason for it to accept another.
        allowedContentTypes: [input.contentType],
        maximumSizeInBytes: maxBytes,
        validUntil: expiresAt,
        // The uuid already makes the path unguessable, and a suffix would mean
        // the URL we get back is not the one we signed.
        addRandomSuffix: false,
        allowOverwrite: false,
      });

      /*
       * The ceilings travel back with the token so the screen can say them.
       * A picker that silently drops a 9 MB photo reads as the app being
       * broken; one that says "images must be under 8 MB" reads as a rule.
       */
      return {
        token,
        pathname,
        maxBytes,
        expiresAt,
      };
    }),
});
