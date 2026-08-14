# Sign in with Apple — the parts that are not code

Google's setup is two values from the Cloud console and nothing else to
remember. Apple's has four identifiers that look alike, a secret that expires,
and an email relay that fails silently. This file is the half of A13 that a
deploy cannot verify.

**Owner:** whoever holds the Apple Developer account.
**Written:** 2026-08-14.
**Next review: 2027-02-14** — see "The six-month clock" below for what to check
and why the date is not a rotation deadline.

## The four Apple identifiers, and which is which

Getting these crossed is the most common way this integration fails, and it
fails as `invalid_client` from Apple — the same answer a wrong team id, an
expired secret and a malformed key all produce.

| Variable | What it is | Looks like |
|---|---|---|
| `APPLE_CLIENT_ID` | The **Services ID**. The *web* OAuth client. | `store.sailo.signin` |
| `APPLE_APP_BUNDLE_IDENTIFIER` | The **App ID** / bundle identifier. The *native* app. | `store.sailo.app` |
| `APPLE_TEAM_ID` | The team that owns the key. Membership details. | 10 characters |
| `APPLE_KEY_ID` | Which `.p8` key signs the secret. Shown once. | 10 characters |

The browser flow authenticates as the **Services ID**. A device-issued identity
token — what the mobile app sends to `/sign-in/social` — is audienced to the
**bundle identifier**. They are different strings and both are needed.
`appleSignIn()` in `apps/web/src/lib/auth.ts` refuses to configure the provider
when they are equal, because the only way that happens is that one was pasted
into the other's variable.

`APPLE_PRIVATE_KEY` is the contents of the `.p8` file, PEM armour included. A
platform environment variable will store its newlines as the two characters
`\n`; both forms are accepted.

## The six-month clock, and why there is no reminder to rotate

Apple does not issue a client secret. It issues a signing key and expects the
secret to be an ES256 JWT you sign with it, valid for **at most six months**.
The usual way this is done — mint one by hand, paste it into an environment
variable, move on — is the reason Sign in with Apple has a reputation for
breaking on a Tuesday half a year after launch, with nothing in the diff and
nothing in the deploy log to explain it.

**Sailo does not store a client secret.** `appleClientSecret()` in
`apps/web/src/lib/social-auth.ts` mints one from the `.p8` key on every module
evaluation — every cold start, every deploy — with a thirty-day life. Thirty
days is far longer than any serverless instance survives and far inside Apple's
ceiling, so the secret is always fresh and there is nothing to rotate.

What *can* still go wrong, and what the review date is actually for:

- **The `.p8` key is revoked** in the Apple Developer portal, by someone
  cleaning up keys or by Apple. Nothing expires; the key simply stops working.
- **The Apple Developer Program membership lapses.** Every identifier above
  stops resolving.
- **The relay domain registration is dropped** — see the next section.

### If the minting ever has to be done by hand

For debugging, or if the runtime minting is ever removed:

```sh
# Header:  {"alg":"ES256","kid":"<APPLE_KEY_ID>","typ":"JWT"}
# Payload: {"iss":"<APPLE_TEAM_ID>","iat":<now>,"exp":<now + 15552000 max>,
#           "aud":"https://appleid.apple.com","sub":"<APPLE_CLIENT_ID>"}
```

Sign it ES256 with the `.p8`. The signature must be raw P-1363 (two 32-byte
integers, 64 bytes), **not** DER — most libraries default to DER for ECDSA, and
a DER signature is a well-formed JWT that Apple rejects with the same
`invalid_client` as everything else. `social-auth.test.ts` pins this.

### Rotating the key deliberately

1. Create a second sign-in key in Apple Developer → Certificates, IDs &
   Profiles → Keys. Two keys can be active at once.
2. Set `APPLE_KEY_ID` and `APPLE_PRIVATE_KEY` to the new pair and deploy.
3. Confirm a real sign-in works.
4. Revoke the old key.

No window exists where sign-in is down, because the secret is minted per boot
rather than pinned to a key at build time.

## The private email relay — the failure that looks like nothing

A seller who chooses **Hide My Email** gets an address at
`@privaterelay.appleid.com`. Apple forwards mail to it **only from sending
domains registered with Apple**, and drops everything else **without a bounce**.

Unregistered, the seller receives no order notifications, no password reset, no
email confirmation — and nothing anywhere in Sailo looks broken. Resend reports
the message as sent, because it was.

**To register:** Apple Developer → Certificates, Identifiers & Profiles →
**More** → **Sign in with Apple for Email Communication**. Add every domain and
sender address Resend sends from:

- the transactional domain (`SAILO_TX_DOMAIN`)
- the marketing domain (`SAILO_MKT_DOMAIN`)
- the fallback (`SAILO_MAIL_DOMAIN`)

Domains must already pass SPF at Apple's check, which the Resend setup
satisfies.

**Verify by receiving, not by sending.** Sign in with Apple once with Hide My
Email turned on, on a test account, and confirm the confirmation email actually
arrives at the relay address. A "sent" row in the Resend dashboard proves
nothing here — that is exactly the state that fails.

## Outstanding

Neither of these can be done from a repository, and both are still open as of
the date above:

- [ ] Register the Resend sending domains with Apple's email relay, and confirm
      a test message is **received** at a `@privaterelay.appleid.com` address.
- [ ] Create the Services ID, the App ID and the `.p8` key, and set the seven
      variables in `packages/auth/src/keys.ts` in each environment.

Until then the provider is simply not registered: `appleSignIn()` returns
nothing, `/sign-in/social` answers `PROVIDER_NOT_FOUND`, and password sign-in is
unaffected.
