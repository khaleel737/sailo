import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getLocale } from "@/i18n/server";
import { directionOf } from "@/i18n/config";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Sailo — one link, your whole shop",
    template: "%s · Sailo",
  },
  description:
    "Sailo turns your bio link into a shop. Upload products, digital goods or services, and take orders on WhatsApp. No store setup, no checkout to configure.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Screen readers and search engines read the root element, so it carries the
  // visitor's resolved language. A shop whose own default differs overrides
  // both `lang` and `dir` on its own container.
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      dir={directionOf(locale)}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-white text-ink-900">
        {children}
      </body>
    </html>
  );
}
