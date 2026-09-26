import type { Metadata, Viewport } from "next";
import { TabBar } from "@/components/tab-bar";
import { OfflineGuard } from "@/components/offline-guard";
// Self-hosted (no build-time call to Google Fonts). Japanese glyphs are split by unicode-range.
import "@fontsource/zen-kaku-gothic-new/400.css";
import "@fontsource/zen-kaku-gothic-new/500.css";
import "@fontsource/zen-kaku-gothic-new/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Job OS",
  manifest: "/manifest.webmanifest",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Job OS", statusBarStyle: "default" },
  icons: { icon: "/icons/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f5f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1626" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <OfflineGuard />
        <main className="page">{children}</main>
        <TabBar />
      </body>
    </html>
  );
}
