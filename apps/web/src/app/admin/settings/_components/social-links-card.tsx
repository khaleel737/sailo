"use client";

import { Card, Field, Input } from "@sailo/design-system/web";
import { SOCIAL_PLATFORMS } from "@/lib/utils";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

const SOCIAL_LABELS: Record<string, string> = {
  x: "X (Twitter)",
  tiktok: "TikTok",
  youtube: "YouTube",
  whatsapp: "WhatsApp",
};

export function SocialLinksCard({ socialByPlatform }: { socialByPlatform: Map<string, string> }) {
  const a = useAdminT();

  return (
          <Card className="space-y-3 p-5">
            <h2 className="text-sm font-semibold text-ink-900">{a.settings.socialLinks}</h2>
            <p className="-mt-1 text-xs text-ink-500">
              {a.settings.socialLinksBody}
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              {SOCIAL_PLATFORMS.map((platform) => (
                <Field
                  key={platform}
                  label={
                    SOCIAL_LABELS[platform] ??
                    platform.charAt(0).toUpperCase() + platform.slice(1)
                  }
                  htmlFor={`social_${platform}`}
                >
                  <Input
                    id={`social_${platform}`}
                    name={`social_${platform}`}
                    defaultValue={socialByPlatform.get(platform) ?? ""}
                    placeholder={`${platform}.com/yourname`}
                  />
                </Field>
              ))}
            </div>
          </Card>
  );
}
