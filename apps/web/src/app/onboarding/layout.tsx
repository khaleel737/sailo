import { GoogleTag } from "@/lib/google-tag";
import { ConsentGate } from "@/components/shared/consent-gate";

/*
 * Per-seller, behind a session, and re-read on every visit — there is no
 * shared shell worth extracting here. `instant = false` says so explicitly
 * rather than leaving the build to complain about it.
 */
export const instant = false;

/**
 * Onboarding exists as a layout only to carry the Google tag.
 *
 * Signup → first product is the funnel this measures, and it is the one step
 * of it that had no layout to hang the tag on. See `src/lib/analytics.tsx` for
 * why the tag is mounted per surface rather than once in the root layout.
 */
export default function OnboardingLayout({
  children,
}: LayoutProps<"/onboarding">) {
  return (
    <>
      {children}
      <GoogleTag />
      <ConsentGate />
    </>
  );
}
