import type { Metadata } from "next";
import Link from "next/link";
import { getT } from "@/i18n/server";
import { AuthError, AuthHeader } from "@/components/auth/auth-kit";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false },
};

const first = (v: string | string[] | undefined) =>
  Array.isArray(v) ? v[0] : v;

/**
 * Where the emailed link ends up.
 *
 * The link in the mail points at better-auth, not here — it checks the token
 * first and only then redirects, carrying `?token=`. A token that's expired or
 * already spent arrives as `?error=` instead, so a dead link explains itself
 * rather than failing at the moment someone submits a new password.
 */
export default async function ResetPasswordPage({
  searchParams,
}: PageProps<"/reset-password">) {
  const params = await searchParams;
  const token = first(params.token);
  const error = first(params.error);

  const { t } = await getT();

  if (!token || error) {
    return (
      <>
        <AuthHeader title={t.auth.resetTitle} />
        <div className="space-y-6">
          <AuthError>{t.auth.resetInvalid}</AuthError>
          <p className="text-center text-[0.875rem]">
            <Link
              href="/forgot-password"
              className="focus-line draw-underline font-medium text-[var(--ink)]"
            >
              {t.auth.forgotTitle}
            </Link>
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <AuthHeader title={t.auth.resetTitle} subtitle={t.auth.resetSubtitle} />
      <ResetPasswordForm token={token} t={t} />
    </>
  );
}
