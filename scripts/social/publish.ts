/**
 * Publishing, one platform at a time.
 *
 * Everything goes through the Composio CLI rather than the platform SDKs: the
 * accounts are already linked there, so there are no per-platform tokens to
 * keep in this repo and no refresh logic to get wrong at 9am unattended.
 *
 * Design rule for the whole file: a platform failing is not the run failing.
 * Instagram being down must not stop the Facebook post, and a network that is
 * not linked yet reports `skipped` rather than throwing — that is how X and
 * LinkedIn sit here dormant until they are connected, with no code change.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { promisify } from "node:util";
import { put } from "@vercel/blob";
import type { Post } from "./content";

const run = promisify(execFile);

export type Outcome =
  | { platform: string; status: "posted"; id: string; note?: string }
  | { platform: string; status: "skipped"; reason: string }
  | { platform: string; status: "failed"; reason: string };

/** Instagram Business account and Facebook Page, both confirmed live. */
export const IG_USER_ID = process.env.SAILO_IG_USER_ID ?? "28236130465999041";
export const FB_PAGE_ID = process.env.SAILO_FB_PAGE_ID ?? "1263171743544896";

const NOT_CONNECTED = /no active connection|not connected|4302/i;

/**
 * Invokes a Composio tool. The CLI prints a JSON envelope; large payloads are
 * spilled to a file and referenced by path, which we read back so callers
 * always get the real object.
 */
export async function composio(
  slug: string,
  data: Record<string, unknown>,
): Promise<{ ok: boolean; data: Record<string, unknown>; error?: string }> {
  let stdout: string;
  try {
    ({ stdout } = await run("composio", ["execute", slug, "-d", JSON.stringify(data)], {
      maxBuffer: 32 * 1024 * 1024,
      timeout: 180_000,
    }));
  } catch (err) {
    const e = err as { stdout?: string; message?: string };
    // A non-zero exit still carries a JSON envelope for tool-level failures.
    stdout = e.stdout ?? "";
    if (!stdout.trim()) return { ok: false, data: {}, error: e.message ?? String(err) };
  }

  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    return { ok: false, data: {}, error: `Unparseable response: ${stdout.slice(0, 300)}` };
  }

  let payload = (envelope.data ?? {}) as Record<string, unknown>;
  if (envelope.storedInFile && typeof envelope.outputFilePath === "string") {
    try {
      const parsed = JSON.parse(await readFile(envelope.outputFilePath, "utf8"));
      payload = (parsed.data ?? parsed) as Record<string, unknown>;
    } catch {
      /* Fall through to the inline payload. */
    }
  }

  return {
    ok: envelope.successful === true,
    data: payload,
    error: typeof envelope.error === "string" ? envelope.error : undefined,
  };
}

/**
 * Instagram will only fetch art from a public URL, so the render has to live
 * somewhere Meta's crawler can reach before it can be posted. Blob is already
 * the app's image host and its URLs are permanent and unauthenticated.
 */
export async function uploadArt(pngPath: string, key: string): Promise<string> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN missing — run via `npm run social:*`, which loads .env.local");
  }
  const blob = await put(`social/${key}/${basename(pngPath)}`, await readFile(pngPath), {
    access: "public",
    contentType: "image/png",
    addRandomSuffix: true,
  });
  return blob.url;
}

const digits = (v: unknown): string | undefined => {
  const str = typeof v === "string" || typeof v === "number" ? String(v) : "";
  return /^\d+$/.test(str) ? str : undefined;
};

/** Instagram: build a container from the image URL, then publish it. */
export async function postInstagram(post: Post, imageUrl: string): Promise<Outcome> {
  const container = await composio("INSTAGRAM_CREATE_MEDIA_CONTAINER", {
    ig_user_id: IG_USER_ID,
    image_url: imageUrl,
    caption: post.caption.instagram,
    alt_text: post.alt,
  });
  if (!container.ok) {
    const reason = container.error ?? "container creation failed";
    return NOT_CONNECTED.test(reason)
      ? { platform: "instagram", status: "skipped", reason: "not connected" }
      : { platform: "instagram", status: "failed", reason };
  }

  const creationId = digits(container.data.id);
  if (!creationId) {
    return {
      platform: "instagram",
      status: "failed",
      reason: `No container id in response: ${JSON.stringify(container.data).slice(0, 200)}`,
    };
  }

  const published = await composio("INSTAGRAM_CREATE_POST", {
    ig_user_id: IG_USER_ID,
    creation_id: creationId,
  });
  if (!published.ok) {
    return { platform: "instagram", status: "failed", reason: published.error ?? "publish failed" };
  }
  return {
    platform: "instagram",
    status: "posted",
    id: String(published.data.id ?? creationId),
  };
}

/** Facebook Page photo post — one call, caption included. */
export async function postFacebook(post: Post, imageUrl: string): Promise<Outcome> {
  const link = post.link ? `\n\n${post.link}` : "";
  const res = await composio("FACEBOOK_CREATE_PHOTO_POST", {
    page_id: FB_PAGE_ID,
    url: imageUrl,
    message: `${post.caption.facebook}${link}`,
  });
  if (!res.ok) {
    const reason = res.error ?? "post failed";
    return NOT_CONNECTED.test(reason)
      ? { platform: "facebook", status: "skipped", reason: "not connected" }
      : { platform: "facebook", status: "failed", reason };
  }
  return {
    platform: "facebook",
    status: "posted",
    id: String(res.data.post_id ?? res.data.id ?? "posted"),
  };
}

/**
 * LinkedIn — the Sailo company page only.
 *
 * This deliberately has no fallback to the signed-in member. Resolving the
 * author from LINKEDIN_GET_MY_INFO publishes company marketing to whoever
 * happens to hold the token, which is a personal profile, and that is not a
 * mistake worth making twice: it is public the instant it happens and the
 * connection's scopes cannot read posts back to undo it.
 *
 * So the page URN is required, explicit configuration. No URN, no post.
 * Set SAILO_LI_ORG_URN=urn:li:organization:<id> in .env.local once the
 * connection carries w_organization_social.
 */
export const LI_ORG_URN = process.env.SAILO_LI_ORG_URN?.trim();

export async function postLinkedIn(post: Post, pngPath: string): Promise<Outcome> {
  const urn = LI_ORG_URN;
  if (!urn) {
    return {
      platform: "linkedin",
      status: "skipped",
      reason: "no SAILO_LI_ORG_URN set — refusing to post to a personal profile",
    };
  }
  if (!/^urn:li:organization:[A-Za-z0-9_-]+$/.test(urn)) {
    return {
      platform: "linkedin",
      status: "failed",
      reason: `SAILO_LI_ORG_URN must be urn:li:organization:<id>, got "${urn}"`,
    };
  }

  const link = post.link ? `\n\n${post.link}` : "";
  const res = await composio("LINKEDIN_CREATE_LINKED_IN_POST", {
    author: urn,
    commentary: `${post.caption.linkedin}${link}`,
    images: [pngPath],
  });
  if (!res.ok) {
    return { platform: "linkedin", status: "failed", reason: res.error ?? "post failed" };
  }
  /*
   * LinkedIn returns the new post's URN in the x-restli-id header rather than
   * the body, and this connection's scopes can write posts but not read them
   * back — so if the URN doesn't survive into the payload there is no way to
   * confirm the post later. Keep whatever identifier came through, and say so
   * when none did instead of logging a bare "posted".
   */
  const urnish = Object.values(res.data).find(
    (v) => typeof v === "string" && v.startsWith("urn:li:"),
  );
  const id = res.data.id ?? res.data.postUrn ?? urnish;
  return id
    ? { platform: "linkedin", status: "posted", id: String(id) }
    : { platform: "linkedin", status: "posted", id: "unknown", note: "no urn returned — verify in feed" };
}

/** X. Upload the image for a media id, then post with it attached. */
export async function postX(post: Post, pngPath: string): Promise<Outcome> {
  const upload = await composio("TWITTER_UPLOAD_MEDIA", {
    media: pngPath,
    media_category: "tweet_image",
  });
  if (!upload.ok) {
    const reason = upload.error ?? "media upload failed";
    return NOT_CONNECTED.test(reason)
      ? { platform: "x", status: "skipped", reason: "not connected" }
      : { platform: "x", status: "failed", reason };
  }

  const inner = (upload.data.data ?? upload.data) as Record<string, unknown>;
  const mediaId = digits(inner.id) ?? digits(inner.media_id) ?? digits(inner.media_id_string);
  if (!mediaId) {
    return { platform: "x", status: "failed", reason: "No media id returned" };
  }

  /*
   * X weights a URL as 23 characters regardless of its real length, so the
   * budget is measured against that rather than the string. Over the limit the
   * link is dropped before the copy is — the post still reads, and the profile
   * carries the link anyway.
   */
  const body = post.caption.x;
  const weighted = (t: string, withLink: boolean) => t.length + (withLink ? 24 : 0);
  const text =
    post.link && weighted(body, true) <= 280 ? `${body}\n\n${post.link}` : body;
  if (text.length > 280 && !post.link) {
    return { platform: "x", status: "failed", reason: `Caption is ${text.length} chars, limit is 280` };
  }

  const res = await composio("TWITTER_CREATION_OF_A_POST", {
    text,
    media_media_ids: [mediaId],
  });
  if (!res.ok) {
    return { platform: "x", status: "failed", reason: res.error ?? "post failed" };
  }
  const created = (res.data.data ?? res.data) as Record<string, unknown>;
  return { platform: "x", status: "posted", id: String(created.id ?? "posted") };
}
