import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui";
import { getT } from "@/i18n/server";
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
        <h1 className="text-xl font-semibold tracking-tight">
          {t.auth.resetTitle}
        </h1>
        <div className="mt-6 space-y-4">
          <Alert>{t.auth.resetInvalid}</Alert>
          <Link
            href="/forgot-password"
            className="focus-ring block rounded text-center text-sm font-medium text-brand-700 underline underline-offset-4 hover:text-brand-800"
          >
            {t.auth.forgotTitle}
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">
        {t.auth.resetTitle}
      </h1>
      <p className="mb-6 mt-1 text-sm text-ink-500">{t.auth.resetSubtitle}</p>
      <ResetPasswordForm token={token} t={t} />
    </>
  );
}
