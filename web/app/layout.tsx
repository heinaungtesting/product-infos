import type { Metadata, Viewport } from "next";
import { Sidebar, TabBar } from "@/components/tab-bar";
import { OfflineGuard } from "@/components/offline-guard";
import { runJobOS } from "@/lib/jobos";
// Self-hosted (no build-time call to Google Fonts). Japanese glyphs are split by unicode-range.
import "@fontsource/zen-kaku-gothic-new/400.css";
import "@fontsource/zen-kaku-gothic-new/500.css";
import "@fontsource/zen-kaku-gothic-new/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Job OS",
  manifest: "/manifest.webmanifest",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Job OS", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b1628",
};

/** Sidebar footer: how much of the reviewed profile is backed by code. Never blocks the page. */
async function KeepGoing() {
  const v = await runJobOS<{ reviewed: number; linked: number }>(["verify"]).catch(() => null);
  if (!v || !v.reviewed) return null;
  const pct = Math.round((v.linked / v.reviewed) * 100);
  return (
    <div className="keep-going">
      <strong>Keep going</strong>
      <div className="meter" role="img" aria-label={`${pct}% of claims link to code`}><span style={{ width: `${pct}%` }} /></div>
      <span className="num">{v.linked} / {v.reviewed} claims linked to code</span>
      <em>“Consistent steps create opportunity.”</em>
    </div>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <OfflineGuard />
        <div className="app">
          <Sidebar footer={<KeepGoing />} />
          <main className="page">{children}</main>
        </div>
        <TabBar />
      </body>
    </html>
  );
}
